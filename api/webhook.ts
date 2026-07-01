import { createClient } from "@supabase/supabase-js";
import { replyToComment, sendDM, isProcessed, markProcessed } from "./graph.js";

// Validate required environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
      const senderUsername: string = value.from?.username || "";

      if (!commentId || !commentText || !mediaId || !senderId) continue;

      console.log("[Webhook] New comment:", { commentId, commentText, mediaId, senderUsername });

      // Check if already processed
      if (await isProcessed(commentId)) {
        console.log("[Webhook] Comment already processed, skipping");
        continue;
      }

      // Find matching rules
      const { data: rules } = await supabase
        .from("ig_rules")
        .select("*")
        .eq("is_active", true);

      if (!rules?.length) {
        console.log("[Webhook] No active rules found");
        continue;
      }

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

      if (!matched) {
        console.log("[Webhook] No matching rule for comment");
        continue;
      }

      console.log("[Webhook] Rule matched:", matched.media_title || matched.media_id);

      // Mark as processed immediately to avoid duplicates
      await markProcessed(commentId);

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
      const replied = await replyToComment(commentId, commentReply);
      console.log("[Webhook] Comment reply sent:", replied);

      // Try to send DM
      const dmMessage = matched.dm_message || "";
      if (dmMessage) {
        const dmSent = await sendDM(senderId, dmMessage);
        console.log("[Webhook] DM sent:", dmSent);

        // If DM failed — reply with fallback comment
        if (!dmSent) {
          const failReply = matched.dm_fail_reply ||
            "Не смогла отправить вам сообщение — у вас закрытый аккаунт. Напишите мне, пожалуйста, в личные сообщения 🙏";
          await replyToComment(commentId, failReply);
          console.log("[Webhook] Fallback reply sent");
        }
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

    const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN || "instagram_bot_verify_token_2024";

    if (mode === "subscribe" && token === verifyToken) {
      console.log("[Webhook] Verification successful");
      return res.status(200).send(challenge);
    }

    console.log("[Webhook] Verification failed");
    return res.status(403).send("Forbidden");
  }

  // POST = incoming event
  if (req.method === "POST") {
    const body = req.body;
    console.log("[Webhook] Received event:", JSON.stringify(body, null, 2));

    // Respond immediately (Meta requires fast response)
    res.status(200).send("EVENT_RECEIVED");

    // Process asynchronously
    try {
      await handleEvent(body);
    } catch (e) {
      console.error("[Webhook] Error processing event:", e);
    }
    return;
  }

  res.status(405).send("Method not allowed");
}

