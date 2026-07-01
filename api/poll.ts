// Polling endpoint — checks for new comments on media linked to active rules
// Called by cron-job.org or Vercel Cron every few minutes. No Facebook app / webhook needed.

import {
  getLoggedInClient,
  getRecentMedia,
  getComments,
  replyToComment,
  sendDirect,
  isProcessed,
  markProcessed,
  updateSettings,
  supabase,
} from "./ig-client.js";

async function processComments() {
  const { client } = await getLoggedInClient();

  // Get all active rules
  const { data: rules } = await supabase
    .from("ig_rules")
    .select("*")
    .eq("is_active", true);

  if (!rules || rules.length === 0) {
    return { processed: 0, rules: 0 };
  }

  // Collect unique media IDs from rules
  const mediaIds = [...new Set(rules.map((r: any) => r.media_id).filter(Boolean))];

  // Also fetch recent media to get their IDs (in case rules use URL only)
  let recentMedia: any[] = [];
  try {
    recentMedia = await getRecentMedia(client, 20);
  } catch (e) {
    console.error("[poll] getRecentMedia error:", e);
  }

  let processedCount = 0;

  for (const mediaId of mediaIds) {
    let comments: any[];
    try {
      comments = await getComments(client, mediaId);
    } catch (e) {
      console.error("[poll] getComments for " + mediaId + ":", e);
      continue;
    }

    for (const comment of comments) {
      const commentId = comment.pk || comment.id;
      const commentText = (comment.text || "").trim();
      const senderPk = comment.user?.pk?.toString() || "";

      if (!commentId || !commentText) continue;

      // Skip already processed
      if (await isProcessed(commentId)) continue;

      // Find matching rules for this media
      const matchingRules = rules.filter((r: any) => r.media_id === mediaId);
      if (matchingRules.length === 0) continue;

      const lowerComment = commentText.toLowerCase();
      let matched: any = null;

      for (const rule of matchingRules) {
        const keywords: string[] = rule.keywords ?? [];
        if (keywords.some((kw: string) => lowerComment.includes(kw.toLowerCase()))) {
          matched = rule;
          break;
        }
      }

      if (!matched) {
        // Mark as processed so we don't re-check
        await markProcessed(commentId);
        continue;
      }

      // Log trigger
      await supabase.from("ig_triggers").insert({
        ig_rule_id: matched.id,
        media_id: mediaId,
        comment_id: commentId,
        comment_text: commentText,
        sender_ig_id: senderPk,
      });

      // Reply to comment
      const commentReply = matched.comment_reply || "Ответила вам в личные сообщения 😊";
      await replyToComment(client, mediaId, commentReply);

      // Try to send DM
      let dmSent = false;
      if (senderPk) {
        dmSent = await sendDirect(client, senderPk, matched.dm_message || "");
      }

      // If DM failed — reply with fallback comment
      if (!dmSent) {
        const failReply =
          matched.dm_fail_reply ||
          "Не смогла отправить вам сообщение — у вас закрытый аккаунт. Напишите мне, пожалуйста, в личные сообщения 🙏";
        await replyToComment(client, mediaId, failReply);
      }

      await markProcessed(commentId);
      processedCount++;
    }
  }

  return { processed: processedCount, rules: rules.length, mediaChecked: mediaIds.length };
}

export default async function handler(req: any, res: any) {
  // Allow any GET/POST - for cron-job.org or manual trigger
  // Optional: set CRON_SECRET env var and pass ?secret=... or Authorization: Bearer ...
  if (req.method === "GET" || req.method === "POST") {
    const auth = req.headers?.authorization || "";
    const querySecret = req.query?.secret || req.body?.secret || "";
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret) {
      const authed = auth === "Bearer " + cronSecret || querySecret === cronSecret;
      if (!authed) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    try {
      const result = await processComments();
      await updateSettings({
        last_poll: new Date().toISOString(),
        last_error: null,
      });
      return res.status(200).json({ ok: true, ...result });
    } catch (e: any) {
      console.error("[poll] error:", e);
      await updateSettings({
        last_poll: new Date().toISOString(),
        last_error: e?.message || String(e),
        is_connected: false,
      });
      return res.status(500).json({ error: e?.message || "Polling failed" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}