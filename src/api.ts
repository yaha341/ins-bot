const API_BASE = "/api/admin";

async function api(action: string, method: string = "GET", body?: any) {
  const opts: RequestInit = { method, credentials: "include" };
  if (body) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}?action=${action}`, opts);
  if (res.status === 401) throw new Error("NOT_AUTHED");
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export async function checkAuth(): Promise<boolean> {
  try {
    const res = await api("check");
    return res.authed === true;
  } catch {
    return false;
  }
}

export async function login(login: string, password: string) {
  return api("login", "POST", { login, password });
}

export async function logout() {
  return api("logout", "POST");
}

export type Rule = {
  id: string;
  media_id: string;
  media_url: string;
  media_title: string;
  keywords: string[];
  dm_message: string;
  dm_fail_reply: string;
  comment_reply: string;
  is_active: boolean;
  created_at: string;
};

export async function listRules(): Promise<Rule[]> {
  return api("rules");
}

export async function saveRule(data: Partial<Rule> & { media_id: string }) {
  return api("save_rule", "POST", data);
}

export async function deleteRule(id: string) {
  return api("delete_rule", "POST", { id });
}

export async function toggleRule(id: string, is_active: boolean) {
  return api("toggle_rule", "POST", { id, is_active });
}

export type Trigger = {
  id: string;
  media_id: string;
  comment_id: string;
  comment_text: string;
  sender_ig_id: string;
  triggered_at: string;
  ig_rules?: { media_title: string } | null;
};

export async function listTriggers(): Promise<Trigger[]> {
  return api("triggers");
}

export type IgStatus = {
  username: string | null;
  is_connected: boolean;
  last_poll: string | null;
  last_error: string | null;
  updated_at: string | null;
};

export async function getIgStatus(): Promise<IgStatus> {
  return api("ig_status");
}

export async function igConnect(username: string): Promise<{ ok: boolean; message: string }> {
  return api("ig_connect", "POST", { username });
}

export async function igDisconnect() {
  return api("ig_disconnect", "POST");
}

export async function resolveMediaId(url: string): Promise<{ media_id: string; media_title: string }> {
  return api("resolve_media_id", "POST", { url });
}
