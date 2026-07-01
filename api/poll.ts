// Polling endpoint — checks for new comments on media linked to active rules
// Uses Apify Instagram API to read comments
// Uses instagram-private-api to write replies and DMs

import {
  getComments,
  replyToComment,
  sendDM,
  isProcessed,
  markProcessed,
  updateSettings,
  supabase,
} from "./apify-client.js";

async function processComments() {
  // Get all active rules
  const { data: rules } = await supabase
    .from("ig_rules")
    .select("*")
    .eq("is_active", true);

  if (!rules || rules.length === 0) {
    return { processed: 0, rules: 0 };
  }

  let processedCount = 0;

  for (const rule of rules) {
    const mediaUrl = rule.media_url;
    const mediaId = rule.media_id;

    if (!mediaUrl && !mediaId) {
      console.log("[poll] Skipping rule without URL or ID:", rule.id);
      continue;
    }

    // Convert media_id (shortcode) to URL if needed
    let url = mediaUrl;
    if (!url && mediaId) {
      url = `https://www.instagram.com/p/${mediaId}/`;
    }

    console.log(`[poll] Checking comments for: ${url}`);

    let comments: any[];
    try {
      comments = await getComments(url);
    } catch (e) {
      console.error("[poll] getComments error for " + url + ":", e);
      continue;
    }

    console.log(`[poll] Found ${comments.length} comments for ${mediaId}`);

    for (const comment of comments) {
      const commentId = comment.id;
      const commentText = comment.text || "";
      const senderUsername = comment.ownerUsername;
      const senderId = comment.ownerId;

      if (!commentId || !commentText) continue;

      // Skip already processed
      if (await isProcessed(commentId)) {
        continue;
      }

      const lowerComment = commentText.toLowerCase();
      const keywords: string[] = rule.keywords ?? [];

      // Check if comment matches any keyword
      const matched = keywords.some((kw: string) =>
        lowerComment.includes(kw.toLowerCase())
      );

      if (!matched) {
        // Mark as processed so we don't re-check
        await markProcessed(commentId);
        continue;
      }

      console.log(`[poll] Matched keyword in comment: "${commentText}"`);

      // Log trigger
      await supabase.from("ig_triggers").insert({
        ig_rule_id: rule.id,
        media_id: mediaId,
        comment_id: commentId,
        comment_text: commentText,
        sender_ig_id: senderId,
      });

      // Reply to comment
      const commentReply = rule.comment_reply || "Ответила вам в личные сообщения 😊";

      // We need the numeric media ID for instagram-private-api
      // Convert shortcode to numeric ID if needed
      let numericMediaId = mediaId;

      // For now, we'll use the shortcode as-is
      // instagram-private-api may need conversion
      await replyToComment(numericMediaId, commentReply);

      // Try to send DM
      let dmSent = false;
      if (senderId && rule.dm_message) {
        dmSent = await sendDM(senderId, rule.dm_message);
      }

      // If DM failed — reply with fallback comment
      if (!dmSent && rule.dm_message) {
        const failReply =
          rule.dm_fail_reply ||
          "Не смогла отправить вам сообщение — у вас закрытый аккаунт. Напишите мне, пожалуйста, в личные сообщения 🙏";
        await replyToComment(numericMediaId, failReply);
      }

      await markProcessed(commentId);
      processedCount++;
    }
  }

  return { processed: processedCount, rules: rules.length };
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
      console.log("[poll] Starting comment processing...");
      const result = await processComments();
      console.log("[poll] Processing complete:", result);

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
