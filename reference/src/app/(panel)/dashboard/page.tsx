"use client";

import React from "react";
import { api } from "@/lib/client/api";
import { useRealtime, formatRelative, formatDuration } from "@/lib/client/realtime";
import { useServerPower } from "@/lib/client/useServerPower";
import VerificationDialog from "@/components/VerificationDialog";
import { McHead, StatusBadge, Panel, EmptyState, SkeletonRows } from "@/components/ui";

interface Me {
  user: { username: string; mcUsername: string | null; headUrl: string | null; role: string };
  csrfToken: string;
  /** Per-user server power grant: full | start | none. */
  powerScope?: "full" | "start" | "none";
}

interface StatusPayload {
  falix?: { status?: string; message?: string; resources?: { cpu: number; memory: number; uptime: number } | null; error?: string };
  minecraft?: { online?: boolean; version?: string | null; playersOnline?: number | null; playersMax?: number | null; latencyMs?: number | null; motd?: string | null; favicon?: string | null } | null;
  players?: { onlinePlayers?: number; playerNames?: string[] };
  server?: { name?: string; address?: string; software?: { name?: string; version?: string } | null } | null;
  config?: { host?: string; port?: string };
}

interface PlayerRow {
  username: string;
  headUrl: string | null;
  online: boolean;
  playtimeSeconds: number;
}

const WIDGETS = [
  { id: "server-status", label: "Server Status", minW: 2, minH: 2 },
  { id: "controls", label: "Server Controls", minW: 2, minH: 2 },
  { id: "player-count", label: "Player Count", minW: 2, minH: 2 },
  { id: "current-players", label: "Current Players", minW: 2, minH: 3 },
  { id: "activity", label: "Activity", minW: 2, minH: 3 },
  { id: "console-preview", label: "Console Preview", minW: 2, minH: 3 },
] as const;

type WidgetId = (typeof WIDGETS)[number]["id"];

const DEFAULT_LAYOUT: Record<WidgetId, { x: number; y: number; w: number; h: number }> = {
  "server-status": { x: 0, y: 0, w: 4, h: 2 },
  controls: { x: 4, y: 0, w: 4, h: 2 },
  "player-count": { x: 8, y: 0, w: 4, h: 2 },
  "current-players": { x: 0, y: 2, w: 6, h: 3 },
  activity: { x: 6, y: 2, w: 6, h: 3 },
  "console-preview": { x: 0, y: 5, w: 12, h: 3 },
};

const COLS = 12;
const ROW_PX = 92;
const GAP = 14;

interface SavedLayout {
  widgets?: Record<string, { x: number; y: number; w: number; h: number }>;
  hidden?: string[];
}

export default function DashboardPage() {
  const [me, setMe] = React.useState<Me | null>(null);
  const [status, setStatus] = React.useState<StatusPayload | null>(null);
  const [players, setPlayers] = React.useState<PlayerRow[]>([]);
  const [activity, setActivity] = React.useState<{ id: number; type: string; message: string | null; playerName: string | null; createdAt: string }[]>([]);
  const [consoleLines, setConsoleLines] = React.useState<string[]>([]);
  const [headNotice, setHeadNotice] = React.useState(false);
  const [layout, setLayout] = React.useState<SavedLayout>({ widgets: DEFAULT_LAYOUT, hidden: [] });
  const [layoutReady, setLayoutReady] = React.useState(false);
  const [editMode, setEditMode] = React.useState(false);
  const dragState = React.useRef<{ id: string; startX: number; startY: number; orig: { x: number; y: number; w: number; h: number }; mode: "move" | "resize" } | null>(null);

  React.useEffect(() => {
    api.get<Me>("/api/auth/me").then(setMe).catch(() => undefined);
    api.get<{ layout: SavedLayout | null }>("/api/layout").then((r) => {
      if (r.layout?.widgets) setLayout({ widgets: r.layout.widgets as SavedLayout["widgets"], hidden: r.layout.hidden ?? [] });
      setLayoutReady(true);
    }).catch(() => setLayoutReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshStatus = React.useCallback(() => {
    api.get<StatusPayload>("/api/status").then((s) => {
      setStatus(s);
      const names = s.players?.playerNames ?? [];
      if (names.length > 0) {
        api
          .get<{ players: PlayerRow[] }>("/api/players?pageSize=50")
          .then((r) =>
            setPlayers(
              r.players.filter((p) => names.some((n) => n.toLowerCase() === p.username.toLowerCase())).map((p) => ({ ...p, online: true })),
            ),
          )
          .catch(() => undefined);
      } else {
        setPlayers([]);
      }
      // Head notice: only when the logged-in user's avatar cannot be resolved.
      const mcName = me?.user.mcUsername ?? me?.user.username;
      if (mcName) {
        api
          .get<{ players: PlayerRow[] }>("/api/players?search=" + encodeURIComponent(mcName))
          .then((r) => {
            const match = r.players[0];
            setHeadNotice(!match?.headUrl);
          })
          .catch(() => undefined);
      }
    }).catch(() => undefined);
  }, [me]);

  React.useEffect(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, 12_000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  // Power actions + Falix verification flow live in one hook; a successful
  // verification-triggered start refreshes status immediately. The per-user
  // power grant decides which buttons exist: 'start' hides Stop/Restart.
  const {
    busySignal,
    error: actionError,
    verification,
    verifyBusy,
    power,
    retryVerification,
    dismissVerification,
  } = useServerPower(refreshStatus);

  React.useEffect(() => {
    api
      .get<{ events: typeof activity }>("/api/activity?limit=8")
      .then((r) => setActivity(r.events))
      .catch(() => undefined);
    api
      .get<{ lines: string[] }>("/api/console?lines=12")
      .then((r) => setConsoleLines(r.lines))
      .catch(() => undefined);
  }, []);

  useRealtime((type, payload) => {
    if (type === "console" && payload && !("error" in (payload as object))) {
      setConsoleLines((payload as { lines: string[] }).lines ?? []);
    }
    if (type === "players") {
      const names = (payload as { playerNames?: string[] }).playerNames ?? [];
      setPlayers((prev) =>
        prev.map((p) => ({ ...p, online: names.some((n) => n.toLowerCase() === p.username.toLowerCase()) })),
      );
    }
    if (type === "event") {
      api.get<{ events: typeof activity }>("/api/activity?limit=8").then((r) => setActivity(r.events)).catch(() => undefined);
    }
  });

  async function saveLayout(next: SavedLayout) {
    setLayout(next);
    try {
      await api.put("/api/layout", { layout: next });
    } catch {
      // non-fatal
    }
  }

  const falixStatus = status?.falix && !("error" in status.falix) ? status.falix.status ?? "unknown" : "unknown";
  const mcOnline = status?.minecraft?.online === true;
  const online = status?.players?.onlinePlayers ?? 0;
  const max = status?.minecraft?.playersMax ?? null;
  // Until /me loads we hide power controls (no flash of Stop/Restart for
  // start-only users); admins see theirs the moment the fetch resolves.
  const powerScope = me?.powerScope ?? (me ? "full" : "none");

  function onMouseDown(id: string, mode: "move" | "resize") {
    return (e: React.MouseEvent) => {
      if (!editMode) return;
      e.preventDefault();
      dragState.current = { id, startX: e.clientX, startY: e.clientY, orig: layout.widgets?.[id] ?? DEFAULT_LAYOUT[id as WidgetId], mode };
      const onMove = (ev: MouseEvent) => {
        const st = dragState.current;
        if (!st) return;
        const dx = Math.round((ev.clientX - st.startX) / ((ROW_PX + GAP) * 0.55));
        const dy = Math.round((ev.clientY - st.startY) / (ROW_PX + GAP));
        const w = layout.widgets?.[st.id] ?? DEFAULT_LAYOUT[st.id as WidgetId];
        const next = { ...w };
        if (st.mode === "move") {
          next.x = Math.max(0, Math.min(COLS - w.w, st.orig.x + dx));
          next.y = Math.max(0, st.orig.y + dy);
        } else {
          next.w = Math.max(2, Math.min(COLS - w.x, st.orig.w + dx));
          next.h = Math.max(2, st.orig.h + dy);
        }
        setLayout((l) => ({ ...l, widgets: { ...l.widgets, [st.id]: next } }));
      };
      const onUp = () => {
        dragState.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        void saveLayout(layout);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
  }

  const serverName = status?.server?.name ?? "Minecraft Server";

  return (
    <div>
      {verification ? (
        <VerificationDialog
          verification={verification}
          busy={verifyBusy}
          onRetry={retryVerification}
          onDismiss={dismissVerification}
        />
      ) : null}

      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 21 }}>Welcome back, {me?.user.username ?? "…"}</h1>
        <p className="dim" style={{ margin: 0 }}>The mines are waiting.</p>
      </div>

      {headNotice ? (
        <div className="panel fade-in" style={{ padding: "10px 14px", marginBottom: 14, borderColor: "rgba(224, 168, 60, 0.4)", background: "var(--warn-dim)", display: "flex", alignItems: "center", gap: 10 }}>
          <PixelIconView name="creeper" size={18} />
          <span style={{ fontSize: 13 }}>Head data not found. Please log into the Minecraft server once, then refresh.</span>
          <button className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={() => setHeadNotice(false)}>Dismiss</button>
        </div>
      ) : null}

      <div className="spread" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <button className={`btn sm ${editMode ? "primary" : ""}`} onClick={() => setEditMode((v) => !v)}>
            {editMode ? "Done" : "Edit layout"}
          </button>
          {editMode ? (
            <>
              <button
                className="btn sm"
                onClick={() => saveLayout({ widgets: DEFAULT_LAYOUT, hidden: [] })}
              >
                Restore defaults
              </button>
              {(Object.keys(DEFAULT_LAYOUT) as WidgetId[]).map((id) => {
                const hidden = layout.hidden?.includes(id);
                return (
                  <button
                    key={id}
                    className="btn sm"
                    onClick={() =>
                      saveLayout({
                        widgets: layout.widgets ?? DEFAULT_LAYOUT,
                        hidden: hidden ? (layout.hidden ?? []).filter((h) => h !== id) : [...(layout.hidden ?? []), id],
                      })
                    }
                  >
                    {hidden ? "Show" : "Hide"} {WIDGETS.find((w) => w.id === id)?.label}
                  </button>
                );
              })}
            </>
          ) : null}
        </div>
        <span className="faint" style={{ fontSize: 12 }}>{layoutReady ? "" : "Loading layout…"}</span>
      </div>

      <div style={{ position: "relative", display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridAutoRows: `${ROW_PX}px`, gap: GAP }}>
        {WIDGETS.filter((w) => !layout.hidden?.includes(w.id)).map((w) => {
          const pos = layout.widgets?.[w.id] ?? DEFAULT_LAYOUT[w.id];
          return (
            <div
              key={w.id}
              className="panel"
              style={{
                gridColumn: `${pos.x + 1} / span ${pos.w}`,
                gridRow: `${pos.y + 1} / span ${pos.h}`,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                outline: editMode ? "1.5px dashed rgba(111, 201, 130, 0.5)" : "none",
                cursor: editMode ? "move" : "default",
                transition: dragState.current ? "none" : "box-shadow 0.15s ease",
              }}
            >
              <div className="panel-header" onMouseDown={onMouseDown(w.id, "move")} style={{ cursor: editMode ? "move" : "default" }}>
                <div className="panel-title">{w.label}</div>
                {editMode ? (
                  <div className="row" style={{ gap: 6 }} onMouseDown={(e) => e.stopPropagation()}>
                    <button className="btn sm ghost" style={{ cursor: "nwse-resize" }} onMouseDown={onMouseDown(w.id, "resize")} aria-label="Resize widget">⤢</button>
                  </div>
                ) : null}
              </div>
              <div className="panel-body grow" style={{ overflow: "auto", padding: 14 }}>
                <WidgetBody id={w.id} {...{ status, players, activity, consoleLines, falixStatus, mcOnline, online, max, serverName, me, busySignal, actionError, power, powerScope }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WidgetBody(props: {
  id: WidgetId;
  status: StatusPayload | null;
  players: PlayerRow[];
  activity: { id: number; type: string; message: string | null; playerName: string | null; createdAt: string }[];
  consoleLines: string[];
  falixStatus: string;
  mcOnline: boolean;
  online: number;
  max: number | null;
  serverName: string;
  me: Me | null;
  busySignal: string | null;
  actionError: string | null;
  power: (s: "start" | "stop" | "restart") => void;
  /** Per-user server power grant: full | start | none. */
  powerScope: "full" | "start" | "none";
}) {
  const { id, status, players, activity, consoleLines, falixStatus, mcOnline, online, max, serverName, me, busySignal, actionError, power, powerScope } = props;
  const canPower = powerScope !== "none";
  const canStopRestart = powerScope === "full";

  if (id === "server-status") {
    const running = falixStatus === "running";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
        <div className="spread">
          <StatusBadge status={running ? "online" : falixStatus === "starting" ? "starting" : "offline"} />
          <span className="faint" style={{ fontSize: 12 }}>{status?.minecraft?.latencyMs != null ? `${status.minecraft.latencyMs} ms` : ""}</span>
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{serverName}</div>
          <div className="dim mono" style={{ fontSize: 12.5 }}>{status?.server?.address ?? `${status?.config?.host ?? "—"}:${status?.config?.port ?? ""}`}</div>
        </div>
        <div className="row" style={{ gap: 14, fontSize: 12.5, color: "var(--text-dim)", flexWrap: "wrap" }}>
          {status?.minecraft?.version ? <span>🏷 {status.minecraft.version}</span> : null}
          {status?.falix?.resources?.uptime ? <span>⏱ {formatDuration(status.falix.resources.uptime)}</span> : null}
          {status?.falix?.resources ? <span>🧠 {(status.falix.resources.memory / 1024 / 1024).toFixed(0)} MB</span> : null}
        </div>
        {status?.falix?.error ? <div style={{ fontSize: 12, color: "var(--warn)" }}>Falix: {status.falix.error}</div> : null}
      </div>
    );
  }

  if (id === "controls") {
    const running = falixStatus === "running";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%", justifyContent: "center" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canPower ? (
            <>
              <button className="btn primary" disabled={running || busySignal !== null} onClick={() => power("start")}>
                {busySignal === "start" ? <span className="spinner" /> : "▶ Start"}
              </button>
              {canStopRestart ? (
                <>
                  <button className="btn danger" disabled={!running || busySignal !== null} onClick={() => power("stop")}>
                    {busySignal === "stop" ? <span className="spinner" /> : "■ Stop"}
                  </button>
                  <button className="btn" disabled={!running || busySignal !== null} onClick={() => power("restart")}>
                    {busySignal === "restart" ? <span className="spinner" /> : "↻ Restart"}
                  </button>
                </>
              ) : null}
            </>
          ) : null}
        </div>
        {actionError ? <div style={{ fontSize: 12.5, color: "var(--danger)" }}>{actionError}</div> : null}
        {!me || me.user.role !== "admin" ? (
          <div className="faint" style={{ fontSize: 11.5 }}>Server controls are restricted to administrators.</div>
        ) : null}
      </div>
    );
  }

  if (id === "player-count") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 4 }}>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em" }}>
          {mcOnline || falixStatus === "running" ? online : "—"}
          <span className="dim" style={{ fontSize: 17, fontWeight: 600 }}> / {max ?? "?"}</span>
        </div>
        <div className="faint" style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.08em" }}>players online</div>
        {max != null && max > 0 ? (
          <div style={{ width: "70%", height: 6, borderRadius: 4, background: "rgba(148,163,184,0.15)", overflow: "hidden", marginTop: 4 }}>
            <div style={{ width: `${Math.min(100, (online / max) * 100)}%`, height: "100%", background: "linear-gradient(90deg, var(--accent), var(--accent-strong))", transition: "width 0.5s ease" }} />
          </div>
        ) : null}
      </div>
    );
  }

  if (id === "current-players") {
    if (players.length === 0) {
      return <EmptyState icon="players" title="Nobody is online right now" hint="Players appear here as soon as they join the server." />;
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {players.map((p) => (
          <div key={p.username} className="row" style={{ padding: "6px 8px", borderRadius: 8, background: "rgba(148,163,184,0.05)" }}>
            <McHead username={p.username} headUrl={p.headUrl} size={30} />
            <div className="grow">
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.username}</div>
              <div className="faint" style={{ fontSize: 11.5 }}>Playtime {formatDuration(p.playtimeSeconds)}</div>
            </div>
            <span className="badge green"><span className="dot green" style={{ width: 6, height: 6 }} />online</span>
          </div>
        ))}
      </div>
    );
  }

  if (id === "activity") {
    if (activity.length === 0) {
      return <EmptyState icon="activity" title="No activity yet" hint="Joins, deaths and server events will show up here." />;
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {activity.map((e) => (
          <div key={e.id} className="row" style={{ fontSize: 13 }}>
            <EventIcon type={e.type} />
            <span className="grow ellipsis">
              {e.playerName ? <strong>{e.playerName}</strong> : null} {e.message ?? e.type}
            </span>
            <span className="faint" style={{ fontSize: 11.5, flexShrink: 0 }}>{formatRelative(e.createdAt)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mono" style={{ fontSize: 11.5, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", height: "100%", overflow: "auto" }}>
      {consoleLines.length === 0 ? (
        <span className="dim">No console output yet. The console tail appears when the server has written to its log.</span>
      ) : (
        consoleLines.map((l, i) => <div key={i} style={{ color: /error|exception/i.test(l) ? "#f08a85" : /warn/i.test(l) ? "var(--warn)" : "var(--text-dim)" }}>{l}</div>)
      )}
    </div>
  );
}

import { PixelIconView, type IconName } from "@/components/icons";

const ICON_BY_EVENT: Record<string, { icon: IconName; color: string }> = {
  player_join: { icon: "players", color: "var(--accent-strong)" },
  player_leave: { icon: "players", color: "var(--text-faint)" },
  player_death: { icon: "heart", color: "var(--danger)" },
  grave_created: { icon: "graves", color: "var(--warn)" },
  grave_removed: { icon: "pickaxe", color: "var(--text-dim)" },
  chat_message: { icon: "chat", color: "var(--info)" },
  server_start: { icon: "dashboard", color: "var(--accent-strong)" },
  server_stop: { icon: "dashboard", color: "var(--danger)" },
  server_restart: { icon: "console", color: "var(--warn)" },
  server_crash: { icon: "creeper", color: "var(--danger)" },
};

function EventIcon({ type }: { type: string }) {
  const e = ICON_BY_EVENT[type] ?? { icon: "pickaxe" as IconName, color: "var(--text-faint)" };
  return <PixelIconView name={e.icon} size={15} style={{ opacity: 0.9, filter: `drop-shadow(0 0 3px ${e.color})` }} />;
}
