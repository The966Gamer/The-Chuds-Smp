import React from "react";
import { api } from "@/lib/client/api";
import { Panel, SkeletonRows } from "@/components/ui";

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

export default function SettingsView({ user, onLogout }: { user: { username: string; role: string }; onLogout: () => void }) {
  const [data, setData] = React.useState<SettingsData | null>(null);
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

  const loadData = React.useCallback(() => {
    api.get<SettingsData>("/api/settings").then(setData).catch(() => undefined);
    if (user.role === "admin") {
      api.get<PanelSettings>("/api/panel-settings").then(setPanelSettings).catch(() => undefined);
      api
        .get<{ users: UserRow[] }>("/api/permissions")
        .then((r) => setUsers(r.users || []))
        .catch(() => setUsers([]));
    }
    api
      .post<{ sessions: SessionRow[] }>("/api/settings", { action: "list_sessions" })
      .then((r) => setSessions(r.sessions || []))
      .catch(() => setSessions([]));
  }, [user.role]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  React.useEffect(() => {
    if (panelSettings) setGraveMinutes(String(panelSettings.grave.despawnMinutes));
  }, [panelSettings]);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy("password");
    setMsg(null);
    try {
      await api.post("/api/settings", { action: "change_password", currentPassword: currentPw, newPassword: newPw });
      setMsg({ ok: true, text: "Password changed successfully." });
      setCurrentPw("");
      setNewPw("");
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Failed to change password" });
    } finally {
      setBusy(null);
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy("createUser");
    setMsg(null);
    try {
      await api.post("/api/users", newUser);
      setMsg({ ok: true, text: `Created user ${newUser.username} (${newUser.role}).` });
      setNewUser({ username: "", password: "", mcUsername: "", role: "player" });
      loadData();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Failed to create user" });
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
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Failed to update role" });
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
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Failed to update power permission" });
    } finally {
      setBusy(null);
    }
  }

  async function savePanelSettings(patch: {
    features?: Partial<Record<FeatureId, boolean>>;
    grave?: Partial<PanelSettings["grave"]>;
  }) {
    setBusy("panel-settings");
    setMsg(null);
    try {
      const r = await api.post<PanelSettings>("/api/panel-settings", patch);
      setPanelSettings(r);
      setMsg({ ok: true, text: "Settings saved successfully." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Failed to save settings" });
    } finally {
      setBusy(null);
    }
  }

  function toggleFeature(id: FeatureId) {
    if (!panelSettings) return;
    const next = { ...panelSettings.features, [id]: !panelSettings.features[id] };
    setPanelSettings({ ...panelSettings, features: next });
    void savePanelSettings({ features: { [id]: next[id] } });
  }

  async function saveDiscordPing(mcName: string, value: string) {
    setBusy("panel-settings");
    setMsg(null);
    try {
      const r = await api.post<PanelSettings>("/api/panel-settings", { discordNames: { [mcName]: value } });
      setPanelSettings(r);
      setMsg({
        ok: true,
        text: value ? `Pings will mention the Discord user for ${mcName}.` : `Removed ping mapping for ${mcName}.`,
      });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Failed to save" });
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
    void saveDiscordPing(name, id);
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 20 }}>Settings</h1>
        <p className="dim" style={{ margin: 0, fontSize: 13 }}>
          Panel configuration, integrations, user permissions, and security.
        </p>
      </div>

      {msg ? (
        <div
          className="panel fade-in"
          style={{
            padding: 12,
            marginBottom: 14,
            borderColor: msg.ok ? "rgba(106, 190, 48, 0.4)" : "rgba(224, 86, 79, 0.4)",
            background: msg.ok ? "var(--accent-dim)" : "var(--danger-dim)",
            color: msg.ok ? "var(--accent-strong)" : "#f08a85",
            fontSize: 13,
          }}
        >
          {msg.text}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 800 }}>
        <Panel title="Server & Integration Overview">
          {!data ? (
            <SkeletonRows rows={4} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
              <div>
                <span className="dim">Falix Server ID: </span>
                <code className="mono">{data.server.falixServerId || "Not configured"}</code>
              </div>
              <div>
                <span className="dim">Minecraft Address: </span>
                <code className="mono">
                  {data.server.minecraftHost}:{data.server.minecraftPort}
                </code>
              </div>
              <div>
                <span className="dim">RCON Port: </span>
                <span className={`badge ${data.rcon.configured ? "green" : "gray"}`}>
                  {data.rcon.configured ? `Port ${data.rcon.port}` : "Disabled"}
                </span>
              </div>
              <div>
                <span className="dim">Integration Key: </span>
                <span className={`badge ${data.integration.configured ? "green" : "gray"}`}>
                  {data.integration.configured ? data.integration.maskedKey : "Not set"}
                </span>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Change Password">
          <form onSubmit={changePassword} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 360 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-dim)" }}>Current Password</span>
              <input
                className="input"
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                required
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-dim)" }}>New Password</span>
              <input
                className="input"
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                required
                placeholder="At least 8 characters"
              />
            </label>
            <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy !== null}>
              {busy === "password" ? <span className="spinner" /> : "Update Password"}
            </button>
          </form>
        </Panel>

        {user.role === "admin" && panelSettings ? (
          <>
            <Panel title="Feature Toggles">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
                {(Object.keys(panelSettings.features) as FeatureId[]).map((f) => {
                  const on = panelSettings.features[f];
                  return (
                    <button
                      key={f}
                      onClick={() => toggleFeature(f)}
                      className="spread"
                      style={{
                        padding: "10px 12px",
                        borderRadius: 4,
                        border: `1px solid ${on ? "rgba(85,176,104,0.4)" : "var(--border)"}`,
                        background: on ? "var(--accent-dim)" : "rgba(148,163,184,0.04)",
                        color: "var(--text)",
                        font: "inherit",
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      {FEATURE_LABELS[f] ?? f}
                      <span className={`badge ${on ? "green" : "gray"}`}>{on ? "enabled" : "hidden"}</span>
                    </button>
                  );
                })}
              </div>
            </Panel>

            <Panel title="Grave Mod Configuration">
              <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 440 }}>
                <div className="spread">
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>Despawn Timer (Minutes)</div>
                    <div className="faint" style={{ fontSize: 12 }}>
                      How long death chests persist before despawning.
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <input
                      className="input mono"
                      style={{ width: 80 }}
                      type="number"
                      min={5}
                      max={10080}
                      value={graveMinutes}
                      onChange={(e) => setGraveMinutes(e.target.value)}
                    />
                    <button
                      className="btn sm"
                      onClick={() => savePanelSettings({ grave: { despawnMinutes: Number(graveMinutes) || 60 } })}
                    >
                      Save
                    </button>
                  </div>
                </div>

                <div className="spread">
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>Grave Protection</div>
                    <div className="faint" style={{ fontSize: 12 }}>
                      Prevent non-owners from opening or looting other players&apos; graves.
                    </div>
                  </div>
                  <button
                    className={`btn sm ${panelSettings.grave.protection ? "primary" : ""}`}
                    onClick={() => savePanelSettings({ grave: { protection: !panelSettings.grave.protection } })}
                  >
                    {panelSettings.grave.protection ? "Protected" : "Unprotected"}
                  </button>
                </div>
              </div>
            </Panel>

            <Panel title="Discord Player Mentions">
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <p className="faint" style={{ fontSize: 12, margin: 0 }}>
                  Link in-game Minecraft usernames to Discord User IDs (e.g. <code className="mono">123456789012345678</code>) to mention them on death or grave expiration.
                </p>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="input"
                    placeholder="Minecraft Username"
                    value={newPingName}
                    onChange={(e) => setNewPingName(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <input
                    className="input mono"
                    placeholder="Discord User ID"
                    value={newPingId}
                    onChange={(e) => setNewPingId(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button className="btn primary" onClick={addDiscordPing} disabled={!newPingName.trim() || !newPingId.trim()}>
                    Add Mapping
                  </button>
                </div>

                {Object.keys(panelSettings.discordNames || {}).length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                    {Object.entries(panelSettings.discordNames).map(([mc, id]) => (
                      <div key={mc} className="spread" style={{ padding: "6px 10px", background: "rgba(0,0,0,0.2)", borderRadius: 4, fontSize: 13 }}>
                        <div>
                          <strong>{mc}</strong> → <code className="mono dim">&lt;@{id}&gt;</code>
                        </div>
                        <button className="btn sm ghost" onClick={() => saveDiscordPing(mc, "")}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </Panel>

            <Panel title="User Accounts & Permissions">
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <form onSubmit={createUser} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Username</span>
                    <input
                      className="input"
                      value={newUser.username}
                      onChange={(e) => setNewUser((u) => ({ ...u, username: e.target.value }))}
                      required
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Password</span>
                    <input
                      className="input"
                      type="password"
                      value={newUser.password}
                      onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value }))}
                      required
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 12, color: "var(--text-dim)" }}>MC Name</span>
                    <input
                      className="input"
                      value={newUser.mcUsername}
                      onChange={(e) => setNewUser((u) => ({ ...u, mcUsername: e.target.value }))}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Role</span>
                    <select
                      className="select"
                      value={newUser.role}
                      onChange={(e) => setNewUser((u) => ({ ...u, role: e.target.value }))}
                    >
                      <option value="player">player</option>
                      <option value="moderator">moderator</option>
                      <option value="admin">admin</option>
                    </select>
                  </label>
                  <button className="btn primary" disabled={busy === "createUser"}>
                    Create
                  </button>
                </form>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {users.map((u) => (
                    <div
                      key={u.username}
                      className="spread"
                      style={{ padding: "8px 12px", background: "rgba(0,0,0,0.15)", borderRadius: 4, fontSize: 13 }}
                    >
                      <div>
                        <strong>{u.username}</strong>
                        <span className="faint" style={{ marginLeft: 8 }}>
                          created {new Date(u.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <select
                          className="select"
                          style={{ width: 120, padding: "4px 8px", fontSize: 12 }}
                          value={u.role}
                          onChange={(e) => setUserRole(u.username, e.target.value)}
                        >
                          <option value="player">player</option>
                          <option value="moderator">moderator</option>
                          <option value="admin">admin</option>
                        </select>
                        <select
                          className="select"
                          style={{ width: 140, padding: "4px 8px", fontSize: 12 }}
                          value={u.powerScope}
                          onChange={(e) => setUserPowerScope(u.username, e.target.value as UserRow["powerScope"])}
                        >
                          <option value="full">Full Power</option>
                          <option value="start">Start Only</option>
                          <option value="none">No Power</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          </>
        ) : null}

        <Panel title="Active Sessions" bodyStyle={{ padding: 0 }}>
          {sessions.length === 0 ? (
            <div style={{ padding: 14 }} className="faint">
              No other active sessions.
            </div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                className="spread"
                style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{s.user_agent || "Browser Session"}</div>
                  <div className="faint">
                    Last active: {new Date(s.last_seen_at).toLocaleString()} · Expires: {new Date(s.expires_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  className="btn sm danger"
                  onClick={async () => {
                    await api.post("/api/settings", { action: "revoke_session", sessionId: s.id });
                    loadData();
                  }}
                >
                  Revoke
                </button>
              </div>
            ))
          )}
        </Panel>
      </div>
    </div>
  );
}
