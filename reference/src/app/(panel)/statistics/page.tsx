"use client";

import React from "react";
import { api } from "@/lib/client/api";
import { formatRelative } from "@/lib/client/realtime";
import { McHead, Panel, EmptyState, SkeletonRows } from "@/components/ui";

interface StatsResponse {
  unavailable: boolean;
  reason: string | null;
  player: string;
  headUrl: string | null;
  statistics: { key: string; value: number; updatedAt: string }[];
  history: { key: string; value: number; at: string }[];
}

const CATEGORIES: { label: string; icon: string; match: RegExp }[] = [
  { label: "Playtime", icon: "⏱", match: /^minecraft:play_/ },
  { label: "Deaths", icon: "💀", match: /^minecraft:deaths$/ },
  { label: "Blocks mined", icon: "⛏", match: /^minecraft:mined$/ },
  { label: "Blocks placed", icon: "🧱", match: /^minecraft:used$/ },
  { label: "Distance", icon: "🧭", match: /^minecraft:walk_one_cm|^minecraft:sprint|^minecraft:swim|^minecraft:fly|^minecraft:fall|^minecraft:crouch|^minecraft:boat|^minecraft:minecart|^minecraft:horse|^minecraft:pig|^minecraft:strider|^minecraft:aviate/ },
  { label: "Mobs defeated", icon: "⚔️", match: /^minecraft:killed/ },
  { label: "Items collected", icon: "🎒", match: /^minecraft:picked_up/ },
  { label: "Items crafted", icon: "🔨", match: /^minecraft:crafted/ },
  { label: "Damage dealt", icon: "🗡", match: /^minecraft:damage_dealt/ },
  { label: "Damage taken", icon: "🩹", match: /^minecraft:damage_taken/ },
  { label: "Advancements", icon: "🏆", match: /^minecraft:custom.*advancement|^advancement/ },
];

function categoryOf(key: string): string | null {
  for (const c of CATEGORIES) {
    if (c.match.test(key)) return c.label;
  }
  return null;
}

function prettyKey(key: string): string {
  return key
    .replace(/^minecraft:/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function prettyValue(key: string, value: number): string {
  if (/_cm$/.test(key)) return `${(value / 100 / 1000).toFixed(2)} km`;
  if (/_ticks$/.test(key)) return `${Math.round(value / 20 / 60)} min`;
  return value.toLocaleString();
}

export default function StatisticsPage() {
  const [data, setData] = React.useState<StatsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api
      .get<StatsResponse>("/api/statistics")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load statistics"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <h1 style={{ fontSize: 20, marginBottom: 14 }}>Statistics</h1>
        <Panel><SkeletonRows rows={6} /></Panel>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 20 }}>Statistics</h1>
        <p className="dim" style={{ margin: 0, fontSize: 13 }}>
          Your real in-game statistics, as reported by the Minecraft integration.
        </p>
      </div>

      {error ? (
        <div className="error-state">{error}</div>
      ) : data?.unavailable ? (
        <Panel>
          <EmptyState icon="statistics" title="Statistics not available yet" hint={data.reason ?? undefined}>
            <div className="faint" style={{ fontSize: 12 }}>
              Categories will appear once the integration reports them — nothing is faked in the meantime.
            </div>
          </EmptyState>
        </Panel>
      ) : data ? (
        <>
          <div className="panel row" style={{ padding: 16, marginBottom: 14 }}>
            <McHead username={data.player} headUrl={data.headUrl} size={44} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{data.player}</div>
              <div className="faint" style={{ fontSize: 12 }}>
                {data.statistics.length} tracked statistics
              </div>
            </div>
          </div>

          {CATEGORIES.map((cat) => {
            const rows = data.statistics.filter((s) => cat.match.test(s.key));
            if (rows.length === 0) return null;
            const top = rows.slice(0, 8);
            const maxValue = Math.max(...top.map((r) => r.value), 1);
            return (
              <Panel key={cat.label} title={`${cat.icon} ${cat.label}`} className="fade-in" bodyStyle={{ paddingTop: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {top.map((s) => (
                    <div key={s.key}>
                      <div className="spread" style={{ fontSize: 12.5, marginBottom: 3 }}>
                        <span className="dim">{prettyKey(s.key)}</span>
                        <strong>{prettyValue(s.key, s.value)}</strong>
                      </div>
                      <div style={{ height: 5, borderRadius: 4, background: "rgba(148,163,184,0.12)", overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${(s.value / maxValue) * 100}%`,
                            height: "100%",
                            background: "linear-gradient(90deg, var(--accent), var(--accent-strong))",
                            borderRadius: 4,
                            transition: "width 0.4s ease",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  {rows.length > top.length ? (
                    <div className="faint" style={{ fontSize: 11.5 }}>+ {rows.length - top.length} more in this category</div>
                  ) : null}
                </div>
              </Panel>
            );
          })}

          {data.statistics.length === 0 ? (
            <Panel>
              <EmptyState icon="statistics" title="No statistics reported yet" hint="They will appear here after the integration sends your first statistics payload." />
            </Panel>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
