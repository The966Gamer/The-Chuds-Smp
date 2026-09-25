import React from "react";
import { api } from "@/lib/client/api";
import { useRealtime, formatRelative, formatCountdown } from "@/lib/client/realtime";
import { McHead, Panel, EmptyState, SkeletonRows } from "@/components/ui";

interface Grave {
  id: number;
  graveKey: string;
  playerName: string;
  x: number;
  y: number;
  z: number;
  dimension: string;
  deathTime: string;
  despawnAt: string | null;
  remainingMs: number | null;
  status: string;
  headUrl: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  active: "amber",
  recovered: "green",
  despawned: "gray",
  expired: "gray",
};

export default function GravesView() {
  const [graves, setGraves] = React.useState<Grave[]>([]);
  const [status, setStatus] = React.useState("active");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<Grave | null>(null);
  const [copied, setCopied] = React.useState(false);

  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const load = React.useCallback(() => {
    setLoading(true);
    api
      .get<{ graves: Grave[] }>(`/api/graves?status=${status}&pageSize=50`)
      .then((r) => {
        setGraves(r.graves || []);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load graves"))
      .finally(() => setLoading(false));
  }, [status]);

  React.useEffect(load, [load]);

  useRealtime((type) => {
    if (type === "event") load();
  });

  function dimensionLabel(dim: string): string {
    const d = dim.toLowerCase();
    if (d.includes("nether")) return "Nether";
    if (d.includes("end")) return "The End";
    return "Overworld";
  }

  function locateCommand(g: Grave): string {
    return `/execute in ${g.dimension} run tp @s ${g.x} ${g.y} ${g.z}`;
  }

  function copyTpCommand(g: Grave) {
    const cmd = locateCommand(g);
    navigator.clipboard?.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 20 }}>Graves</h1>
          <p className="dim" style={{ margin: 0, fontSize: 13 }}>
            Death chests reported by the Minecraft integration. Protection is preserved.
          </p>
        </div>
        <select className="select" style={{ width: 180 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="recovered">Recovered</option>
          <option value="despawned">Despawned</option>
          <option value="expired">Expired</option>
          <option value="">All statuses</option>
        </select>
      </div>

      {error ? (
        <div className="error-state">{error}</div>
      ) : loading && graves.length === 0 ? (
        <Panel>
          <SkeletonRows rows={5} />
        </Panel>
      ) : graves.length === 0 ? (
        <Panel>
          <EmptyState
            icon="graves"
            title={status === "active" ? "No active graves" : "No graves in this state"}
            hint="Graves appear here the moment a player dies and the Minecraft integration reports GRAVE_CREATED. Protection is enforced in-game by the mod."
          />
        </Panel>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
          {graves.map((g) => {
            const remaining = g.despawnAt ? new Date(g.despawnAt).getTime() - Date.now() : g.remainingMs;
            return (
              <button
                key={g.id}
                className="panel mc-dirt-bed"
                style={{ padding: 14, textAlign: "left", color: "var(--text)", font: "inherit", cursor: "pointer" }}
                onClick={() => setDetail(g)}
              >
                <div className="row" style={{ marginBottom: 8 }}>
                  <McHead username={g.playerName} headUrl={g.headUrl} size={30} />
                  <strong style={{ fontSize: 14 }}>{g.playerName}</strong>
                  <span className={`badge ${STATUS_BADGE[g.status] ?? "gray"}`} style={{ marginLeft: "auto" }}>
                    {g.status}
                  </span>
                </div>
                <div className="mono dim" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                  X: {g.x} · Y: {g.y} · Z: {g.z}
                  <br />
                  Dimension: {dimensionLabel(g.dimension)}
                  <br />
                  Died: {formatRelative(g.deathTime)}
                  <br />
                  Despawn:{" "}
                  {g.status === "active" && remaining !== null
                    ? formatCountdown(remaining)
                    : g.status === "active"
                      ? "—"
                      : "n/a"}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {detail ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(4,6,10,0.6)",
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setDetail(null)}
        >
          <div
            className="panel fade-in"
            style={{ width: "min(440px, 92vw)", padding: 22 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="spread" style={{ marginBottom: 12 }}>
              <div className="row">
                <McHead username={detail.playerName} headUrl={detail.headUrl} size={40} />
                <div>
                  <h2 style={{ fontSize: 16 }}>{detail.playerName}&apos;s grave</h2>
                  <div className="faint mono" style={{ fontSize: 11.5 }}>
                    {detail.graveKey}
                  </div>
                </div>
              </div>
              <button className="btn sm ghost" onClick={() => setDetail(null)}>
                ✕
              </button>
            </div>

            <div
              className="mono"
              style={{
                fontSize: 13,
                lineHeight: 1.8,
                background: "rgba(0,0,0,0.25)",
                padding: 12,
                borderRadius: 4,
                marginBottom: 16,
              }}
            >
              <div><strong>Status:</strong> <span className={`badge ${STATUS_BADGE[detail.status] ?? "gray"}`}>{detail.status}</span></div>
              <div><strong>Coordinates:</strong> {detail.x}, {detail.y}, {detail.z}</div>
              <div><strong>Dimension:</strong> {dimensionLabel(detail.dimension)} ({detail.dimension})</div>
              <div><strong>Died:</strong> {new Date(detail.deathTime).toLocaleString()} ({formatRelative(detail.deathTime)})</div>
              {detail.despawnAt ? (
                <div><strong>Despawns:</strong> {new Date(detail.despawnAt).toLocaleTimeString()} ({formatCountdown(new Date(detail.despawnAt).getTime() - Date.now())})</div>
              ) : null}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="faint" style={{ fontSize: 11.5 }}>Teleport command for admins:</div>
              <div className="row">
                <input
                  className="input mono"
                  style={{ fontSize: 11.5 }}
                  readOnly
                  value={locateCommand(detail)}
                />
                <button className="btn sm primary" onClick={() => copyTpCommand(detail)}>
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
