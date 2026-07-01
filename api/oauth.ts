// OAuth flow for Instagram Graph API connection
import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required env vars");
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Facebook App credentials (set in Vercel env vars)
const FB_APP_ID = process.env.FB_APP_ID;
const FB_APP_SECRET = process.env.FB_APP_SECRET;
const REDIRECT_URI = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}/api/oauth`
  : "http://localhost:3000/api/oauth";

export default async function handler(req: any, res: any) {
  // Step 1: User clicks "Connect Instagram" → redirect to Facebook OAuth
  if (req.query.action === "start") {
    if (!FB_APP_ID) {
      return res.status(500).json({ error: "FB_APP_ID not configured" });
    }

    const scope = [
      "instagram_basic",
      "instagram_manage_comments",
      "instagram_manage_messages",
      "pages_show_list",
      "pages_read_engagement",
    ].join(",");

    const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scope}&response_type=code`;

    return res.redirect(authUrl);
  }

  // Step 2: Facebook redirects back with code
  if (req.query.code) {
    const code = req.query.code;

    if (!FB_APP_ID || !FB_APP_SECRET) {
      return res.status(500).json({ error: "FB_APP_ID or FB_APP_SECRET not configured" });
    }

    try {
      // Exchange code for access token
      const tokenResponse = await fetch(
        `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${FB_APP_ID}&client_secret=${FB_APP_SECRET}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code=${code}`
      );

      const tokenData = await tokenResponse.json();

      if (tokenData.error) {
        console.error("[OAuth] Token exchange error:", tokenData.error);
        return res.status(400).send(`Error: ${tokenData.error.message}`);
      }

      const accessToken = tokenData.access_token;

      // Get user's Facebook Pages
      const pagesResponse = await fetch(
        `https://graph.facebook.com/v21.0/me/accounts?access_token=${accessToken}`
      );

      const pagesData = await pagesResponse.json();

      if (pagesData.error || !pagesData.data || pagesData.data.length === 0) {
        return res.status(400).send(
          "No Facebook Pages found. Please create a Facebook Page and connect it to your Instagram Business account."
        );
      }

      const pageAccessToken = pagesData.data[0].access_token;
      const pageId = pagesData.data[0].id;

      // Get Instagram Business Account ID linked to the page
      const igResponse = await fetch(
        `https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`
      );

      const igData = await igResponse.json();

      if (igData.error || !igData.instagram_business_account) {
        return res.status(400).send(
          "No Instagram Business Account linked to your Facebook Page. Please connect your Instagram account to your Facebook Page."
        );
      }

      const igBusinessAccountId = igData.instagram_business_account.id;

      // Get Instagram username
      const igUserResponse = await fetch(
        `https://graph.facebook.com/v21.0/${igBusinessAccountId}?fields=username&access_token=${pageAccessToken}`
      );

      const igUserData = await igUserResponse.json();

      if (igUserData.error) {
        return res.status(400).send(`Error fetching Instagram info: ${igUserData.error.message}`);
      }

      const igUsername = igUserData.username;

      // Save to database
      await supabase
        .from("ig_settings")
        .update({
          access_token: pageAccessToken,
          ig_user_id: igBusinessAccountId,
          username: igUsername,
          is_connected: true,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1);

      console.log("[OAuth] Successfully connected Instagram account:", igUsername);

      // Redirect back to admin panel
      return res.redirect("/?connected=true");
    } catch (e: any) {
      console.error("[OAuth] Error:", e);
      return res.status(500).send(`Error: ${e.message}`);
    }
  }

  // Error from Facebook OAuth
  if (req.query.error) {
    console.error("[OAuth] Facebook OAuth error:", req.query.error_description);
    return res.status(400).send(`Error: ${req.query.error_description || req.query.error}`);
  }

  return res.status(400).json({ error: "Invalid request" });
}
