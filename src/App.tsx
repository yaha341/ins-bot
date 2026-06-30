import { useState, useEffect, useCallback } from "react";
import {
  checkAuth, login as apiLogin, logout as apiLogout,
  listRules, saveRule, deleteRule, toggleRule,
  listTriggers, getIgStatus, igConnect, igDisconnect, resolveMediaId,
  type Rule, type Trigger, type IgStatus,
} from "./api";

/* ====== TOAST NOTIFICATIONS ====== */
type Toast = { id: number; message: string; type: "success" | "error" | "info" };
let toastId = 0;

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  useEffect(() => {
    toasts.forEach((toast) => {
      const timer = setTimeout(() => onRemove(toast.id), 4000);
      return () => clearTimeout(timer);
    });
  }, [toasts, onRemove]);

  return (
    <div style={{
      position: "fixed",
      top: 20,
      right: 20,
      zIndex: 9999,
      display: "flex",
      flexDirection: "column",
      gap: 12,
      maxWidth: 400,
    }}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`alert ${toast.type === "error" ? "alert-warning" : ""}`}
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            background: toast.type === "success" ? "#10b981" : toast.type === "error" ? "#ef4444" : "#3b82f6",
            color: "white",
            cursor: "pointer",
          }}
          onClick={() => onRemove(toast.id)}
        >
          <span>{toast.type === "success" ? "✓" : toast.type === "error" ? "⚠️" : "ℹ️"}</span>
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

/* ====== LOGIN PAGE ====== */
function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [user, setUser] = useState("admin");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await apiLogin(user, pass);
      onLogin();
    } catch (err: any) {
      setError(err.message || "Ошибка входа");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrapper">
      <div className="login-card">
        <div className="login-brand">
          <h1>📸 Instagram Бот</h1>
          <p>Панель управления</p>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <input
            className="input"
            placeholder="Логин"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
          <input
            className="input"
            type="password"
            placeholder="Пароль"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
          {error && <div className="login-error">{error}</div>}
          <button className="btn btn-primary" disabled={loading} style={{ width: "100%" }}>
            {loading ? "Вхожу..." : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ====== RULE EDITOR MODAL ====== */
const DEFAULT_COMMENT = "Ответила вам в личные сообщения 😊";
const DEFAULT_FAIL = "Не смогла отправить вам сообщение — у вас закрытый аккаунт. Напишите мне, пожалуйста, в личные сообщения 🙏";

type RuleForm = Omit<Rule, "id" | "created_at"> & { id?: string };

function RuleEditor({ rule, onSave, onClose, showToast }: {
  rule: RuleForm;
  onSave: (r: RuleForm) => void;
  onClose: () => void;
  showToast: (msg: string, type: "success" | "error") => void;
}) {
  const [form, setForm] = useState<RuleForm>(rule);
  const [kwInput, setKwInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);

  function addKeyword() {
    const kw = kwInput.trim().toLowerCase();
    if (!kw) return;
    if (!form.keywords.includes(kw)) {
      setForm({ ...form, keywords: [...form.keywords, kw] });
    }
    setKwInput("");
  }

  function removeKeyword(kw: string) {
    setForm({ ...form, keywords: form.keywords.filter((k) => k !== kw) });
  }

  async function handleResolve() {
    if (!form.media_url.trim()) {
      showToast("Вставьте ссылку на пост", "error");
      return;
    }
    setResolving(true);
    try {
      const result = await resolveMediaId(form.media_url);
      setForm({
        ...form,
        media_id: result.media_id,
        media_title: result.media_title || form.media_title,
      });
      showToast("Media ID успешно определён", "success");
    } catch (e: any) {
      showToast(e.message || "Не удалось определить Media ID", "error");
    } finally {
      setResolving(false);
    }
  }

  async function handleSave() {
    if (!form.media_id.trim()) {
      showToast("Укажите Media ID", "error");
      return;
    }
    if (form.keywords.length === 0) {
      showToast("Добавьте хотя бы одно кодовое слово", "error");
      return;
    }
    if (!form.dm_message.trim()) {
      showToast("Введите текст для Direct", "error");
      return;
    }

    setSaving(true);
    try {
      await onSave(form);
      showToast("Правило сохранено", "success");
    } catch (e: any) {
      showToast(e.message || "Ошибка сохранения", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          {form.id ? "✏️ Редактировать правило" : "➕ Новое правило"}
        </div>
        <div className="modal-body">
          <div>
            <label className="label">Ссылка на пост / Reels</label>
            <div className="keyword-input-row">
              <input
                className="input"
                placeholder="https://www.instagram.com/reel/ABC123/"
                value={form.media_url}
                onChange={(e) => setForm({ ...form, media_url: e.target.value })}
              />
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleResolve}
                disabled={resolving}
              >
                {resolving ? "⏳ Определяю..." : "🔍 Определить"}
              </button>
            </div>
          </div>

          <div>
            <label className="label">
              Media ID <span className="label-hint">(определяется автоматически)</span>
            </label>
            <input
              className="input input-mono"
              placeholder="17895695668004550"
              value={form.media_id}
              onChange={(e) => setForm({ ...form, media_id: e.target.value })}
            />
            <p className="hint">
              Вставьте ссылку на пост выше и нажмите "Определить" — ID подтянется сам
            </p>
          </div>

          <div>
            <label className="label">Название <span className="label-hint">(для вас)</span></label>
            <input
              className="input"
              placeholder="Reels про математику 1 класс"
              value={form.media_title}
              onChange={(e) => setForm({ ...form, media_title: e.target.value })}
            />
          </div>

          <div>
            <label className="label">🔑 Кодовые слова</label>
            <div className="keyword-input-row">
              <input
                className="input"
                placeholder="Введите слово и нажмите Enter"
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKeyword())}
              />
              <button className="btn btn-ghost btn-sm" onClick={addKeyword}>+</button>
            </div>
            <div className="keyword-chips">
              {form.keywords.map((kw) => (
                <span key={kw} className="keyword-chip">
                  🔑 {kw}
                  <button onClick={() => removeKeyword(kw)}>×</button>
                </span>
              ))}
              {form.keywords.length === 0 && (
                <span className="keyword-empty">Слова не добавлены</span>
              )}
            </div>
            <p className="hint">Регистр не важен. Слово ищется внутри комментария.</p>
          </div>

          <div>
            <label className="label">💬 Ответ в комментарий</label>
            <input
              className="input"
              value={form.comment_reply}
              onChange={(e) => setForm({ ...form, comment_reply: e.target.value })}
            />
          </div>

          <div>
            <label className="label">✉️ Сообщение в Direct</label>
            <textarea
              className="textarea"
              placeholder="Привет! Вот ссылка на материалы: https://..."
              value={form.dm_message}
              onChange={(e) => setForm({ ...form, dm_message: e.target.value })}
            />
            <p className="hint">Ссылки будут кликабельными в Direct.</p>
          </div>

          <div>
            <label className="label">🚫 Ответ если DM не доставлен <span className="label-hint">(закрытый аккаунт)</span></label>
            <input
              className="input"
              value={form.dm_fail_reply}
              onChange={(e) => setForm({ ...form, dm_fail_reply: e.target.value })}
            />
          </div>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            Правило активно
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Сохраняю..." : "💾 Сохранить"}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

/* ====== IG CONNECTION PANEL ====== */
function IgConnectionPanel({ showToast }: { showToast: (msg: string, type: "success" | "error") => void }) {
  const [status, setStatus] = useState<IgStatus | null>(null);
  const [username, setUsername] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getIgStatus().then(setStatus).catch(() => {
      showToast("Не удалось загрузить статус Instagram", "error");
    });
  }, [showToast]);

  async function handleConnect() {
    if (!username.trim()) return;
    setConnecting(true);
    setError("");
    try {
      await igConnect(username.trim());
      const s = await getIgStatus();
      setStatus(s);
      showToast("Instagram подключён успешно", "success");
    } catch (e: any) {
      const msg = e.message || "Ошибка подключения";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Отключить Instagram аккаунт?")) return;
    try {
      await igDisconnect();
      setStatus({ username: null, is_connected: false, last_poll: null, last_error: null, updated_at: null });
      showToast("Instagram отключён", "success");
    } catch (e: any) {
      showToast(e.message || "Ошибка отключения", "error");
    }
  }

  const isConnected = status?.is_connected;

  return (
    <div className="card" style={{ maxWidth: 500 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>{isConnected ? "✅" : "🔌"}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            {isConnected ? "Instagram подключён" : "Instagram не подключён"}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {isConnected
              ? `@${status.username}`
              : "Подключите аккаунт для работы бота"
            }
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-warning" style={{ marginBottom: 12 }}>
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {isConnected ? (
        <>
          <div className="stack-sm" style={{ marginBottom: 16 }}>
            {status.last_poll && (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Последняя проверка: {new Date(status.last_poll).toLocaleString("ru")}
              </div>
            )}
            {status.last_error && (
              <div style={{ fontSize: 13, color: "var(--danger)" }}>
                Ошибка: {status.last_error}
              </div>
            )}
          </div>
          <button className="btn btn-danger btn-sm" onClick={handleDisconnect}>
            Отключить
          </button>
        </>
      ) : (
        <div className="stack-sm">
          <div>
            <label className="label">Логин Instagram</label>
            <input
              className="input"
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <p className="hint">
              Пароль укажите в переменной IG_PASSWORD в настройках Vercel
            </p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleConnect} disabled={connecting}>
            {connecting ? "Подключаюсь..." : "Подключить"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ====== DASHBOARD ====== */
function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [tab, setTab] = useState<"rules" | "log" | "settings">("rules");
  const [editing, setEditing] = useState<RuleForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    const id = toastId++;
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [r, t] = await Promise.all([listRules(), listTriggers()]);
      setRules(r);
      setTriggers(t);
    } catch (e: any) {
      if (e.message === "NOT_AUTHED") {
        onLogout();
      } else {
        showToast(e.message || "Ошибка загрузки данных", "error");
      }
    } finally {
      setLoading(false);
    }
  }, [onLogout, showToast]);

  useEffect(() => { refresh(); }, [refresh]);

  function openNew() {
    setEditing({
      media_id: "",
      media_url: "",
      media_title: "",
      keywords: [],
      dm_message: "",
      dm_fail_reply: DEFAULT_FAIL,
      comment_reply: DEFAULT_COMMENT,
      is_active: true,
    });
  }

  async function handleSave(form: RuleForm) {
    try {
      await saveRule(form);
      setEditing(null);
      refresh();
    } catch (e: any) {
      showToast(e.message || "Ошибка сохранения", "error");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Удалить правило?")) return;
    try {
      await deleteRule(id);
      refresh();
      showToast("Правило удалено", "success");
    } catch (e: any) {
      showToast(e.message || "Ошибка удаления", "error");
    }
  }

  async function handleToggle(id: string, val: boolean) {
    try {
      await toggleRule(id, val);
      refresh();
      showToast(val ? "Правило включено" : "Правило выключено", "success");
    } catch (e: any) {
      showToast(e.message || "Ошибка переключения", "error");
    }
  }

  async function handleLogout() {
    await apiLogout();
    onLogout();
  }

  return (
    <>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <header className="app-header">
        <div className="header-inner">
          <div className="header-brand">📸 Instagram Бот</div>
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Выйти</button>
          </div>
        </div>
      </header>

      <main className="main-content">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>Управление ботом</h1>
            <p style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 4 }}>
              Автоответы по кодовым словам в комментариях
            </p>
          </div>
          <button className="btn btn-primary" onClick={openNew}>+ Добавить правило</button>
        </div>

        <div className="tabs">
          <button className={`tab ${tab === "rules" ? "tab-active" : ""}`} onClick={() => setTab("rules")}>
            📋 Правила ({rules.length})
          </button>
          <button className={`tab ${tab === "log" ? "tab-active" : ""}`} onClick={() => setTab("log")}>
            📊 Лог ({triggers.length})
          </button>
          <button className={`tab ${tab === "settings" ? "tab-active" : ""}`} onClick={() => setTab("settings")}>
            ⚙️ Настройки
          </button>
        </div>

        {tab === "settings" && (
          <div className="stack-md">
            <IgConnectionPanel showToast={showToast} />
          </div>
        )}

        {tab === "rules" && (
          <div className="stack-md">
            {loading && rules.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon">⏳</div>
                <p>Загрузка...</p>
              </div>
            )}
            {!loading && rules.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon">📋</div>
                <p>Правил пока нет.<br />Нажмите «+ Добавить правило», чтобы начать.</p>
              </div>
            )}
            {rules.map((r) => (
              <div key={r.id} className={`card ${!r.is_active ? "card-inactive" : ""}`}>
                <div className="card-header">
                  <div className="flex-1">
                    <div className="card-title">
                      {r.media_title || r.media_id}
                      <span className={`badge ${r.is_active ? "badge-active" : "badge-inactive"}`}>
                        {r.is_active ? "✓ Активно" : "Выкл"}
                      </span>
                    </div>
                    {r.media_url && (
                      <div className="card-subtitle">
                        <a href={r.media_url} target="_blank" rel="noreferrer">{r.media_url}</a>
                      </div>
                    )}
                  </div>
                  <div className="card-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleToggle(r.id, !r.is_active)}
                    >
                      {r.is_active ? "⏸ Выкл" : "▶ Вкл"}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setEditing({ ...r })}
                    >
                      ✏️
                    </button>
                    <button
                      className="btn btn-danger btn-sm btn-icon"
                      onClick={() => handleDelete(r.id)}
                    >
                      🗑
                    </button>
                  </div>
                </div>

                <div className="keywords-row">
                  {r.keywords.map((kw) => (
                    <span key={kw} className="badge badge-keyword">🔑 {kw}</span>
                  ))}
                </div>

                <div className="card-body-grid">
                  <div className="preview-box">
                    <div className="preview-label">💬 Ответ в комментарий</div>
                    <div className="preview-text">{r.comment_reply}</div>
                  </div>
                  <div className="preview-box">
                    <div className="preview-label">✉️ Direct</div>
                    <div className="preview-text">{r.dm_message}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "log" && (
          <div className="stack-sm">
            {triggers.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon">📭</div>
                <p>Срабатываний пока не было.</p>
              </div>
            )}
            {triggers.map((t) => (
              <div key={t.id} className="trigger-item">
                <div className="trigger-time">
                  {new Date(t.triggered_at).toLocaleString("ru")}
                </div>
                <div className="trigger-content">
                  <div className="trigger-title">{t.ig_rules?.media_title || t.media_id}</div>
                  <div className="trigger-comment">Комментарий: «{t.comment_text}»</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {editing && (
        <RuleEditor
          rule={editing}
          onSave={handleSave}
          onClose={() => setEditing(null)}
          showToast={showToast}
        />
      )}
    </>
  );
}

/* ====== APP ====== */
export default function App() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkAuth().then((isAuthed) => {
      setAuthed(isAuthed);
      setChecking(false);
    });
  }, []);

  if (checking) {
    return (
      <div className="login-wrapper">
        <div className="login-card">
          <div className="login-brand">
            <h1>📸 Instagram Бот</h1>
            <p>Загрузка...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!authed) {
    return <LoginPage onLogin={() => setAuthed(true)} />;
  }

  return <Dashboard onLogout={() => setAuthed(false)} />;
}