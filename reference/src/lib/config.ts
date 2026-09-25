import fs from "fs";
import path from "path";

/**
 * Server-only configuration store.
 *
 * Values come from (in order of precedence per key):
 *   1. process environment / .env
 *   2. the runtime config file `.panel-config.json` written by first-run setup
 *
 * The environment always wins, which is what makes the panel deployable to
 * read-only serverless hosts (Netlify/Vercel): everything the setup wizard
 * collects can be supplied as environment variables instead.
 *
 * This module must never be imported from client components.
 */

export interface PanelConfigFull {
  FALIX_API_BASE: string;
  FALIX_API_KEY: string;
  FALIX_SERVER_ID: string;
  MINECRAFT_SERVER_HOST: string;
  MINECRAFT_SERVER_PORT: string;
  SUPABASE_URL: string;
  /** Legacy anon key OR new sb_publishable_… key (whichever the project has). */
  SUPABASE_ANON_KEY: string;
  /** Legacy service_role key OR new sb_secret_… key. Server-side only. */
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Supabase Postgres password (Settings → Database) — NOT the service key. */
  SUPABASE_DB_PASSWORD: string;
  /** Working pooler region, discovered at setup and persisted. */
  SUPABASE_DB_REGION: string;
  RCON_PORT: string;
  RCON_PASSWORD: string;
  INTEGRATION_SECRET_KEY: string;
  DISCORD_WEBHOOK_URL: string;
}

const CONFIG_FILE = path.join(process.cwd(), ".panel-config.json");

/**
 * In-memory fallback for hosts with a read-only filesystem (Netlify): values
 * persisted while the FS is unwritable (e.g. the discovered Supabase pooler
 * region) stay valid for the lifetime of the instance instead of being lost.
 */
let memoryOnly: Record<string, string> = {};

function readFileConfig(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
  } catch {
    // no config file (or unreadable) — env and memory are the sources
  }
  // Memory wins: it holds the newest values when the file cannot be written.
  for (const [k, v] of Object.entries(memoryOnly)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Sole write path for the runtime config file: merges `partial` over whatever
 * is on disk, persists with owner-only permissions, and invalidates the cache.
 * Setup (credentials) and the DB layer (discovered pooler region) both go
 * through here — nothing else touches the file.
 *
 * On read-only filesystems (Netlify/Vercel serverless) the write fails
 * silently — values stay in memory for this instance; on those hosts the
 * environment is the source of truth anyway.
 */
export function persistConfig(partial: Record<string, string>): void {
  const merged = { ...readFileConfig(), ...partial };
  cached = null;
  memoryOnly = merged; // newest values survive even when the write fails
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), { encoding: "utf8", mode: 0o600 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EROFS" || code === "EACCES" || code === "EPERM" || code === "ENOSPC") {
      console.warn("[config] read-only filesystem — runtime config kept in memory only; set values via environment instead");
      return;
    }
    throw e;
  }
}

/** Raw key/value access for keys outside PanelConfigFull (e.g. DATABASE_URL). */
export function readRawConfigKey(key: string): string | undefined {
  return readFileConfig()[key];
}

let cached: PanelConfigFull | null = null;
/** In-memory overrides used during setup validation (never persisted until success). */
let transient: Partial<PanelConfigFull> = {};

export function overrideConfig(partial: Partial<PanelConfigFull>): void {
  transient = { ...transient, ...partial };
  cached = null;
}

export function clearOverride(): void {
  transient = {};
  cached = null;
}

export function getConfig(): PanelConfigFull {
  if (cached) return cached;
  const file = readFileConfig();
  const get = (key: keyof PanelConfigFull): string => {
    const t = transient[key];
    if (t !== undefined && t !== "") return t;
    const fromEnv = process.env[key];
    if (fromEnv && fromEnv.trim() !== "") return fromEnv.trim();
    return (file[key] ?? "").trim();
  };
  cached = {
    FALIX_API_BASE: get("FALIX_API_BASE") || "https://client.falixnodes.net/api/v2",
    FALIX_API_KEY: get("FALIX_API_KEY"),
    FALIX_SERVER_ID: get("FALIX_SERVER_ID"),
    MINECRAFT_SERVER_HOST: get("MINECRAFT_SERVER_HOST"),
    MINECRAFT_SERVER_PORT: get("MINECRAFT_SERVER_PORT") || "25565",
    SUPABASE_URL: get("SUPABASE_URL"),
    SUPABASE_ANON_KEY: get("SUPABASE_ANON_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: get("SUPABASE_SERVICE_ROLE_KEY"),
    SUPABASE_DB_PASSWORD: get("SUPABASE_DB_PASSWORD"),
    SUPABASE_DB_REGION: get("SUPABASE_DB_REGION"),
    RCON_PORT: get("RCON_PORT"),
    RCON_PASSWORD: get("RCON_PASSWORD"),
    INTEGRATION_SECRET_KEY: get("INTEGRATION_SECRET_KEY"),
    DISCORD_WEBHOOK_URL: get("DISCORD_WEBHOOK_URL"),
  } as PanelConfigFull;
  return cached;
}

/** Reload config from disk (used after setup writes a new config file). */
export function reloadConfig(): PanelConfigFull {
  cached = null;
  return getConfig();
}

/** True when every required key for normal operation is present. */
export function isConfigured(): boolean {
  const c = getConfig();
  return Boolean(
    c.FALIX_API_KEY && c.FALIX_SERVER_ID && c.SUPABASE_URL && c.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/** Mask a secret for logging / display: keeps first 4 and last 2 chars. */
export function maskSecret(value: string): string {
  if (!value) return "(not set)";
  if (value.length <= 6) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(Math.min(10, value.length - 6))}${value.slice(-2)}`;
}
