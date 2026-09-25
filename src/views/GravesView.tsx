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

  // Modals
  const [showLogModal, setShowLogModal] = React.useState(false);
  const [showGuideModal, setShowGuideModal] = React.useState(false);
  const [guideTab, setGuideTab] = React.useState<"kubejs" | "fabric" | "webhook">("kubejs");
  const [guideCopied, setGuideCopied] = React.useState(false);
  const [logSubmitting, setLogSubmitting] = React.useState(false);
  const [logError, setLogError] = React.useState<string | null>(null);

  // Form state
  const [playerName, setPlayerName] = React.useState("");
  const [coordX, setCoordX] = React.useState("");
  const [coordY, setCoordY] = React.useState("64");
  const [coordZ, setCoordZ] = React.useState("");
  const [dimension, setDimension] = React.useState("minecraft:overworld");
  const [despawnMins, setDespawnMins] = React.useState("60");

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

  async function handleMarkStatus(graveKey: string, newStatus: string) {
    try {
      await api.patch(`/api/graves/${encodeURIComponent(graveKey)}`, { status: newStatus });
      setDetail(null);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update grave");
    }
  }

  async function handleLogSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!playerName.trim() || coordX === "" || coordY === "" || coordZ === "") {
      setLogError("Please provide player name and valid X, Y, Z coordinates.");
      return;
    }
    setLogSubmitting(true);
    setLogError(null);

    try {
      await api.post("/api/graves", {
        playerName: playerName.trim(),
        x: Number(coordX),
        y: Number(coordY),
        z: Number(coordZ),
        dimension,
        despawnMinutes: Number(despawnMins) || 60,
      });
      setShowLogModal(false);
      setPlayerName("");
      setCoordX("");
      setCoordY("64");
      setCoordZ("");
      load();
    } catch (err) {
      setLogError(err instanceof Error ? err.message : "Failed to log grave");
    } finally {
      setLogSubmitting(false);
    }
  }

  return (
    <div>
      <div className="spread" style={{ marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 20 }}>Graves Tracker</h1>
          <p className="dim" style={{ margin: 0, fontSize: 13 }}>
            Track player death locations, GPS coordinates, and despawn countdowns.
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <select className="select" style={{ width: 140 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="recovered">Recovered</option>
            <option value="despawned">Despawned</option>
            <option value="expired">Expired</option>
            <option value="">All statuses</option>
          </select>
          <button className="btn sm ghost" onClick={() => setShowGuideModal(true)}>
            🔗 How to Connect Mod
          </button>
          <button className="btn sm primary" onClick={() => setShowLogModal(true)}>
            + Log Grave
          </button>
        </div>
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
            hint="Graves appear here automatically when reported by a Minecraft webhook mod, or when logged manually using the '+ Log Grave' button."
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

      {/* Detail Modal */}
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

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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

              {detail.status === "active" && (
                <div className="row" style={{ marginTop: 6, gap: 8 }}>
                  <button
                    className="btn sm"
                    style={{ flex: 1, background: "rgba(46, 204, 113, 0.15)", borderColor: "rgba(46, 204, 113, 0.4)", color: "#2ecc71" }}
                    onClick={() => handleMarkStatus(detail.graveKey, "recovered")}
                  >
                    ✓ Mark Recovered
                  </button>
                  <button
                    className="btn sm ghost"
                    style={{ color: "#e74c3c" }}
                    onClick={() => handleMarkStatus(detail.graveKey, "expired")}
                  >
                    Mark Expired
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Manual Log Modal */}
      {showLogModal && (
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
          onClick={() => setShowLogModal(false)}
        >
          <form
            className="panel fade-in"
            style={{ width: "min(420px, 92vw)", padding: 22 }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleLogSubmit}
          >
            <div className="spread" style={{ marginBottom: 14 }}>
              <h2 style={{ fontSize: 16 }}>Log a Grave</h2>
              <button type="button" className="btn sm ghost" onClick={() => setShowLogModal(false)}>
                ✕
              </button>
            </div>

            {logError && (
              <div className="error-state" style={{ marginBottom: 12 }}>
                {logError}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label className="dim" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                  Player Username
                </label>
                <input
                  className="input"
                  placeholder="e.g. SuperDuck220"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="dim" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                  Coordinates (X, Y, Z)
                </label>
                <div className="row" style={{ gap: 6 }}>
                  <input
                    className="input mono"
                    placeholder="X"
                    value={coordX}
                    onChange={(e) => setCoordX(e.target.value)}
                    required
                  />
                  <input
                    className="input mono"
                    placeholder="Y"
                    value={coordY}
                    onChange={(e) => setCoordY(e.target.value)}
                    required
                  />
                  <input
                    className="input mono"
                    placeholder="Z"
                    value={coordZ}
                    onChange={(e) => setCoordZ(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="dim" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                  Dimension
                </label>
                <select
                  className="select"
                  value={dimension}
                  onChange={(e) => setDimension(e.target.value)}
                >
                  <option value="minecraft:overworld">Overworld</option>
                  <option value="minecraft:the_nether">The Nether</option>
                  <option value="minecraft:the_end">The End</option>
                </select>
              </div>

              <div>
                <label className="dim" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                  Despawn Expiry (minutes)
                </label>
                <input
                  type="number"
                  className="input mono"
                  min="1"
                  max="1440"
                  value={despawnMins}
                  onChange={(e) => setDespawnMins(e.target.value)}
                />
              </div>

              <div className="row" style={{ marginTop: 8, justifyContent: "flex-end", gap: 8 }}>
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => setShowLogModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn sm primary"
                  disabled={logSubmitting}
                >
                  {logSubmitting ? "Saving..." : "Save Grave"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Guide Modal */}
      {showGuideModal && (
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
          onClick={() => setShowGuideModal(false)}
        >
          <div
            className="panel fade-in"
            style={{ width: "min(640px, 94vw)", maxHeight: "88vh", overflowY: "auto", padding: 22 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="spread" style={{ marginBottom: 14 }}>
              <h2 style={{ fontSize: 16 }}>Connecting Grave Mod to Panel</h2>
              <button className="btn sm ghost" onClick={() => setShowGuideModal(false)}>
                ✕
              </button>
            </div>

            <div className="row" style={{ gap: 6, marginBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 8 }}>
              <button
                className={`btn sm ${guideTab === "kubejs" ? "primary" : "ghost"}`}
                onClick={() => { setGuideTab("kubejs"); setGuideCopied(false); }}
              >
                1. KubeJS Script (Instant)
              </button>
              <button
                className={`btn sm ${guideTab === "fabric" ? "primary" : "ghost"}`}
                onClick={() => { setGuideTab("fabric"); setGuideCopied(false); }}
              >
                2. Fabric Mod (Java)
              </button>
              <button
                className={`btn sm ${guideTab === "webhook" ? "primary" : "ghost"}`}
                onClick={() => { setGuideTab("webhook"); setGuideCopied(false); }}
              >
                3. Raw Webhook / cURL
              </button>
            </div>

            {guideTab === "kubejs" && (
              <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 12 }}>
                <p style={{ margin: 0 }}>
                  <strong>Fastest way:</strong> If you have <strong>KubeJS</strong> in your server&apos;s <code>/mods</code>, create this file in <code>kubejs/server_scripts/grave_sync.js</code>:
                </p>
                <div style={{ position: "relative" }}>
                  <pre className="mono" style={{ background: "rgba(0,0,0,0.4)", padding: 12, borderRadius: 6, fontSize: 11.5, overflowX: "auto", maxHeight: 220 }}>
{`// kubejs/server_scripts/grave_sync.js
const PANEL_URL = "${typeof window !== "undefined" ? window.location.origin : ""}/api/mc/event";
const SECRET_KEY = "chudsmp-secret";

PlayerEvents.died(event => {
    const p = event.player;
    const name = p.username;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    const z = Math.floor(p.z);
    const dim = p.level.dimension.location().toString();

    JsonIO.post(PANEL_URL, {
        type: "grave_created",
        playerName: name,
        message: name + " died in " + dim,
        data: {
            graveKey: "grave-" + name.toLowerCase() + "-" + Date.now(),
            x: x, y: y, z: z,
            dimension: dim,
            despawnMinutes: 60
        }
    }, {
        "Content-Type": "application/json",
        "x-integration-key": SECRET_KEY
    });
});`}
                  </pre>
                  <button
                    className="btn sm"
                    style={{ position: "absolute", top: 8, right: 8 }}
                    onClick={() => {
                      const code = `const PANEL_URL = "${window.location.origin}/api/mc/event";\nconst SECRET_KEY = "chudsmp-secret";\n\nPlayerEvents.died(event => {\n    const p = event.player;\n    const name = p.username;\n    const x = Math.floor(p.x);\n    const y = Math.floor(p.y);\n    const z = Math.floor(p.z);\n    const dim = p.level.dimension.location().toString();\n\n    JsonIO.post(PANEL_URL, {\n        type: "grave_created",\n        playerName: name,\n        message: name + " died in " + dim,\n        data: {\n            graveKey: "grave-" + name.toLowerCase() + "-" + Date.now(),\n            x: x, y: y, z: z,\n            dimension: dim,\n            despawnMinutes: 60\n        }\n    }, {\n        "Content-Type": "application/json",\n        "x-integration-key": SECRET_KEY\n    });\n});`;
                      navigator.clipboard?.writeText(code);
                      setGuideCopied(true);
                      setTimeout(() => setGuideCopied(false), 2000);
                    }}
                  >
                    {guideCopied ? "✓ Copied Script" : "Copy Script"}
                  </button>
                </div>
                <div className="dim" style={{ fontSize: 12 }}>
                  After saving the file, run <code>/reload</code> in console. Graves will immediately push here on death!
                </div>
              </div>
            )}

            {guideTab === "fabric" && (
              <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 12 }}>
                <p style={{ margin: 0 }}>
                  <strong>Standalone Fabric Mod:</strong> The project source code is pre-built in your repository under <code>/fabric-mod</code>.
                </p>
                <div style={{ position: "relative" }}>
                  <pre className="mono" style={{ background: "rgba(0,0,0,0.4)", padding: 12, borderRadius: 6, fontSize: 11, overflowX: "auto", maxHeight: 220 }}>
{`package com.thechudsmp.bridge;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.util.math.BlockPos;

public class TheChudSMPMod implements ModInitializer {
    public static final String URL = "${typeof window !== "undefined" ? window.location.origin : ""}/api/mc/event";
    @Override
    public void onInitialize() {
        ServerLivingEntityEvents.AFTER_DEATH.register((entity, src) -> {
            if (entity instanceof ServerPlayerEntity player) {
                BlockPos p = player.getBlockPos();
                String dim = player.getWorld().getRegistryKey().getValue().toString();
                // Asynchronously sends grave_created to URL with coords p.getX(), p.getY(), p.getZ()
            }
        });
    }
}`}
                  </pre>
                </div>
                <div className="dim" style={{ fontSize: 12 }}>
                  To compile into a <code>.jar</code>: open <code>/fabric-mod</code> and run <code>./gradlew build</code>. The output jar will be in <code>build/libs/</code>.
                </div>
              </div>
            )}

            {guideTab === "webhook" && (
              <div style={{ fontSize: 13, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ background: "rgba(0,0,0,0.3)", padding: 12, borderRadius: 6 }}>
                  <strong style={{ color: "#38bdf8" }}>Webhook Endpoint:</strong>
                  <pre className="mono" style={{ margin: "6px 0 0 0", fontSize: 12 }}>
                    POST {typeof window !== "undefined" ? window.location.origin : ""}/api/mc/event
                  </pre>
                  <div className="faint" style={{ marginTop: 4, fontSize: 11 }}>
                    Header: <code>Content-Type: application/json</code>
                  </div>
                </div>

                <div>
                  <strong>Payload Example:</strong>
                  <pre className="mono" style={{ background: "rgba(0,0,0,0.3)", padding: 10, borderRadius: 6, fontSize: 11.5, overflowX: "auto" }}>
{`{
  "type": "grave_created",
  "playerName": "SuperDuck220",
  "message": "SuperDuck220 died in Overworld",
  "data": {
    "graveKey": "grave-101",
    "x": 128,
    "y": 65,
    "z": -412,
    "dimension": "minecraft:overworld",
    "despawnMinutes": 60
  }
}`}
                  </pre>
                </div>
              </div>
            )}

            <div style={{ marginTop: 16, textAlign: "right" }}>
              <button className="btn sm primary" onClick={() => setShowGuideModal(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
