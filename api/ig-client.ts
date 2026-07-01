// Instagram Private API helper — handles login, session persistence, comments, DMs
// Uses instagram-private-api (no Facebook app review needed)

import { createClient } from "@supabase/supabase-js";

// Validate required environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// instagram-private-api is CommonJS — dynamic import
async function getIg() {
  const ig = await import("instagram-private-api");
  const { IgApiClient } = ig;
  const client = new IgApiClient();
  return client;
}

// Load session from Supabase and restore, or login fresh
export async function getLoggedInClient() {
  const { data: settings } = await supabase
    .from("ig_settings")
    .select("*")
    .eq("id", 1)
    .single();

  if (!settings) throw new Error("IG settings not found");

  const client = await getIg();

  // We need username for state generation
  const username = settings.username || process.env.IG_USERNAME;
  if (!username) throw new Error("No IG username configured");

  console.log("[IG] Using username:", username);
  console.log("[IG] Username source:", settings.username ? "from database" : "from env");

  client.state.generateDevice(username);

  // Try to restore session
  if (settings.session) {
    try {
      await client.state.deserialize(settings.session);
      // Verify session is still valid
      try {
        await client.account.currentUser();
        console.log("[IG] Session restored successfully for", username);
        return { client, username };
      } catch (e: any) {
        console.log("[IG] Stored session expired or invalid:", e?.message);
        // session expired, fall through to login
      }
    } catch (e: any) {
      console.log("[IG] Failed to deserialize session:", e?.message);
      // bad session, fall through
    }
  }

  // Fresh login
  const password = process.env.IG_PASSWORD;
  if (!password) throw new Error("No IG password in env (IG_PASSWORD)");

  console.log("[IG] Attempting fresh login for username:", username);
  console.log("[IG] Password length:", password.length, "characters");
  console.log("[IG] Password first 3 chars:", password.substring(0, 3) + "***");

  try {
    await client.simulate.preLoginFlow();
    const loggedIn = await client.account.login(username, password);
    await client.simulate.postLoginFlow();

    console.log("[IG] Login successful");

    // Save session
    const serialized = await client.state.serialize();
    await supabase
      .from("ig_settings")
      .update({
        session: serialized,
        is_connected: true,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    return { client, username, loggedIn };
  } catch (e: any) {
    console.error("[IG] Login failed - Full error:", JSON.stringify(e, null, 2));
    console.error("[IG] Error message:", e?.message);
    console.error("[IG] Error response:", e?.response?.body);

    // Provide more detailed error message
    let errorMsg = "Instagram login failed";

    // Check response body for detailed error
    const responseBody = e?.response?.body;
    if (responseBody) {
      console.error("[IG] Instagram API response:", JSON.stringify(responseBody, null, 2));

      if (responseBody.two_factor_required) {
        errorMsg = "Instagram требует 2FA. Отключите двухфакторную аутентификацию.";
      } else if (responseBody.error_type === "bad_password") {
        errorMsg = "Неверный пароль Instagram. Попробуйте сбросить пароль и создать новый.";
      } else if (responseBody.invalid_user) {
        errorMsg = "Пользователь не найден. Проверьте username (без символа @).";
      } else if (responseBody.message) {
        errorMsg = `Instagram API: ${responseBody.message}`;
      }
    }

    if (e?.message?.includes("challenge_required")) {
      errorMsg = "Instagram требует подтверждение через email/SMS. Войдите через браузер сначала.";
    } else if (e?.message?.includes("checkpoint_required")) {
      errorMsg = "Instagram заблокировал вход. Пройдите проверку через официальное приложение.";
    } else if (e?.message?.includes("password") && !responseBody) {
      errorMsg = "Неверный пароль Instagram. Проверьте переменную IG_PASSWORD в настройках Vercel.";
    } else if (e?.message?.includes("user") && !responseBody) {
      errorMsg = "Пользователь не найден. Проверьте имя пользователя.";
    } else if (e?.message && !responseBody) {
      errorMsg = e.message;
    }

    await updateSettings({ last_error: errorMsg, is_connected: false });
    throw new Error(errorMsg);
  }
}

// Extract shortcode from Instagram URL (e.g. https://www.instagram.com/reel/ABC123/ -> ABC123)
function extractShortcode(url: string): string | null {
  const match = url.match(/(?:instagram\.com\/(?:p|reel|tv)\/)([^\/?#]+)/);
  return match?.[1] || null;
}

// Base64 encode a shortcode to an Instagram media ID
// Instagram uses base64url custom encoding: ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_ -> media ID
function shortcodeToMediaId(shortcode: string): string {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let id = BigInt(0);
  for (const char of shortcode) {
    id = id * BigInt(64) + BigInt(charset.indexOf(char));
  }
  return id.toString();
}

// Resolve media ID from URL or shortcode using base64 decoding
export async function resolveMediaId(client: any, urlOrCode: string): Promise<string | null> {
  // If it's already a numeric ID, return as-is
  if (/^\d+$/.test(urlOrCode)) return urlOrCode;

  // Extract shortcode from URL
  const shortcode = extractShortcode(urlOrCode) || urlOrCode;
  if (!shortcode) return null;

  try {
    // Convert shortcode to media ID using base64 decoding
    const mediaId = shortcodeToMediaId(shortcode);
    
    // Verify the media exists by trying to get info
    try {
      await client.media.info(mediaId);
    } catch {
      // If media info fails, try fallback
      throw new Error("media not found via ID");
    }
    
    return mediaId;
  } catch (e) {
    console.error("[IG] resolveMediaId via shortcode for", shortcode, e);
    
    // Fallback: search through recent media
    try {
      const userFeed = client.feed.userFeed(await client.user.getPK());
      const items = await userFeed.items();
      for (const item of items) {
        if (item.code === shortcode) {
          return String(item.pk || item.id);
        }
      }
    } catch (e2) {
      console.error("[IG] resolveMediaId fallback error:", e2);
    }
    
    return null;
  }
}

// Get recent media items for the logged-in user
export async function getRecentMedia(client: any, limit = 20) {
  const userFeed = client.feed.userFeed(await client.user.getPK());
  const items = await userFeed.items();
  return items.slice(0, limit);
}

// Get media info by ID
export async function getMediaInfo(client: any, mediaId: string) {
  try {
    return await client.media.info(mediaId);
  } catch (e) {
    console.error("[IG] getMediaInfo error:", e);
    return null;
  }
}

// Get comments for a media item
export async function getComments(client: any, mediaId: string) {
  const commentsFeed = client.feed.mediaComments(mediaId);
  const comments = await commentsFeed.items();
  return comments;
}

// Reply to a comment (posts a new comment on the media)
export async function replyToComment(client: any, mediaId: string, text: string) {
  try {
    await client.media.comment({ mediaId, text });
    return true;
  } catch (e) {
    console.error("[IG] replyToComment error:", e);
    return false;
  }
}

// Send a direct message to a user by PK
export async function sendDirect(client: any, userPk: string | number, text: string): Promise<boolean> {
  try {
    const thread = client.entity.directThread([userPk.toString()]);
    await thread.broadcastText(text);
    return true;
  } catch (e: any) {
    console.error("[IG] sendDirect error:", e?.message || e);
    return false;
  }
}

// Mark a comment as processed
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

// Update settings
export async function updateSettings(updates: Record<string, any>) {
  await supabase
    .from("ig_settings")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", 1);
}

export { supabase };