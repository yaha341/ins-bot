// Apify Instagram client
// Uses Instagram Comments Scraper actor from Apify

import { createClient } from "@supabase/supabase-js";
import { IgApiClient } from "instagram-private-api";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const APIFY_API_BASE = "https://api.apify.com/v2";
const INSTAGRAM_COMMENTS_ACTOR = "apify/instagram-comment-scraper";

// Get comments for a post by URL
export async function getComments(postUrl: string): Promise<any[]> {
  console.log("[Apify] Getting comments for:", postUrl);

  if (!APIFY_TOKEN) {
    console.error("[Apify] APIFY_API_TOKEN not set!");
    return [];
  }

  try {
    // Start actor run
    const runResponse = await fetch(
      `${APIFY_API_BASE}/acts/${INSTAGRAM_COMMENTS_ACTOR}/runs?token=${APIFY_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directUrls: [postUrl],
          maxComments: 100,
        }),
      }
    );

    if (!runResponse.ok) {
      const errorText = await runResponse.text();
      console.error("[Apify] Failed to start actor:", runResponse.status, errorText);
      return [];
    }

    const runData = await runResponse.json();
    const runId = runData.data.id;
    console.log("[Apify] Actor run started:", runId);

    // Wait for completion (poll every 2 seconds, max 60 seconds)
    let attempts = 0;
    let status = "RUNNING";

    while (status === "RUNNING" && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const statusResponse = await fetch(
        `${APIFY_API_BASE}/actor-runs/${runId}?token=${APIFY_TOKEN}`
      );

      if (!statusResponse.ok) {
        console.error("[Apify] Failed to check status");
        break;
      }

      const statusData = await statusResponse.json();
      status = statusData.data.status;
      console.log(`[Apify] Run status: ${status} (attempt ${attempts + 1}/30)`);

      attempts++;
    }

    if (status !== "SUCCEEDED") {
      console.error("[Apify] Actor run did not succeed:", status);
      return [];
    }

    // Get dataset items
    const datasetId = runData.data.defaultDatasetId;
    const datasetResponse = await fetch(
      `${APIFY_API_BASE}/datasets/${datasetId}/items?token=${APIFY_TOKEN}`
    );

    if (!datasetResponse.ok) {
      console.error("[Apify] Failed to get dataset");
      return [];
    }

    const items = await datasetResponse.json();
    console.log(`[Apify] Retrieved ${items.length} comments`);

    // Transform to our format
    const comments = items.map((item: any) => ({
      id: item.id || item.commentId || String(Date.now() + Math.random()),
      text: item.text || "",
      ownerUsername: item.ownerUsername || "unknown",
      ownerId: item.ownerId || "unknown",
      timestamp: item.timestamp || new Date().toISOString(),
    }));

    return comments;
  } catch (e: any) {
    console.error("[Apify] getComments error:", e?.message || e);
    return [];
  }
}

// Get media ID from URL (extract shortcode)
export async function resolveMediaId(url: string): Promise<string | null> {
  const match = url.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
  if (!match) return null;
  return match[2]; // Return shortcode as media_id
}

// Get media info
export async function getMediaInfo(url: string) {
  const shortcode = await resolveMediaId(url);
  if (!shortcode) return null;

  console.log("[Apify] Getting media info for:", shortcode);

  if (!APIFY_TOKEN) {
    console.error("[Apify] APIFY_API_TOKEN not set!");
    return null;
  }

  try {
    // Use the same comments actor to get post info
    const runResponse = await fetch(
      `${APIFY_API_BASE}/acts/${INSTAGRAM_COMMENTS_ACTOR}/runs?token=${APIFY_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directUrls: [url],
          maxComments: 1, // Just need post info, not all comments
        }),
      }
    );

    if (!runResponse.ok) {
      console.error("[Apify] Failed to start actor");
      return null;
    }

    const runData = await runResponse.json();
    const runId = runData.data.id;

    // Wait for completion
    let attempts = 0;
    let status = "RUNNING";

    while (status === "RUNNING" && attempts < 15) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const statusResponse = await fetch(
        `${APIFY_API_BASE}/actor-runs/${runId}?token=${APIFY_TOKEN}`
      );
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        status = statusData.data.status;
      }
      attempts++;
    }

    if (status !== "SUCCEEDED") {
      return null;
    }

    // Get dataset
    const datasetId = runData.data.defaultDatasetId;
    const datasetResponse = await fetch(
      `${APIFY_API_BASE}/datasets/${datasetId}/items?token=${APIFY_TOKEN}`
    );

    if (!datasetResponse.ok) {
      return null;
    }

    const items = await datasetResponse.json();
    if (items.length > 0) {
      const item = items[0];
      return {
        id: shortcode,
        caption: item.postCaption || item.caption || "",
        url: url,
      };
    }

    return { id: shortcode, caption: "", url: url };
  } catch (e: any) {
    console.error("[Apify] getMediaInfo error:", e?.message || e);
    return null;
  }
}

// === Writing operations use instagram-private-api ===

let cachedIgClient: any = null;

async function getIgClient() {
  if (cachedIgClient) return cachedIgClient;

  const { data: settings } = await supabase
    .from("ig_settings")
    .select("*")
    .eq("id", 1)
    .single();

  if (!settings?.username) {
    throw new Error("Instagram username not configured");
  }

  const username = settings.username;
  const password = process.env.IG_PASSWORD;

  if (!password) {
    throw new Error("IG_PASSWORD not set");
  }

  const ig = new IgApiClient();
  ig.state.generateDevice(username);

  // Try to restore session
  if (settings.session) {
    try {
      await ig.state.deserialize(settings.session);
      await ig.account.currentUser();
      cachedIgClient = ig;
      console.log("[IG] Session restored");
      return ig;
    } catch {
      console.log("[IG] Session expired, logging in fresh");
    }
  }

  // Fresh login
  await ig.simulate.preLoginFlow();
  await ig.account.login(username, password);
  await ig.simulate.postLoginFlow();

  // Save session
  const serialized = await ig.state.serialize();
  await supabase
    .from("ig_settings")
    .update({ session: serialized, is_connected: true })
    .eq("id", 1);

  cachedIgClient = ig;
  console.log("[IG] Logged in successfully");
  return ig;
}

// Reply to comment (uses instagram-private-api for writing)
export async function replyToComment(mediaId: string, text: string): Promise<boolean> {
  try {
    const ig = await getIgClient();

    // Convert shortcode to numeric ID if needed
    // For now, we'll try with shortcode directly
    await ig.media.comment({ mediaId, text });
    console.log("[IG] Comment reply sent");
    return true;
  } catch (e: any) {
    console.error("[IG] replyToComment error:", e?.message || e);
    return false;
  }
}

// Send DM (uses instagram-private-api for writing)
export async function sendDM(userId: string, text: string): Promise<boolean> {
  try {
    const ig = await getIgClient();
    const thread = ig.entity.directThread([userId]);
    await thread.broadcastText(text);
    console.log("[IG] DM sent");
    return true;
  } catch (e: any) {
    console.error("[IG] sendDM error:", e?.message || e);
    return false;
  }
}

// Helper functions
export async function isProcessed(commentId: string): Promise<boolean> {
  const { data } = await supabase
    .from("ig_processed_comments")
    .select("comment_id")
    .eq("comment_id", commentId)
    .maybeSingle();
  return !!data;
}

export async function markProcessed(commentId: string) {
  await supabase.from("ig_processed_comments").insert({ comment_id: commentId });
}

export async function updateSettings(updates: Record<string, any>) {
  await supabase
    .from("ig_settings")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", 1);
}

export { supabase };
