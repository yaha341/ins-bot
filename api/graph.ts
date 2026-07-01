// Meta Graph API helper for Instagram
// Official API - no blocks, no password issues

import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const GRAPH_API_VERSION = "v21.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// Get stored access token from database
export async function getAccessToken(): Promise<string> {
  const { data: settings } = await supabase
    .from("ig_settings")
    .select("*")
    .eq("id", 1)
    .single();

  if (!settings?.access_token) {
    throw new Error("No Instagram access token found. Please connect your Instagram account.");
  }

  return settings.access_token;
}

// Save access token and Instagram user info
export async function saveAccessToken(accessToken: string, igUserId: string, igUsername: string) {
  await supabase
    .from("ig_settings")
    .update({
      access_token: accessToken,
      ig_user_id: igUserId,
      username: igUsername,
      is_connected: true,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
}

// Clear connection
export async function clearConnection() {
  await supabase
    .from("ig_settings")
    .update({
      access_token: null,
      ig_user_id: null,
      username: null,
      is_connected: false,
      session: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
}

// Get Instagram Business Account ID
export async function getIgBusinessAccountId(): Promise<string> {
  const accessToken = await getAccessToken();

  // First get connected Facebook Page
  const response = await fetch(
    `${GRAPH_API_BASE}/me/accounts?access_token=${accessToken}`
  );

  const data = await response.json();

  if (data.error) {
    throw new Error(`Graph API error: ${data.error.message}`);
  }

  if (!data.data || data.data.length === 0) {
    throw new Error("No Facebook Pages found. Please create a Facebook Page and connect it to Instagram.");
  }

  const pageId = data.data[0].id;

  // Get Instagram Business Account linked to the page
  const igResponse = await fetch(
    `${GRAPH_API_BASE}/${pageId}?fields=instagram_business_account&access_token=${accessToken}`
  );

  const igData = await igResponse.json();

  if (igData.error) {
    throw new Error(`Graph API error: ${igData.error.message}`);
  }

  if (!igData.instagram_business_account) {
    throw new Error("No Instagram Business Account linked to this Facebook Page.");
  }

  return igData.instagram_business_account.id;
}

// Get media info by shortcode or ID
export async function getMediaInfo(mediaIdOrShortcode: string) {
  const accessToken = await getAccessToken();

  // If it's a shortcode, we need to search for it
  // For now, assume it's already an ID
  const response = await fetch(
    `${GRAPH_API_BASE}/${mediaIdOrShortcode}?fields=id,caption,media_type,media_url,timestamp,permalink&access_token=${accessToken}`
  );

  const data = await response.json();

  if (data.error) {
    throw new Error(`Graph API error: ${data.error.message}`);
  }

  return data;
}

// Get comments for a media
export async function getComments(mediaId: string) {
  const accessToken = await getAccessToken();

  const response = await fetch(
    `${GRAPH_API_BASE}/${mediaId}/comments?fields=id,text,timestamp,username,from{id,username}&access_token=${accessToken}`
  );

  const data = await response.json();

  if (data.error) {
    console.error("[Graph] getComments error:", data.error);
    throw new Error(`Graph API error: ${data.error.message}`);
  }

  return data.data || [];
}

// Reply to a comment
export async function replyToComment(commentId: string, message: string): Promise<boolean> {
  const accessToken = await getAccessToken();

  try {
    const response = await fetch(
      `${GRAPH_API_BASE}/${commentId}/replies`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message,
          access_token: accessToken,
        }),
      }
    );

    const data = await response.json();

    if (data.error) {
      console.error("[Graph] replyToComment error:", data.error);
      return false;
    }

    return true;
  } catch (e) {
    console.error("[Graph] replyToComment exception:", e);
    return false;
  }
}

// Send Direct Message (Instagram Messaging API)
export async function sendDM(igUserId: string, message: string): Promise<boolean> {
  const accessToken = await getAccessToken();
  const igBusinessAccountId = await getIgBusinessAccountId();

  try {
    const response = await fetch(
      `${GRAPH_API_BASE}/${igBusinessAccountId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: igUserId },
          message: { text: message },
          access_token: accessToken,
        }),
      }
    );

    const data = await response.json();

    if (data.error) {
      console.error("[Graph] sendDM error:", data.error);
      return false;
    }

    return true;
  } catch (e) {
    console.error("[Graph] sendDM exception:", e);
    return false;
  }
}

// Convert Instagram URL to Media ID (using oembed endpoint)
export async function resolveMediaIdFromUrl(url: string): Promise<string | null> {
  try {
    // Use Instagram's oembed API (public, no auth needed)
    const response = await fetch(
      `https://graph.facebook.com/v21.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${await getAccessToken()}`
    );

    const data = await response.json();

    if (data.error || !data.media_id) {
      console.error("[Graph] resolveMediaIdFromUrl error:", data.error || "No media_id");
      return null;
    }

    return data.media_id;
  } catch (e) {
    console.error("[Graph] resolveMediaIdFromUrl exception:", e);
    return null;
  }
}

// Check if comment is already processed
export async function isProcessed(commentId: string): Promise<boolean> {
  const { data } = await supabase
    .from("ig_processed_comments")
    .select("comment_id")
    .eq("comment_id", commentId)
    .maybeSingle();
  return !!data;
}

// Mark comment as processed
export async function markProcessed(commentId: string) {
  await supabase.from("ig_processed_comments").insert({ comment_id: commentId });
}

// Update settings
export async function updateSettings(updates: Record<string, any>) {
  await supabase
    .from("ig_settings")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", 1);
}

export { supabase };
