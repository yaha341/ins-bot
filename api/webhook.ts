import { createClient } from "@supabase/supabase-js";

// Validate required environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const IG_API = "https://graph.facebook.com/v21.0";

async function igPost(path: string, body: Record<string, any>) {
  const res = await fetch(`${IG_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<any>;
}

async function replyToComment(commentId: string, message: string) {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN!;
  return igPost(`/${commentId}/replies`, { message, access_token: token });
}

async function sendDirect(igScopedUserId: string, text: string): Promise<boolean> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN!;
  // Get the IG Business Account ID
  const meRes = await fetch(`${IG_API}/me?fields=id&access_token=${token}`);
  const me = await meRes.json() as any;
  const pageId = me?.id;
  if (!pageId) return false;

  const res = await fetch(`${IG_API}/${pageId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: igScopedUserId },
      message: { text },
      access_token: token,
      messaging_type: "RESPONSE",
    }),
  });
  const data = await res.json() as any;
  if (data?.error) {
    console.error("[IG] sendDirect error:", data.error);
    return false;
  }
  return true;
}

async function handleEvent(body: any) {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;

      const value = change.value;
      if (!value) continue;

      const commentId: string = value.id;
      const commentText: string = (value.text || "").trim();
      const mediaId: string = value.media?.id || "";
      const senderId: string = value.from?.id || "";

      if (!commentId || !commentText || !mediaId || !senderId) continue;

      // Find matching rules
      const { data: rules } = await supabase
        .from("ig_rules")
        .select("*")
        .eq("is_active", true);

      if (!rules?.length) continue;

      const lowerComment = commentText.toLowerCase();
      let matched: any = null;

      for (const rule of rules) {
        // Check media_id match (if specified) OR match any media
        if (rule.media_id && rule.media_id !== mediaId) continue;
        const keywords: string[] = rule.keywords ?? [];
        if (keywords.some((kw: string) => lowerComment.includes(kw.toLowerCase()))) {
          matched = rule;
          break;
        }
      }

      if (!matched) continue;

      // Log trigger
      await supabase.from("ig_triggers").insert({
        ig_rule_id: matched.id,
        media_id: mediaId,
        comment_id: commentId,
        comment_text: commentText,
        sender_ig_id: senderId,
      });

      // Reply to comment
      const commentReply = matched.comment_reply || "Ответила вам в личные сообщения 😊";
      await replyToComment(commentId, commentReply);

      // Try to send DM
      const dmSent = await sendDirect(senderId, matched.dm_message || "");

      // If DM failed — reply with fallback comment
      if (!dmSent) {
        const failReply = matched.dm_fail_reply ||
          "Не смогла отправить вам сообщение — у вас закрытый аккаунт. Напишите мне, пожалуйста, в личные сообщения 🙏";
        await replyToComment(commentId, failReply);
      }
    }
  }
}

export default async function handler(req: any, res: any) {
  // GET = Meta webhook verification
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  // POST = incoming event
  if (req.method === "POST") {
    const body = req.body;
    // Respond immediately (Meta requires fast response)
    res.status(200).send("ok");
    // Process asynchronously
    try {
      await handleEvent(body);
    } catch (e) {
      console.error("[IG webhook] error:", e);
    }
    return;
  }

  res.status(405).send("Method not allowed");
}
