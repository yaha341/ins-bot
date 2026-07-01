import { createClient } from "@supabase/supabase-js";
import { getMediaInfo, resolveMediaId, updateSettings } from "./apify-client.js";

// Validate required environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ADMIN_LOGIN = process.env.ADMIN_LOGIN || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const SESSION_COOKIE = "ig_admin_session";
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || "ig-admin-default-secret";

function checkAuth(req: any): boolean {
  const cookie = req.headers?.cookie || "";
  const match = cookie.match(new RegExp(SESSION_COOKIE + "=([^;]+)"));
  return match?.[1] === SESSION_SECRET;
}

function setSessionCookie(res: any) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${SESSION_SECRET};Path=/;HttpOnly;SameSite=Lax;Max-Age=604800`
  );
}

function clearSessionCookie(res: any) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=;Path=/;HttpOnly;Max-Age=0`);
}

export default async function handler(req: any, res: any) {
  // ----- AUTH ROUTES (no session required) -----

  // Login
  if (req.method === "POST" && req.query.action === "login") {
    const { login, password } = req.body || {};
    if (login === ADMIN_LOGIN && password === ADMIN_PASSWORD) {
      setSessionCookie(res);
      return res.json({ ok: true });
    }
    return res.status(401).json({ error: "Неверный логин или пароль" });
  }

  // Logout
  if (req.method === "POST" && req.query.action === "logout") {
    clearSessionCookie(res);
    return res.json({ ok: true });
  }

  // Check auth
  if (req.query.action === "check") {
    return res.json({ authed: checkAuth(req) });
  }

  // ----- PROTECTED ROUTES (require auth) -----
  if (!checkAuth(req)) {
    return res.status(401).json({ error: "Not authorized" });
  }

  // List rules
  if (req.method === "GET" && req.query.action === "rules") {
    const { data } = await supabase
      .from("ig_rules")
      .select("*")
      .order("created_at", { ascending: false });
    return res.json(data ?? []);
  }

  // Save rule
  if (req.method === "POST" && req.query.action === "save_rule") {
    const { id, ...rest } = req.body;
    if (id) {
      const { error } = await supabase.from("ig_rules").update(rest).eq("id", id);
      if (error) return res.status(400).json({ error: error.message });
    } else {
      const { error } = await supabase.from("ig_rules").insert(rest);
      if (error) return res.status(400).json({ error: error.message });
    }
    return res.json({ ok: true });
  }

  // Delete rule
  if (req.method === "POST" && req.query.action === "delete_rule") {
    const { id } = req.body;
    await supabase.from("ig_rules").delete().eq("id", id);
    return res.json({ ok: true });
  }

  // Toggle rule
  if (req.method === "POST" && req.query.action === "toggle_rule") {
    const { id, is_active } = req.body;
    await supabase.from("ig_rules").update({ is_active }).eq("id", id);
    return res.json({ ok: true });
  }

  // List triggers (log)
  if (req.method === "GET" && req.query.action === "triggers") {
    const { data } = await supabase
      .from("ig_triggers")
      .select("*, ig_rules(media_title)")
      .order("triggered_at", { ascending: false })
      .limit(100);
    return res.json(data ?? []);
  }

  // IG connection status
  if (req.method === "GET" && req.query.action === "ig_status") {
    const { data } = await supabase
      .from("ig_settings")
      .select("username, is_connected, last_poll, last_error, updated_at")
      .eq("id", 1)
      .single();
    return res.json(data ?? { is_connected: false });
  }

  // IG connect - simple username setup (no OAuth needed for Apify)
  if (req.method === "POST" && req.query.action === "ig_connect") {
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ error: "Username required" });

    await updateSettings({ username, is_connected: true, last_error: null });
    return res.json({ ok: true, message: "Instagram подключен" });
  }

  // IG disconnect
  if (req.method === "POST" && req.query.action === "ig_disconnect") {
    await updateSettings({
      username: null,
      is_connected: false,
      last_error: null,
    });
    return res.json({ ok: true });
  }

  // Resolve media ID from URL
  if (req.method === "POST" && req.query.action === "resolve_media_id") {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: "URL required" });

    try {
      console.log("[Admin] Resolving media ID for URL:", url);

      const mediaId = await resolveMediaId(url);

      if (!mediaId) {
        return res.status(400).json({ error: "Не удалось определить Media ID по этой ссылке" });
      }

      console.log("[Admin] Media ID resolved:", mediaId);

      let title = "";
      try {
        const info = await getMediaInfo(url);
        if (info?.caption) {
          title = info.caption.slice(0, 100);
        }
      } catch (e) {
        console.log("[Admin] Could not fetch media title:", e);
      }

      return res.json({ media_id: mediaId, media_title: title });
    } catch (e: any) {
      console.error("[Admin] resolve_media_id error:", e?.message || e);
      return res.status(400).json({ error: e?.message || "Ошибка при определении Media ID" });
    }
  }

  // Test IG connection (for Apify, just check if credentials are set)
  if (req.method === "POST" && req.query.action === "test_ig_connection") {
    try {
      console.log("[Admin] Testing IG connection...");

      if (!process.env.APIFY_API_TOKEN) {
        throw new Error("APIFY_API_TOKEN не настроен в переменных окружения");
      }

      if (!process.env.IG_PASSWORD) {
        throw new Error("IG_PASSWORD не настроен (нужен для отправки ответов)");
      }

      const { data: settings } = await supabase
        .from("ig_settings")
        .select("username")
        .eq("id", 1)
        .single();

      if (!settings?.username) {
        throw new Error("Instagram username не настроен");
      }

      return res.json({
        ok: true,
        message: "Подключение готово к работе",
        username: settings.username
      });
    } catch (e: any) {
      console.error("[Admin] test_ig_connection error:", e?.message || e);
      return res.status(400).json({ error: e?.message || "Тест подключения не удался" });
    }
  }

  res.status(404).json({ error: "Not found" });
}