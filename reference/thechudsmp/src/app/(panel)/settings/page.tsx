"use client";

import React from "react";
import { api, setCsrfToken } from "@/lib/client/api";
import { useRouter } from "next/navigation";
import { Panel, SkeletonRows } from "@/components/ui";
import {
  NOTIFICATION_EVENTS,
  NOTIF_LABELS,
  desktopSupported,
  enabledByUser,
  getEventToggles,
  permissionState,
  requestPermission,
  runningInElectron,
  setEventEnabled,
  setUserEnabled,
  type NotificationEvent,
} from "@/lib/client/desktopNotifications";

interface SettingsData {
  server: { falixServerId: string; falixApiBase: string; minecraftHost: string; minecraftPort: string };
  integration: { configured: boolean; maskedKey: string };
  rcon: { configured: boolean; port: string | null };
  secrets: { falixKey: string; supabaseServiceKey: string };
}

interface UserRow {
  username: string;
  displayName: string;
  role: "player" | "moderator" | "admin";
  powerScope: "full" | "start" | "none";
  createdAt: string;
}

const ROLE_BADGE: Record<string, string> = {
  admin: "red",
  moderator: "amber",
  player: "gray",
};

interface SessionRow {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_agent: string | null;
}

interface PanelSettings {
  features: Record<FeatureId, boolean>;
  grave: { despawnMinutes: number; protection: boolean };
  /** MC username → Discord user ID or <@id> mention; empty string deletes. */
  discordNames: Record<string, string>;
}

type FeatureId = "dashboard" | "console" | "players" | "graves" | "chat" | "activity" | "statistics" | "discord";

const FEATURE_LABELS: Record<FeatureId, string> = {
  dashboard: "Dashboard",
  console: "Console",
  players: "Players",
  graves: "Graves",
  chat: "Chat",
  activity: "Activity",
  statistics: "Statistics",
  discord: "Discord",
};

export default function SettingsPage() {
  const router = useRouter();
  const [data, setData] = React.useState<SettingsData | null>(null);
  const [role, setRole] = React.useState<string>("");
  const [users, setUsers] = React.useState<UserRow[]>([]);
  const [sessions, setSessions] = React.useState<SessionRow[]>([]);
  const [currentPw, setCurrentPw] = React.useState("");
  const [newPw, setNewPw] = React.useState("");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [newUser, setNewUser] = React.useState({ username: "", password: "", mcUsername: "", role: "player" });
  const [panelSettings, setPanelSettings] = React.useState<PanelSettings | null>(null);
  const [graveMinutes, setGraveMinutes] = React.useState<string>("60");
  const [newPingName, setNewPingName] = React.useState("");
  const [newPingId, setNewPingId] = React.useState("");
  const [desktopPerm, setDesktopPerm] = React.useState<NotificationPermission | "unsupported">("default");
  const [, forceNotifRerender] = React.useState(0);

  React.useEffect(() => {
    api.get<SettingsData>("/api/settings").then(setData).catch(() => undefined);
    api
      .get<{ user: { role: string } }>("/api/auth/me")
      .then((m) => {
        setRole(m.user.role);
        if (m.user.role === "admin") {
          api.get<PanelSettings>("/api/panel-settings").then(setPanelSettings).catch(() => undefined);
        }
      })
      .catch(() => undefined);
    loadUsers();
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (panelSettings) setGraveMinutes(String(panelSettings.grave.despawnMinutes));
  }, [panelSettings]);

  // Desktop notification permission state (client-side only).
  React.useEffect(() => {
    setDesktopPerm(permissionState());
  }, []);

  async function enableDesktopNotifications() {
    const res = await requestPermission();
    setDesktopPerm(res === "unsupported" ? "unsupported" : res);
    if (res === "granted") setUserEnabled(true);
    if (runningInElectron() && res === "denied") {
      setMsg({ ok: false, text: "Blocked by the OS — allow notifications for this app in system settings, then reload." });
    }
  }

  function toggleEventNotif(type: NotificationEvent) {
    setEventEnabled(type, !getEventToggles()[type]);
    forceNotifRerender((n) => n + 1); // refresh switches
  }

  function loadUsers() {
    if (role !== "admin") {
      // Still attempt; the API enforces the real permission.
      api
        .get<{ users: UserRow[] }>("/api/permissions")
        .then((r) => setUsers(r.users))
        .catch(() => setUsers([]));
    }
  }

  function loadSessions() {
    api
      .post<{ sessions: SessionRow[] }>("/api/settings", { action: "list_sessions" })
      .then((r) => setSessions(r.sessions))
      .catch(() => setSessions([]));
  }

  async function action(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setMsg(null);
    try {
      const r = await api.post<{ reauth?: boolean }>("/api/settings", body);
      if (r.reauth) {
        router.replace("/login");
        return;
      }
      setMsg({ ok: true, text: "Done." });
      loadSessions();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Action failed" });
    } finally {
      setBusy(null);
    }
  }

  async function createUser() {
    setBusy("createUser");
    setMsg(null);
    try {
      await api.post("/api/users", newUser);
      setMsg({ ok: true, text: `Created ${newUser.username} (${newUser.role}).` });
      setNewUser({ username: "", password: "", mcUsername: "", role: "player" });
      loadUsers();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to create user" });
    } finally {
      setBusy(null);
    }
  }

  async function setUserRole(username: string, newRole: string) {
    setBusy(`role-${username}`);
    try {
      await api.put("/api/settings", { username, role: newRole });
      setUsers((rows) => rows.map((r) => (r.username === username ? { ...r, role: newRole as UserRow["role"] } : r)));
      setMsg({ ok: true, text: `Updated ${username} to ${newRole}.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to update role" });
    } finally {
      setBusy(null);
    }
  }

  async function setUserPowerScope(username: string, scope: UserRow["powerScope"]) {
    setBusy(`power-${username}`);
    try {
      await api.put("/api/permissions", { username, powerScope: scope });
      setUsers((rows) => rows.map((r) => (r.username === username ? { ...r, powerScope: scope } : r)));
      setMsg({
        ok: true,
        text:
          scope === "full"
            ? `${username} can start, stop and restart the server.`
            : scope === "start"
              ? `${username} can start the server only.`
              : `${username} has no server power controls.`,
      });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to update power permission" });
    } finally {
      setBusy(null);
    }
  }

  async function savePanelSettings(patch: { features?: Partial<Record<FeatureId, boolean>>; grave?: Partial<PanelSettings["grave"]> }) {
    setBusy("panel-settings");
    setMsg(null);
    try {
      const r = await api.post<PanelSettings>("/api/panel-settings", patch);
      setPanelSettings({ features: r.features, grave: r.grave, discordNames: r.discordNames });
      setMsg({ ok: true, text: "Saved — the mod picks it up within 30 seconds." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setBusy(null);
    }
  }

  function toggleFeature(id: FeatureId) {
    if (!panelSettings) return;
    const next = { ...panelSettings.features, [id]: !panelSettings.features[id] };
    setPanelSettings({ ...panelSettings, features: next }); // optimistic
    void savePanelSettings({ features: { [id]: next[id] } });
  }

  async function saveDiscordName(mcName: string, value: string) {
    setBusy("panel-settings");
    setMsg(null);
    try {
      const r = await api.post<PanelSettings>("/api/panel-settings", { discordNames: { [mcName]: value } });
      setPanelSettings({ features: r.features, grave: r.grave, discordNames: r.discordNames });
      setMsg({ ok: true, text: value ? `Pings will mention the Discord user for ${mcName}.` : `Removed ping mapping for ${mcName}.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setBusy(null);
    }
  }

  function addDiscordPing() {
    const name = newPingName.trim();
    const id = newPingId.trim();
    if (!panelSettings || !name || !id) return;
    setNewPingName("");
    setNewPingId("");
    void saveDiscordName(name, id);
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 20 }}>Settings</h1>
        <p className="dim" style={{ margin: 0, fontSize: 13 }}>Panel configuration, account and access control.</p>
      </div>

      {msg ? (
        <div className="panel" style={{ padding: "10px 14px", marginBottom: 12, fontSize: 13, borderColor: msg.ok ? "rgba(85,176,104,0.4)" : "rgba(224,86,79,0.4)", color: msg.ok ? "var(--accent-strong)" : "#f08a85" }}>
          {msg.text}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 780 }}>
        {/* Server */}
        <Panel title="Server">
          {!data ? (
            <SkeletonRows rows={3} height={30} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
              <Row label="Falix server ID" value={data.server.falixServerId} mono />
              <Row label="Falix API base" value={data.server.falixApiBase} mono />
              <Row label="Minecraft address" value={`${data.server.minecraftHost}:${data.server.minecraftPort}`} mono />
              <Row label="Falix API key" value={data.secrets.falixKey} mono />
              <Row label="Supabase service key" value={data.secrets.supabaseServiceKey} mono />
              <Row label="Integration secret" value={data.integration.configured ? data.integration.maskedKey : "(not set)"} mono />
              <Row label="RCON fallback" value={data.rcon.configured ? `configured (port ${data.rcon.port})` : "not configured"} />
            </div>
          )}
        </Panel>

        {/* Dashboard */}
        <Panel title="Dashboard">
          <div className="spread">
            <div style={{ fontSize: 13 }}>
              Reset your dashboard to the default widget layout.
              <div className="faint" style={{ fontSize: 12 }}>Your arrangement is stored per-user in the panel database.</div>
            </div>
            <button className="btn sm" onClick={() => action({ action: "reset_layout" }, "layout")} disabled={busy !== null}>
              Reset layout
            </button>
          </div>
        </Panel>

        {/* Panel features (admin) — toggles which sections exist for everyone */}
        {role === "admin" && panelSettings ? (
          <Panel title="Panel features">
            <div className="faint" style={{ fontSize: 12, marginBottom: 10 }}>
              Disabled sections disappear from the navigation for every user and their pages return 404 — permissions still apply on top of this.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(Object.keys(FEATURE_LABELS) as FeatureId[]).map((id) => (
                <div key={id} className="spread">
                  <span style={{ fontSize: 13 }}>{FEATURE_LABELS[id]}</span>
                  <button
                    className={`btn sm ${panelSettings.features[id] ? "primary" : ""}`}
                    disabled={busy !== null || id === "dashboard"}
                    title={id === "dashboard" ? "The dashboard cannot be disabled" : undefined}
                    onClick={() => toggleFeature(id)}
                  >
                    {busy === "panel-settings" ? <span className="spinner" /> : panelSettings.features[id] ? "Enabled" : "Disabled"}
                  </button>
                </div>
              ))}
            </div>
          </Panel>
        ) : null}

        {/* Grave mod (admin) — live settings for the in-game mod */}
        {role === "admin" && panelSettings ? (
          <Panel title="Grave mod">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="spread">
                <div style={{ fontSize: 13 }}>
                  Grave protection
                  <div className="faint" style={{ fontSize: 12 }}>Only the owner (or an operator) can open a grave in game.</div>
                </div>
                <button
                  className={`btn sm ${panelSettings.grave.protection ? "primary" : ""}`}
                  disabled={busy !== null}
                  onClick={() => savePanelSettings({ grave: { protection: !panelSettings.grave.protection } })}
                >
                  {busy === "panel-settings" ? <span className="spinner" /> : panelSettings.grave.protection ? "Protected" : "Open to all"}
                </button>
              </div>
              <div className="spread">
                <div style={{ fontSize: 13 }}>
                  Despawn after
                  <div className="faint" style={{ fontSize: 12 }}>Graves vanish after this long. Applies to new graves immediately; existing ones are rescheduled.</div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="input"
                    style={{ width: 84 }}
                    type="number"
                    min={5}
                    max={10080}
                    value={graveMinutes}
                    onChange={(e) => setGraveMinutes(e.target.value)}
                  />
                  <span className="faint" style={{ fontSize: 12 }}>minutes</span>
                  <button
                    className="btn sm"
                    disabled={busy !== null || !graveMinutes}
                    onClick={() => savePanelSettings({ grave: { despawnMinutes: Number(graveMinutes) } })}
                  >
                    {busy === "panel-settings" ? <span className="spinner" /> : "Apply"}
                  </button>
                </div>
              </div>
            </div>
          </Panel>
        ) : null}

        {/* Discord pings (admin) — who gets @mentioned when they die */}
        {role === "admin" && panelSettings ? (
          <Panel title="Discord pings">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="faint" style={{ fontSize: 12 }}>
                Map each Minecraft username to a Discord user — death and grave-expiry notifications then @mention that user in Discord (a real ping, not just a message). Get the ID by enabling Developer Mode in Discord (Settings → Advanced), then right-click a user → Copy User ID.
              </div>
              {Object.keys(panelSettings.discordNames).length === 0 ? (
                <div className="faint" style={{ fontSize: 12.5 }}>No mappings yet — add one below.</div>
              ) : (
                Object.entries(panelSettings.discordNames).map(([mcName, mention]) => (
                  <div key={mcName} className="spread">
                    <div className="row" style={{ gap: 8, fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>{mcName}</span>
                      <span className="faint">→</span>
                      <code className="mono faint" style={{ fontSize: 12 }}>{mention}</code>
                    </div>
                    <button
                      className="btn sm danger"
                      disabled={busy !== null}
                      onClick={() => saveDiscordName(mcName, "")}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <input
                  className="input"
                  style={{ width: 170 }}
                  placeholder="Minecraft name"
                  value={newPingName}
                  onChange={(e) => setNewPingName(e.target.value)}
                />
                <input
                  className="input mono"
                  style={{ width: 220 }}
                  placeholder="Discord user ID (e.g. 123456789012345678)"
                  value={newPingId}
                  onChange={(e) => setNewPingId(e.target.value)}
                />
                <button
                  className="btn sm primary"
                  disabled={busy !== null || !newPingName.trim() || !newPingId.trim()}
                  onClick={addDiscordPing}
                >
                  {busy === "panel-settings" ? <span className="spinner" /> : "Add ping"}
                </button>
              </div>
              <div className="faint" style={{ fontSize: 11.5 }}>
                Applies to death and grave-countdown notifications. Everything else still goes to the channel unpinged.
              </div>
            </div>
          </Panel>
        ) : null}

        {/* Desktop notifications — per-event toasts (browser + Electron) */}
        <Panel title="Desktop notifications">
          {desktopPerm === "unsupported" ? (
            <div className="faint" style={{ fontSize: 13 }}>
              This browser does not support desktop notifications. The Electron desktop app always does.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="spread">
                <div style={{ fontSize: 13 }}>
                  Desktop notifications
                  <div className="faint" style={{ fontSize: 12 }}>
                    {desktopPerm === "granted"
                      ? "Permission granted — popups appear even when the window is in the background."
                      : desktopPerm === "denied"
                        ? "Permission blocked in this browser. Reset it in the browser's site settings, then reload."
                        : "Pop up a system toast for the events you pick below."}
                  </div>
                </div>
                {desktopPerm === "granted" ? (
                  <button className={`btn sm ${enabledByUser() ? "primary" : ""}`} onClick={() => { setUserEnabled(!enabledByUser()); forceNotifRerender((n) => n + 1); }}>
                    {enabledByUser() ? "On" : "Muted"}
                  </button>
                ) : (
                  <button className="btn sm primary" disabled={desktopPerm === "denied"} onClick={enableDesktopNotifications}>
                    Enable
                  </button>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  borderTop: "1px solid var(--border)",
                  paddingTop: 10,
                  opacity: desktopPerm === "granted" && enabledByUser() ? 1 : 0.45,
                  pointerEvents: desktopPerm === "granted" && enabledByUser() ? "auto" : "none",
                }}
              >
                {(NOTIFICATION_EVENTS as readonly NotificationEvent[]).map((evt) => (
                  <div key={evt} className="spread">
                    <span style={{ fontSize: 13 }}>{NOTIF_LABELS[evt]}</span>
                    <button
                      className={`btn sm ${getEventToggles()[evt] ? "primary" : ""}`}
                      onClick={() => toggleEventNotif(evt)}
                    >
                      {getEventToggles()[evt] ? "Notify" : "Silent"}
                    </button>
                  </div>
                ))}
                <div className="faint" style={{ fontSize: 11.5 }}>
                  Choices are saved per user on this device. In the Electron app these are real OS notifications.
                </div>
              </div>
            </div>
          )}
        </Panel>

        {/* Notifications */}
        <Panel title="Notifications">
          <div style={{ fontSize: 13 }}>
            Panel notifications appear under the bell in the top bar. Discord notifications are configured on the{" "}
            <a href="/discord">Discord page</a>.
          </div>
        </Panel>

        {/* Account */}
        <Panel title="Account">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <input className="input" style={{ width: 220 }} type="password" placeholder="Current password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} />
              <input className="input" style={{ width: 220 }} type="password" placeholder="New password (min 10 chars)" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
              <button
                className="btn"
                disabled={busy !== null || !currentPw || newPw.length < 10}
                onClick={() => action({ action: "change_password", currentPassword: currentPw, newPassword: newPw }, "pw")}
              >
                {busy === "pw" ? <span className="spinner" /> : "Change password"}
              </button>
            </div>
            <div className="spread">
              <div style={{ fontSize: 13 }}>
                Active sessions: <strong>{sessions.length}</strong>
                {sessions[0]?.user_agent ? <div className="faint" style={{ fontSize: 11.5 }}>{sessions[0].user_agent.slice(0, 60)}</div> : null}
              </div>
              <button className="btn sm" onClick={() => action({ action: "revoke_sessions" }, "sessions")} disabled={busy !== null}>
                Sign out everywhere
              </button>
            </div>
          </div>
        </Panel>

        {/* Permissions (admin) */}
        <Panel title="Users & permissions">
          {role === "admin" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16, padding: 12, borderRadius: 8, background: "rgba(146,176,120,0.06)" }}>
              <div className="panel-title" style={{ fontSize: 10.5 }}>Add user</div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <input className="input" style={{ width: 160 }} placeholder="Username" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} spellCheck={false} />
                <input className="input" style={{ width: 180 }} type="password" placeholder="Password (min 10)" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
                <input className="input" style={{ width: 160 }} placeholder="Minecraft name" value={newUser.mcUsername} onChange={(e) => setNewUser({ ...newUser, mcUsername: e.target.value })} spellCheck={false} />
                <select className="select" style={{ width: 130 }} value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                  <option value="player">Player</option>
                  <option value="moderator">Moderator</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  className="btn sm primary"
                  disabled={busy !== null || !newUser.username || newUser.password.length < 10 || !newUser.mcUsername}
                  onClick={createUser}
                >
                  {busy === "createUser" ? <span className="spinner" /> : "Create user"}
                </button>
              </div>
              <div className="faint" style={{ fontSize: 11.5 }}>
                The Minecraft name is used for the player head and links panel stats to the in-game player.
              </div>
            </div>
          ) : null}
          {users.length === 0 ? (
            <div className="faint" style={{ fontSize: 12.5 }}>
              {role === "admin" ? "No users found." : "Permission management is restricted to administrators."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {users.map((u) => (
                <div key={u.username} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div className="spread" style={{ fontSize: 13 }}>
                    <div className="row">
                      <span className={`badge ${ROLE_BADGE[u.role] ?? "gray"}`}>{u.role}</span>
                      <strong>{u.displayName}</strong>
                      <span className="faint">· {new Date(u.createdAt).toLocaleDateString()}</span>
                    </div>
                    <select
                      className="select"
                      style={{ width: 140 }}
                      value={u.role}
                      disabled={busy !== null || u.role === "admin"}
                      title={u.role === "admin" ? "Admins always hold full server power" : undefined}
                      onChange={(e) => setUserRole(u.username, e.target.value)}
                    >
                      <option value="player">Player</option>
                      <option value="moderator">Moderator</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  {u.role !== "admin" ? (
                    <div className="spread" style={{ paddingLeft: 4 }}>
                      <span className="faint" style={{ fontSize: 12 }}>
                        Server power
                        <span className="faint"> · Start only = can start, never stop/restart</span>
                      </span>
                      <select
                        className="select"
                        style={{ width: 150 }}
                        value={u.powerScope ?? "full"}
                        disabled={busy !== null}
                        onChange={(e) => setUserPowerScope(u.username, e.target.value as UserRow["powerScope"])}
                      >
                        <option value="full">Full (start/stop/restart)</option>
                        <option value="start">Start only</option>
                        <option value="none">No power controls</option>
                      </select>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          <p className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
            Permissions are enforced server-side on every API call — hiding UI elements is only cosmetic.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="spread">
      <span className="dim">{label}</span>
      <span className={mono ? "mono" : ""} style={{ fontSize: 12.5 }}>{value}</span>
    </div>
  );
}
