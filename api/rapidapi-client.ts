// RapidAPI Instagram client
// Uses Instagram Bulk Profile Scraper API from RapidAPI

import { createClient } from "@supabase/supabase-js";
import { IgApiClient } from "instagram-private-api";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = "instagram-bulk-profile-scrapper.p.rapidapi.com";

interface RapidComment {
  id: string;
  text: string;
  owner: {
    username: string;
    id: string;
  };
  created_at: number;
}

// Get comments for a post by URL
export async function getComments(postUrl: string): Promise<any[]> {
  console.log("[RapidAPI] Getting comments for:", postUrl);

  if (!RAPIDAPI_KEY) {
    console.error("[RapidAPI] RAPIDAPI_KEY not set!");
    return [];
  }

  // Extract shortcode from URL
  const match = postUrl.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
  if (!match) {
    console.error("[RapidAPI] Could not extract shortcode from URL:", postUrl);
    return [];
  }

  const shortcode = match[2];
  console.log("[RapidAPI] Shortcode:", shortcode);

  try {
    // Get post comments via RapidAPI
    const response = await fetch(
      `https://${RAPIDAPI_HOST}/clients/api/ig/media_comments?code_or_id_or_url=${shortcode}&amount=100`,
      {
        method: "GET",
        headers: {
          "X-RapidAPI-Key": RAPIDAPI_KEY,
          "X-RapidAPI-Host": RAPIDAPI_HOST,
        },
      }
    );

    if (!response.ok) {
      console.error("[RapidAPI] HTTP error:", response.status, response.statusText);
      return [];
    }

    const data = await response.json();
    console.log("[RapidAPI] Response:", JSON.stringify(data).slice(0, 500));

    if (!data || !Array.isArray(data)) {
      console.error("[RapidAPI] Invalid response format");
      return [];
    }

    // Transform to our format
    const comments = data.map((comment: any) => ({
      id: comment.pk || comment.id || String(Date.now() + Math.random()),
      text: comment.text || "",
      ownerUsername: comment.user?.username || "unknown",
      ownerId: comment.user?.pk || comment.user?.id || "unknown",
      timestamp: comment.created_at ? new Date(comment.created_at * 1000).toISOString() : new Date().toISOString(),
    }));

    console.log(`[RapidAPI] Found ${comments.length} comments`);
    return comments;
  } catch (e: any) {
    console.error("[RapidAPI] getComments error:", e?.message || e);
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

  console.log("[RapidAPI] Getting media info for:", shortcode);

  if (!RAPIDAPI_KEY) {
    console.error("[RapidAPI] RAPIDAPI_KEY not set!");
    return null;
  }

  try {
    const response = await fetch(
      `https://${RAPIDAPI_HOST}/clients/api/ig/media_info_v2?code_or_id_or_url=${shortcode}`,
      {
        method: "GET",
        headers: {
          "X-RapidAPI-Key": RAPIDAPI_KEY,
          "X-RapidAPI-Host": RAPIDAPI_HOST,
        },
      }
    );

    if (!response.ok) {
      console.error("[RapidAPI] HTTP error:", response.status);
      return null;
    }

    const data = await response.json();
    return {
      id: data.code || shortcode,
      caption: data.caption?.text || "",
      url: url,
    };
  } catch (e: any) {
    console.error("[RapidAPI] getMediaInfo error:", e?.message || e);
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
