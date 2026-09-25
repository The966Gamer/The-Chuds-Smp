/**
 * Panel settings: admin-editable feature flags and grave-mod configuration.
 *
 * Stored in the `panel_settings` table as JSON, cached briefly per process.
 * Every value has a hard default so a missing row (or a failed read) never
 * breaks the panel; admin writes are validated against allow-lists.
 */
import { q } from "./db";

// ------------------------------------------------------------------ features

export const FEATURES = [
  "dashboard",
  "console",
  "players",
  "graves",
  "chat",
  "activity",
  "statistics",
  "discord",
] as const;

export type FeatureId = (typeof FEATURES)[number];

const DEFAULT_FEATURES: Record<FeatureId, boolean> = {
  dashboard: true,
  console: true,
  players: true,
  graves: true,
  chat: true,
  activity: true,
  statistics: true,
  discord: true,
};

// -------------------------------------------------------------------- graves

export interface GraveSettings {
  /** How long a grave persists before the mod despawns it, in real minutes. */
  despawnMinutes: number;
  /** Whether graves protect their contents from non-owners in game. */
  protection: boolean;
}

const DEFAULT_GRAVES: GraveSettings = {
  despawnMinutes: 60,
  protection: true,
};

const DESPAWN_MIN = 5;
const DESPAWN_MAX = 7 * 24 * 60; // one week

// -------------------------------------------------------------------- cache

type SettingsShape = {
  features: Record<FeatureId, boolean>;
  graves: GraveSettings;
};

let cache: { value: SettingsShape; at: number } | null = null;
const CACHE_MS = 5_000;

function defaults(): SettingsShape {
  return { features: { ...DEFAULT_FEATURES }, graves: { ...DEFAULT_GRAVES } };
}

export async function getSettings(): Promise<SettingsShape> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const next = defaults();
  try {
    const rows = await q<{ key: string; value: unknown }>(
      `select key, value from panel_settings where key in ('features', 'grave')`,
    );
    for (const row of rows.rows) {
      if (row.key === "features" && row.value && typeof row.value === "object") {
        const raw = row.value as Record<string, unknown>;
        for (const id of FEATURES) {
          if (typeof raw[id] === "boolean") next.features[id] = raw[id];
        }
      }
      if (row.key === "grave" && row.value && typeof row.value === "object") {
        const raw = row.value as Record<string, unknown>;
        if (typeof raw.despawnMinutes === "number" && Number.isFinite(raw.despawnMinutes)) {
          next.graves.despawnMinutes = Math.min(DESPAWN_MAX, Math.max(DESPAWN_MIN, Math.round(raw.despawnMinutes)));
        }
        if (typeof raw.protection === "boolean") next.graves.protection = raw.protection;
      }
    }
  } catch {
    // Table may not exist yet (fresh boot) — defaults apply.
  }
  cache = { value: next, at: Date.now() };
  return next;
}

export async function saveFeatures(features: Partial<Record<FeatureId, boolean>>): Promise<void> {
  const clean: Partial<Record<FeatureId, boolean>> = {};
  for (const id of FEATURES) {
    if (typeof features[id] === "boolean") clean[id] = features[id];
  }
  await q(
    `insert into panel_settings (key, value) values ('features', $1::jsonb)
     on conflict (key) do update set value = $1::jsonb, updated_at = now()`,
    [JSON.stringify({ ...DEFAULT_FEATURES, ...clean })],
  );
  cache = null;
}

export async function saveGraveSettings(graves: Partial<GraveSettings>): Promise<void> {
  const current = (await getSettings()).graves;
  const despawn =
    typeof graves.despawnMinutes === "number" && Number.isFinite(graves.despawnMinutes)
      ? Math.min(DESPAWN_MAX, Math.max(DESPAWN_MIN, Math.round(graves.despawnMinutes)))
      : current.despawnMinutes;
  const next: GraveSettings = {
    despawnMinutes: despawn,
    protection: typeof graves.protection === "boolean" ? graves.protection : current.protection,
  };
  await q(
    `insert into panel_settings (key, value) values ('grave', $1::jsonb)
     on conflict (key) do update set value = $1::jsonb, updated_at = now()`,
    [JSON.stringify(next)],
  );
  cache = null;
}

/** Invalidate the cache so a fresh read sees the latest rows (e.g. after tests). */
export function invalidateSettingsCache(): void {
  cache = null;
}
