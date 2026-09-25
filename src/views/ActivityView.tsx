import React from "react";
import { api } from "@/lib/client/api";
import { useRealtime, formatRelative } from "@/lib/client/realtime";
import { McHead, Panel, EmptyState, SkeletonRows } from "@/components/ui";
import { PixelIconView, type IconName } from "@/components/icons";

interface EventRow {
  id: number;
  type: string;
  source: string;
  playerName: string | null;
  message: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  headUrl: string | null;
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "joins", label: "Joins" },
  { id: "leaves", label: "Leaves" },
  { id: "deaths", label: "Deaths" },
  { id: "graves", label: "Graves" },
  { id: "chat", label: "Chat" },
  { id: "server", label: "Server" },
  { id: "admin", label: "Admin" },
];

const EVENT_ICON: Record<string, { icon: IconName; color: string }> = {
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
  server_event: { icon: "console", color: "var(--text-dim)" },
  admin_action: { icon: "shield", color: "var(--info)" },
};

function EventIcon({ type }: { type: string }) {
  const e = EVENT_ICON[type] ?? { icon: "pickaxe" as IconName, color: "var(--text-faint)" };
  return (
    <PixelIconView
      name={e.icon}
      size={16}
      style={{ opacity: 0.95, filter: `drop-shadow(0 0 3px ${e.color})` }}
    />
  );
}

const LABELS: Record<string, string> = {
  player_join: "joined",
  player_leave: "left",
  player_death: "died",
  grave_created: "grave created",
  grave_removed: "grave removed",
  chat_message: "chat",
  server_start: "server started",
  server_stop: "server stopped",
  server_restart: "server restarted",
  server_crash: "server crashed",
  server_event: "server event",
  admin_action: "admin action",
};

export default function ActivityView() {
  const [events, setEvents] = React.useState<EventRow[]>([]);
  const [filter, setFilter] = React.useState("all");
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);

  const load = React.useCallback(() => {
    setLoading(true);
    api
      .get<{ events: EventRow[]; hasMore: boolean }>(`/api/activity?filter=${filter}&limit=40`)
      .then((r) => {
        setEvents(r.events || []);
        setHasMore(r.hasMore || false);
      })
      .finally(() => setLoading(false));
  }, [filter]);

  React.useEffect(load, [load]);

  useRealtime((type) => {
    if (type === "event") load();
  });

  async function loadMore() {
    if (events.length === 0) return;
    setLoadingMore(true);
    const last = events[events.length - 1]?.id;
    try {
      const r = await api.get<{ events: EventRow[]; hasMore: boolean }>(
        `/api/activity?filter=${filter}&limit=40&before=${last}`,
      );
      setEvents((prev) => [...prev, ...(r.events || [])]);
      setHasMore(r.hasMore || false);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 20 }}>Activity</h1>
        <p className="dim" style={{ margin: 0, fontSize: 13 }}>
          Everything happening on the server, in order.
        </p>
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`btn sm ${filter === f.id ? "primary" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Panel bodyStyle={{ padding: 0 }}>
        {loading && events.length === 0 ? (
          <div style={{ padding: 16 }}>
            <SkeletonRows rows={7} />
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon="activity"
            title="No events for this filter"
            hint="Events stream in from the Minecraft integration and the control panel itself."
          />
        ) : (
          <>
            {events.map((e) => (
              <div
                key={e.id}
                className="row"
                style={{
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--border)",
                  alignItems: "flex-start",
                }}
              >
                <span style={{ width: 24, display: "grid", placeItems: "center" }}>
                  <EventIcon type={e.type} />
                </span>
                {e.playerName ? (
                  <McHead username={e.playerName} headUrl={e.headUrl} size={24} />
                ) : (
                  <span style={{ width: 24 }} />
                )}
                <div className="grow">
                  <div style={{ fontSize: 13 }}>
                    {e.playerName ? <strong>{e.playerName} </strong> : null}
                    {LABELS[e.type] ?? e.type}
                    {e.message ? <span className="dim"> — {e.message}</span> : null}
                  </div>
                  <div className="faint" style={{ fontSize: 11 }}>
                    {e.source} · {new Date(e.createdAt).toLocaleString()} · {formatRelative(e.createdAt)}
                  </div>
                </div>
              </div>
            ))}
            {hasMore ? (
              <div style={{ padding: 12, textAlign: "center" }}>
                <button className="btn sm" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </Panel>
    </div>
  );
}
