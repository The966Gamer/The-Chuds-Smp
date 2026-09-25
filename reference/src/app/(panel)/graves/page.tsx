"use client";

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

export default function GravesPage() {
  const [graves, setGraves] = React.useState<Grave[]>([]);
  const [status, setStatus] = React.useState("active");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<Grave | null>(null);
  const [locateState, setLocateState] = React.useState<"idle" | "sent" | "error" | "no-perm">("idle");
  const [meRole, setMeRole] = React.useState<string>("");

  React.useEffect(() => {
    api
      .get<{ user: { role: string } }>("/api/auth/me")
      .then((m) => setMeRole(m.user.role))
      .catch(() => undefined);
  }, []);

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
        setGraves(r.graves);
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

  return (
    <div>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 20 }}>Graves</h1>
          <p className="dim" style={{ margin: 0, fontSize: 13 }}>
            Death chests reported by the Minecraft integration. The game server enforces protection.
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
        <Panel><SkeletonRows rows={5} /></Panel>
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
          {graves.map((g) => (
            <button
              key={g.id}
              className="panel mc-dirt-bed"
              style={{ padding: 14, textAlign: "left", color: "var(--text)", font: "inherit", cursor: "pointer" }}
              onClick={() => {
                setDetail(g);
                setLocateState("idle");
              }}
            >
              <div className="row" style={{ marginBottom: 8 }}>
                <McHead username={g.playerName} headUrl={g.headUrl} size={30} />
                <strong style={{ fontSize: 14 }}>{g.playerName}</strong>
                <span className={`badge ${STATUS_BADGE[g.status] ?? "gray"}`} style={{ marginLeft: "auto" }}>{g.status}</span>
              </div>
              <div className="mono dim" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                X: {g.x} · Y: {g.y} · Z: {g.z}
                <br />
                Dimension: {dimensionLabel(g.dimension)}
                <br />
                Died: {formatRelative(g.deathTime)}
                <br />
                Despawn: {g.status === "active" && g.remainingMs !== null ? formatCountdown(g.remainingMs) : g.status === "active" ? "—" : "n/a"}
              </div>
            </button>
          ))}
        </div>
      )}

      {detail ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(4,6,10,0.6)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setDetail(null)}>
          <div className="panel fade-in" style={{ width: "min(440px, 92vw)", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <div className="spread" style={{ marginBottom: 12 }}>
              <div className="row">
                <McHead username={detail.playerName} headUrl={detail.headUrl} size={40} />
                <div>
                  <h2 style={{ fontSize: 16 }}>{detail.playerName}&apos;s grave</h2>
                  <div className="faint mono" style={{ fontSize: 11.5 }}>{detail.graveKey}</div>
                </div>
              </div>
              <button className="btn sm ghost" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
              <div className="spread"><span className="dim">Location</span><span className="mono">{detail.x}, {detail.y}, {detail.z}</span></div>
              <div className="spread"><span className="dim">Dimension</span><span>{dimensionLabel(detail.dimension)}</span></div>
              <div className="spread"><span className="dim">Died</span><span>{new Date(detail.deathTime).toLocaleString()}</span></div>
              <div className="spread"><span className="dim">Despawns</span><span>{detail.despawnAt ? new Date(detail.despawnAt).toLocaleString() : "—"}</span></div>
              <div className="spread"><span className="dim">Remaining</span><span>{detail.status === "active" ? formatCountdown(detail.remainingMs) : "—"}</span></div>
              <div className="spread"><span className="dim">Status</span><span className={`badge ${STATUS_BADGE[detail.status] ?? "gray"}`}>{detail.status}</span></div>
            </div>
            <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: "rgba(148,163,184,0.06)" }}>
              <div className="panel-title" style={{ fontSize: 10.5, marginBottom: 6 }}>Teleport command (admin/moderator, run in console)</div>
              <code className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{locateCommand(detail)}</code>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              {meRole === "admin" || meRole === "moderator" ? (
                <button
                  className="btn primary"
                  disabled={locateState === "sent"}
                  onClick={async () => {
                    try {
                      await api.post("/api/console/command", { command: locateCommand(detail) });
                      setLocateState("sent");
                    } catch {
                      setLocateState("error");
                    }
                  }}
                >
                  {locateState === "sent" ? "✔ Teleported" : locateState === "error" ? "Failed — try copy instead" : "Teleport me there (console)"}
                </button>
              ) : (
                <span className="faint" style={{ fontSize: 12 }}>Teleporting requires moderator or admin.</span>
              )}
              <button
                className="btn"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(locateCommand(detail));
                    setLocateState("sent");
                  } catch {
                    setLocateState("error");
                  }
                }}
              >
                {locateState === "sent" ? "✔ Copied" : locateState === "error" ? "Copy failed" : "Copy teleport command"}
              </button>
            </div>
            <p className="faint" style={{ fontSize: 11.5, marginTop: 12 }}>
              Protection is enforced by the Minecraft mod itself (only the owner — or players the owner allows — can open the grave). This panel is a view, not the authority.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
