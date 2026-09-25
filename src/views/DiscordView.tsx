import React from "react";
import { api } from "@/lib/client/api";
import { Panel, EmptyState, SkeletonRows } from "@/components/ui";

interface DiscordConfig {
  configured: boolean;
  maskedUrl: string | null;
  enabledEvents: string[];
  supportedEvents: string[];
  recent: {
    id: number;
    event_type: string;
    status: string;
    error: string | null;
    created_at: string;
    sent_at: string | null;
  }[];
}

interface BotConfig {
  configured: boolean;
  maskedToken: string | null;
  botRunning: boolean;
  botUser?: { id: string; username: string; discriminator: string } | null;
  connectedAt?: string | null;
  lastError?: string | null;
}

const EVENT_LABELS: Record<string, string> = {
  player_join: "Player joins",
  player_leave: "Player leaves",
  player_death: "Deaths (pings the player)",
  grave_created: "Grave creation",
  grave_expiring: "Grave countdown (pings the player)",
  chat_message: "In-game chat",
  server_start: "Server started",
  server_stop: "Server stopped",
  server_restart: "Server restarted",
  server_crash: "Crashes",
};

export default function DiscordView() {
  const [cfg, setCfg] = React.useState<DiscordConfig | null>(null);
  const [bot, setBot] = React.useState<BotConfig | null>(null);
  const [webhook, setWebhook] = React.useState("");
  const [botToken, setBotToken] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api
      .get<DiscordConfig>("/api/discord")
      .then(setCfg)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load Discord settings"));
    api
      .get<BotConfig>("/api/discord/bot")
      .then(setBot)
      .catch(() => undefined);
  }, []);

  React.useEffect(load, [load]);

  async function saveBot() {
    setBusy("bot");
    setMsg(null);
    try {
      const r = await api.post<{ botRunning: boolean }>("/api/discord/bot", { token: botToken.trim() });
      setMsg({
        ok: true,
        text: r.botRunning
          ? "Bot connected — type /status or /start in Discord to try it."
          : "Token saved — running via persistent worker process.",
      });
      setBotToken("");
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to save bot token" });
    } finally {
      setBusy(null);
    }
  }

  async function removeBot() {
    setBusy("bot-remove");
    try {
      await api.post("/api/discord/bot", { token: "" });
      setMsg({ ok: true, text: "Bot token removed." });
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to remove bot token" });
    } finally {
      setBusy(null);
    }
  }

  async function reconnectBot() {
    setBusy("bot-reconnect");
    try {
      await api.post("/api/discord/bot/reconnect");
      setMsg({ ok: true, text: "Reconnecting Discord Bot..." });
      setTimeout(load, 1500);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to reconnect bot" });
    } finally {
      setBusy(null);
    }
  }

  async function save(events?: string[]) {
    setBusy("save");
    setMsg(null);
    try {
      await api.put("/api/discord", {
        ...(webhook.trim() ? { webhookUrl: webhook.trim() } : {}),
        ...(events ? { events } : {}),
      });
      setMsg({ ok: true, text: "Discord settings saved." });
      setWebhook("");
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setMsg(null);
    try {
      await api.post("/api/discord");
      setMsg({ ok: true, text: "Test notification sent! Check Discord and the delivery log below." });
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setBusy(null);
    }
  }

  async function removeWebhook() {
    setBusy("remove");
    try {
      await api.put("/api/discord", { webhookUrl: "" });
      setMsg({ ok: true, text: "Webhook removed." });
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(null);
    }
  }

  function toggle(evt: string) {
    if (!cfg) return;
    const next = cfg.enabledEvents.includes(evt)
      ? cfg.enabledEvents.filter((x) => x !== evt)
      : [...cfg.enabledEvents, evt];
    setCfg({ ...cfg, enabledEvents: next });
    void save(next);
  }

  if (error) {
    return (
      <div>
        <h1 style={{ fontSize: 20, marginBottom: 14 }}>Discord</h1>
        <div className="error-state">{error}</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 20 }}>Discord</h1>
        <p className="dim" style={{ margin: 0, fontSize: 13 }}>
          Server notifications and slash command integration. Webhook URLs and tokens are stored securely server-side.
        </p>
      </div>

      {!cfg ? (
        <Panel>
          <SkeletonRows rows={5} />
        </Panel>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 740 }}>
          <Panel title="Webhook Notifications">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="row">
                <span className={`badge ${cfg.configured ? "green" : "gray"}`}>
                  {cfg.configured ? "Configured" : "Not configured"}
                </span>
                {cfg.maskedUrl ? <code className="mono faint" style={{ fontSize: 12 }}>{cfg.maskedUrl}</code> : null}
              </div>
              <input
                className="input mono"
                placeholder="https://discord.com/api/webhooks/…"
                value={webhook}
                onChange={(e) => setWebhook(e.target.value)}
                spellCheck={false}
              />
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className="btn primary" onClick={() => save()} disabled={busy !== null}>
                  {busy === "save" ? <span className="spinner" /> : "Save Webhook"}
                </button>
                <button className="btn" onClick={test} disabled={busy !== null || !cfg.configured}>
                  {busy === "test" ? <span className="spinner" /> : "Send Test Notification"}
                </button>
                {cfg.configured ? (
                  <button className="btn danger" onClick={removeWebhook} disabled={busy !== null}>
                    Remove
                  </button>
                ) : null}
              </div>
              {msg ? (
                <div style={{ fontSize: 13, color: msg.ok ? "var(--accent-strong)" : "var(--danger)" }}>
                  {msg.text}
                </div>
              ) : null}
            </div>
          </Panel>

          <Panel title="Bot — Slash Command Integration (/status, /start, /console...)">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                <span className={`badge ${bot?.botRunning ? "green" : bot?.configured ? "amber" : "gray"}`}>
                  {bot?.botRunning ? "Connected" : bot?.configured ? "Connecting / Idle" : "Not configured"}
                </span>
                {bot?.botUser ? (
                  <strong style={{ fontSize: 13, color: "var(--accent-strong)" }}>
                    @{bot.botUser.username}#{bot.botUser.discriminator}
                  </strong>
                ) : null}
                {bot?.maskedToken ? <code className="mono faint" style={{ fontSize: 12 }}>{bot.maskedToken}</code> : null}
              </div>

              {bot?.lastError && !bot?.botRunning ? (
                <div style={{ fontSize: 12.5, color: "var(--warn)", background: "var(--warn-dim)", padding: "8px 12px", borderRadius: 4 }}>
                  ⚠️ Gateway notice: {bot.lastError}
                </div>
              ) : null}

              <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                The Discord Bot connects directly to the Discord Gateway and handles in-server slash commands:
                <br />
                <code className="mono">/status</code> — Check Minecraft &amp; Falix status<br />
                <code className="mono">/start</code> — Start server (shows captcha link if Falix requires verification)<br />
                <code className="mono">/stop</code> · <code className="mono">/restart</code> — Server power controls<br />
                <code className="mono">/console &lt;cmd&gt;</code> — Execute console command via RCON / Falix<br />
                <code className="mono">/players</code> — List online players<br />
                <code className="mono">/graves</code> — Active death chests with coordinates &amp; timer
              </div>

              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <input
                  className="input mono"
                  style={{ flex: 1, minWidth: 240 }}
                  type="password"
                  placeholder="Discord bot token (MTA…)"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  spellCheck={false}
                />
                <button className="btn primary" onClick={saveBot} disabled={busy !== null || botToken.trim().length < 20}>
                  {busy === "bot" ? <span className="spinner" /> : "Save & Connect"}
                </button>
                {bot?.configured ? (
                  <>
                    <button className="btn" onClick={reconnectBot} disabled={busy !== null}>
                      {busy === "bot-reconnect" ? <span className="spinner" /> : "↻ Reconnect"}
                    </button>
                    <button className="btn danger" onClick={removeBot} disabled={busy !== null}>
                      Remove
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </Panel>

          <Panel title="Notification Event Types">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
              {cfg.supportedEvents.map((evt) => {
                const on = cfg.enabledEvents.includes(evt);
                return (
                  <button
                    key={evt}
                    onClick={() => toggle(evt)}
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
                    {EVENT_LABELS[evt] ?? evt}
                    <span className={`badge ${on ? "green" : "gray"}`}>{on ? "on" : "off"}</span>
                  </button>
                );
              })}
            </div>
            <p className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
              Enabled notifications trigger webhook posts immediately when the server integration detects events.
            </p>
          </Panel>

          <Panel title="Recent Deliveries" bodyStyle={{ padding: 0 }}>
            {cfg.recent.length === 0 ? (
              <EmptyState
                icon="discord"
                title="No deliveries yet"
                hint="Queued notifications will show their delivery status and errors here."
              />
            ) : (
              cfg.recent.map((d) => (
                <div
                  key={d.id}
                  className="spread"
                  style={{ padding: "9px 16px", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}
                >
                  <div>
                    <span style={{ fontWeight: 600 }}>{EVENT_LABELS[d.event_type] ?? d.event_type}</span>
                    {d.error ? <span className="dim"> — {d.error}</span> : null}
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <span
                      className={`badge ${
                        d.status === "sent"
                          ? "green"
                          : d.status === "failed"
                            ? "red"
                            : d.status === "skipped"
                              ? "gray"
                              : "amber"
                      }`}
                    >
                      {d.status}
                    </span>
                    <span className="faint">{new Date(d.created_at).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
