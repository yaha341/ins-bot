// Apify Instagram API client
// Uses Apify's Instagram scraper to get comments and send replies

import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const APIFY_API_BASE = "https://api.apify.com/v2";
const APIFY_TOKEN = process.env.APIFY_API_TOKEN;

// Instagram scraper actor ID - using tilde format for Apify Store actors
const INSTAGRAM_SCRAPER_ACTOR = "apify~instagram-scraper";

// Alternative: can also use full actor ID if the above doesn't work
// const INSTAGRAM_SCRAPER_ACTOR = "Uz0Mrp42TmkGG6kWX"; // Instagram Scraper actor ID

if (!APIFY_TOKEN) {
  console.warn("[Apify] No APIFY_API_TOKEN found. Instagram features will not work.");
}

interface ApifyComment {
  id: string;
  text: string;
  ownerUsername: string;
  ownerId: string;
  timestamp: string;
}

// Run Apify actor and wait for results
async function runActor(actorId: string, input: any): Promise<any> {
  if (!APIFY_TOKEN) {
    throw new Error("APIFY_API_TOKEN not configured");
  }

  // Start actor run
  const runResponse = await fetch(
    `${APIFY_API_BASE}/acts/${actorId}/runs?token=${APIFY_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );

  const runData = await runResponse.json();

  if (!runData.data?.id) {
    console.error("[Apify] Failed to start actor:", runData);
    throw new Error("Failed to start Apify actor");
  }

  const runId = runData.data.id;
  console.log("[Apify] Actor run started:", runId);

  // Wait for run to finish (poll status)
  let status = "RUNNING";
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes max wait

  while (status === "RUNNING" && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // wait 5 seconds

    const statusResponse = await fetch(
      `${APIFY_API_BASE}/acts/${actorId}/runs/${runId}?token=${APIFY_TOKEN}`
    );
    const statusData = await statusResponse.json();
    status = statusData.data?.status;
    attempts++;

    console.log(`[Apify] Actor status: ${status} (attempt ${attempts})`);
  }

  if (status !== "SUCCEEDED") {
    throw new Error(`Apify actor failed with status: ${status}`);
  }

  // Get results from default dataset
  const resultsResponse = await fetch(
    `${APIFY_API_BASE}/acts/${actorId}/runs/${runId}/dataset/items?token=${APIFY_TOKEN}`
  );

  const results = await resultsResponse.json();
  return results;
}

// Get comments for a post by URL
export async function getComments(postUrl: string): Promise<ApifyComment[]> {
  console.log("[Apify] Getting comments for:", postUrl);

  if (!APIFY_TOKEN) {
    console.error("[Apify] APIFY_API_TOKEN not set!");
    return [];
  }

  try {
    console.log("[Apify] Starting actor:", INSTAGRAM_SCRAPER_ACTOR);

    // Use main instagram-scraper to get post WITH comments
    const results = await runActor(INSTAGRAM_SCRAPER_ACTOR, {
      directUrls: [postUrl],
      resultsType: "posts",
      resultsLimit: 1,
      addParentData: false,
      enhanceUserSearchWithFacebookPage: false,
      isUserTaggedFeedURL: false,
      onlyPostsNewerThan: "",
      scrapePostComments: true, // KEY: Enable comment scraping
      scrapePostCommentsCount: 100, // Get up to 100 comments
    });

    console.log("[Apify] Actor completed, results:", JSON.stringify(results).slice(0, 500));

    if (!Array.isArray(results)) {
      console.error("[Apify] Invalid results format:", results);
      return [];
    }

    // Transform Apify format to our format
    const comments: ApifyComment[] = [];

    // instagram-scraper returns post data with latestComments array
    for (const post of results) {
      if (post.latestComments && Array.isArray(post.latestComments)) {
        for (const comment of post.latestComments) {
          comments.push({
            id: comment.id || String(Date.now() + Math.random()),
            text: comment.text || "",
            ownerUsername: comment.ownerUsername || comment.username || "unknown",
            ownerId: comment.ownerId || comment.userId || "unknown",
            timestamp: comment.timestamp || new Date().toISOString(),
          });
        }
      }
    }

    console.log(`[Apify] Found ${comments.length} comments`);
    return comments;
  } catch (e: any) {
    console.error("[Apify] getComments error:", e?.message || e);
    return [];
  }
}

// Get media ID from URL (extract from URL structure)
export async function resolveMediaId(url: string): Promise<string | null> {
  // Instagram URLs: https://www.instagram.com/p/ABC123/ or /reel/ABC123/
  const match = url.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);

  if (!match) {
    console.error("[Apify] Could not extract shortcode from URL:", url);
    return null;
  }

  const shortcode = match[2];

  // For Apify, we'll use the URL directly, but return shortcode as "media_id"
  console.log("[Apify] Extracted shortcode:", shortcode);
  return shortcode;
}

// Get media info
export async function getMediaInfo(mediaIdOrUrl: string) {
  let url = mediaIdOrUrl;

  // If it's a shortcode, convert to URL
  if (!mediaIdOrUrl.startsWith("http")) {
    url = `https://www.instagram.com/p/${mediaIdOrUrl}/`;
  }

  console.log("[Apify] Getting media info for:", url);

  try {
    const results = await runActor(INSTAGRAM_SCRAPER_ACTOR, {
      directUrls: [url],
      resultsType: "posts",
      resultsLimit: 1,
    });

    if (!Array.isArray(results) || results.length === 0) {
      console.error("[Apify] No media info found");
      return null;
    }

    const post = results[0];
    return {
      id: post.id || post.shortCode,
      caption: post.caption || "",
      url: post.url || url,
      timestamp: post.timestamp,
    };
  } catch (e) {
    console.error("[Apify] getMediaInfo error:", e);
    return null;
  }
}

// NOTE: Apify Instagram scraper is read-only
// For WRITING (replies, DMs) we need instagram-private-api or another service
// Option 1: Keep instagram-private-api just for writing
// Option 2: Use a different service for writing (e.g., InstagramAPI on RapidAPI)
// Option 3: Use Instagram Graph API for writing

// For now, let's use instagram-private-api for writing since we already have it
// Import the old client functions for writing operations
import { IgApiClient } from "instagram-private-api";

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
      return ig;
    } catch {
      // Session expired
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
  return ig;
}

// Reply to comment (uses instagram-private-api for writing)
export async function replyToComment(mediaId: string, text: string): Promise<boolean> {
  try {
    const ig = await getIgClient();
    await ig.media.comment({ mediaId, text });
    console.log("[Apify/IG] Comment reply sent");
    return true;
  } catch (e) {
    console.error("[Apify/IG] replyToComment error:", e);
    return false;
  }
}

// Send DM (uses instagram-private-api for writing)
export async function sendDM(userId: string, text: string): Promise<boolean> {
  try {
    const ig = await getIgClient();
    const thread = ig.entity.directThread([userId]);
    await thread.broadcastText(text);
    console.log("[Apify/IG] DM sent");
    return true;
  } catch (e) {
    console.error("[Apify/IG] sendDM error:", e);
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
