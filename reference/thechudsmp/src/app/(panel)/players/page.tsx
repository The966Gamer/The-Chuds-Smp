"use client";

import React from "react";
import { api } from "@/lib/client/api";
import { formatRelative, formatDuration } from "@/lib/client/realtime";
import { McHead, Panel, EmptyState, SkeletonRows, StatusBadge } from "@/components/ui";

interface PlayerRow {
  username: string;
  headUrl: string | null;
  online: boolean;
  firstSeen: string | null;
  lastSeen: string | null;
  playtimeSeconds: number;
  permissionLevel: string;
  joins: number;
  deaths: number;
}

interface Detail {
  player: PlayerRow & { uuid: string | null };
  statistics: { key: string; value: number }[];
  events: { id: number; type: string; message: string | null; created_at: string }[];
  graves: { id: number; x: number; y: number; z: number; dimension: string; death_time: string; status: string }[];
}

export default function PlayersPage() {
  const [players, setPlayers] = React.useState<PlayerRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);

  const load = React.useCallback(() => {
    setLoading(true);
    api
      .get<{ players: PlayerRow[]; total: number }>(
        `/api/players?page=${page}&pageSize=25&search=${encodeURIComponent(search)}`,
      )
      .then((r) => {
        setPlayers(r.players);
        setTotal(r.total);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load players"))
      .finally(() => setLoading(false));
  }, [page, search]);

  React.useEffect(load, [load]);

  async function open(name: string) {
    setDetailLoading(true);
    try {
      const r = await api.get<Detail>(`/api/players/${encodeURIComponent(name)}`);
      setSelected(r);
    } catch {
      setSelected(null);
    } finally {
      setDetailLoading(false);
    }
  }

  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 20 }}>Players</h1>
          <p className="dim" style={{ margin: 0, fontSize: 13 }}>Everyone who has joined the server.</p>
        </div>
        <input
          className="input"
          style={{ width: 220 }}
          placeholder="Search players…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {error ? (
        <div className="error-state">{error}</div>
      ) : loading && players.length === 0 ? (
        <Panel><SkeletonRows rows={6} /></Panel>
      ) : players.length === 0 ? (
        <Panel>
          <EmptyState
            icon="players"
            title="No players yet"
            hint="Players are created automatically the first time they join the Minecraft server (or when the integration reports a join)."
          />
        </Panel>
      ) : (
        <Panel bodyStyle={{ padding: 0 }}>
          <div>
            {players.map((p) => (
              <button
                key={p.username}
                onClick={() => open(p.username)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  width: "100%",
                  padding: "10px 16px",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  color: "var(--text)",
                  cursor: "pointer",
                  textAlign: "left",
                  font: "inherit",
                }}
              >
                <McHead username={p.username} headUrl={p.headUrl} size={34} />
                <div className="grow">
                  <div className="row" style={{ gap: 8 }}>
                    <strong style={{ fontSize: 13.5 }}>{p.username}</strong>
                    {p.online ? <StatusBadge status="online" /> : <span className="badge gray">offline</span>}
                  </div>
                  <div className="faint" style={{ fontSize: 11.5 }}>
                    Last seen {formatRelative(p.lastSeen)} · {formatDuration(p.playtimeSeconds)} played · {p.joins} joins
                  </div>
                </div>
                <span className={`badge ${p.permissionLevel === "admin" ? "red" : p.permissionLevel === "moderator" ? "amber" : "gray"}`}>
                  {p.permissionLevel}
                </span>
              </button>
            ))}
          </div>
          <div className="spread" style={{ padding: "10px 16px" }}>
            <span className="faint" style={{ fontSize: 12 }}>
              {total} players · page {page} / {pages}
            </span>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
              <button className="btn sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          </div>
        </Panel>
      )}

      {/* Detail drawer */}
      {selected || detailLoading ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(4, 6, 10, 0.6)",
            zIndex: 60,
            display: "flex",
            justifyContent: "flex-end",
          }}
          onClick={() => setSelected(null)}
        >
          <div
            className="panel fade-in"
            style={{
              width: "min(480px, 100vw)",
              height: "100vh",
              borderRadius: 0,
              borderTop: "none",
              borderBottom: "none",
              borderRight: "none",
              overflowY: "auto",
              padding: 22,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading || !selected ? (
              <SkeletonRows rows={5} />
            ) : (
              <>
                <div className="spread" style={{ marginBottom: 16 }}>
                  <div className="row">
                    <McHead username={selected.player.username} headUrl={selected.player.headUrl} size={48} />
                    <div>
                      <h2 style={{ fontSize: 17 }}>{selected.player.username}</h2>
                      <div className="faint" style={{ fontSize: 12 }}>
                        {selected.player.online ? "Online now" : `Last seen ${formatRelative(selected.player.lastSeen)}`}
                      </div>
                    </div>
                  </div>
                  <button className="btn sm ghost" onClick={() => setSelected(null)}>✕</button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                  <Stat label="First seen" value={formatRelative(selected.player.firstSeen)} />
                  <Stat label="Playtime" value={formatDuration(selected.player.playtimeSeconds)} />
                  <Stat label="Joins" value={String(selected.player.joins)} />
                  <Stat label="Deaths" value={String(selected.player.deaths)} />
                </div>

                <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-dim)", margin: "16px 0 8px" }}>
                  Statistics
                </h3>
                {selected.statistics.length === 0 ? (
                  <div className="faint" style={{ fontSize: 12.5 }}>No statistics reported yet — the Minecraft integration sends them during play.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {selected.statistics.slice(0, 20).map((s) => (
                      <div key={s.key} className="spread" style={{ fontSize: 13 }}>
                        <span className="dim">{prettifyStat(s.key)}</span>
                        <strong>{s.value.toLocaleString()}</strong>
                      </div>
                    ))}
                  </div>
                )}

                <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-dim)", margin: "16px 0 8px" }}>
                  Recent graves
                </h3>
                {selected.graves.length === 0 ? (
                  <div className="faint" style={{ fontSize: 12.5 }}>No graves recorded.</div>
                ) : (
                  selected.graves.map((g) => (
                    <div key={g.id} style={{ fontSize: 12.5, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                      Graves: {g.dimension} · {g.x}, {g.y}, {g.z} · {formatRelative(g.death_time)} · {g.status}
                    </div>
                  ))
                )}

                <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-dim)", margin: "16px 0 8px" }}>
                  Recent activity
                </h3>
                {selected.events.length === 0 ? (
                  <div className="faint" style={{ fontSize: 12.5 }}>No events recorded.</div>
                ) : (
                  selected.events.map((e) => (
                    <div key={e.id} style={{ fontSize: 12.5, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                      {e.message ?? e.type} <span className="faint">· {formatRelative(e.created_at)}</span>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 10, borderRadius: 8, background: "rgba(148,163,184,0.06)" }}>
      <div className="faint" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function prettifyStat(key: string): string {
  return key
    .replace(/^minecraft:/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
