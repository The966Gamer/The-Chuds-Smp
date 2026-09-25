import { Pool, type QueryResultRow } from "pg";
import { getConfig } from "./config";
import crypto from "node:crypto";

let pool: Pool | null = null;
let isPostgresReady = false;

export function isPostgresOnline(): boolean {
  return isPostgresReady;
}

// Fallback in-memory / local storage when PostgreSQL is not configured yet
interface MemoryDb {
  users: Map<string, any>;
  sessions: Map<string, any>;
  players: Map<string, any>;
  server_events: any[];
  graves: any[];
  chat_messages: any[];
  player_statistics: Map<string, any>;
  player_stat_history: any[];
  discord_events: any[];
  dashboard_layouts: Map<string, any>;
  notifications: any[];
  panel_settings: Map<string, any>;
  app_meta: Map<string, any>;
  login_attempts: any[];
}

export const memDb: MemoryDb = {
  users: new Map(),
  sessions: new Map(),
  players: new Map(),
  server_events: [],
  graves: [],
  chat_messages: [],
  player_statistics: new Map(),
  player_stat_history: [],
  discord_events: [],
  dashboard_layouts: new Map(),
  notifications: [],
  panel_settings: new Map(),
  app_meta: new Map(),
  login_attempts: [],
};

// Seed default admin in memory if empty
function seedMemoryDefaults() {
  if (memDb.users.size === 0) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync("chudsmp2026", salt, 64).toString("hex");
    const adminId = crypto.randomUUID();
    memDb.users.set("superduck220", {
      id: adminId,
      username: "SuperDuck220",
      username_display: "SuperDuck220",
      password_hash: `${salt}:${hash}`,
      role: "admin",
      power_scope: "full",
      mc_username: "SuperDuck220",
      head_url: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  if (!memDb.panel_settings.has("features")) {
    memDb.panel_settings.set("features", {
      dashboard: true,
      console: true,
      players: true,
      graves: true,
      chat: true,
      activity: true,
      statistics: true,
      discord: true,
    });
  }

  if (!memDb.panel_settings.has("grave")) {
    memDb.panel_settings.set("grave", {
      despawnMinutes: 60,
      protection: true,
    });
  }

  if (!memDb.panel_settings.has("discordNames")) {
    memDb.panel_settings.set("discordNames", {});
  }
}

seedMemoryDefaults();

export function getDbPool(): Pool | null {
  if (pool) return pool;

  const cfg = getConfig();
  let connStr = (cfg.DATABASE_URL || "").trim();

  // If DATABASE_URL is an HTTP/HTTPS web URL (e.g. Supabase Project URL https://xxx.supabase.co),
  // it is not a PostgreSQL wire protocol URI and will time out on raw TCP port 5432.
  if (connStr.startsWith("http://") || connStr.startsWith("https://")) {
    connStr = "";
  }

  if (!connStr && cfg.SUPABASE_URL && cfg.SUPABASE_DB_PASSWORD) {
    try {
      const u = new URL(cfg.SUPABASE_URL);
      const projectRef = u.hostname.split(".")[0];
      connStr = `postgres://postgres.${projectRef}:${encodeURIComponent(cfg.SUPABASE_DB_PASSWORD)}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
    } catch {
      // ignore
    }
  }

  // Only create Pool if it is a genuine postgres:// or postgresql:// connection string
  if (connStr && (connStr.startsWith("postgres://") || connStr.startsWith("postgresql://"))) {
    try {
      pool = new Pool({
        connectionString: connStr,
        ssl: connStr.includes("localhost") || connStr.includes("127.0.0.1") ? false : { rejectUnauthorized: false },
        max: 10,
        connectionTimeoutMillis: 5000,
      });

      pool.on("error", (err) => {
        console.error("[db] PostgreSQL pool error:", err.message);
      });
    } catch (e) {
      console.warn("[db] Could not initialize PostgreSQL pool:", e);
      pool = null;
    }
  }

  return pool;
}

export async function initDb(): Promise<void> {
  const p = getDbPool();
  if (!p) {
    isPostgresReady = false;
    console.log("[db] In-memory & local state mode active (PostgreSQL URI not configured).");
    return;
  }

  try {
    const client = await p.connect();
    try {
      await client.query("create extension if not exists citext;");
      await client.query("create extension if not exists pgcrypto;");

      await client.query(`
        create table if not exists users (
          id uuid primary key default gen_random_uuid(),
          username citext not null unique,
          username_display text not null,
          password_hash text not null,
          role text not null default 'player' check (role in ('player','moderator','admin')),
          power_scope text not null default 'full' check (power_scope in ('full','start','none')),
          mc_username text,
          head_url text,
          head_fetched_at timestamptz,
          must_change_password boolean not null default false,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );

        create table if not exists sessions (
          id text primary key,
          user_id uuid not null references users(id) on delete cascade,
          token_hash text not null unique,
          csrf_token text not null,
          created_at timestamptz not null default now(),
          last_seen_at timestamptz not null default now(),
          expires_at timestamptz not null,
          revoked_at timestamptz,
          user_agent text,
          ip inet
        );

        create table if not exists players (
          id uuid primary key default gen_random_uuid(),
          username citext not null unique,
          uuid text,
          head_url text,
          head_fetched_at timestamptz,
          first_seen timestamptz,
          last_seen timestamptz,
          playtime_seconds bigint not null default 0,
          permission_level text not null default 'player' check (permission_level in ('player','moderator','admin')),
          joins integer not null default 0,
          deaths integer not null default 0,
          updated_at timestamptz not null default now()
        );

        create table if not exists server_events (
          id bigserial primary key,
          type text not null,
          source text not null default 'panel',
          player_name citext,
          message text,
          data jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now()
        );

        create table if not exists graves (
          id bigserial primary key,
          grave_key text not null unique,
          player_name citext not null,
          x integer not null,
          y integer not null,
          z integer not null,
          dimension text not null,
          created_at timestamptz not null default now(),
          death_time timestamptz not null default now(),
          despawn_at timestamptz,
          status text not null default 'active' check (status in ('active','recovered','despawned','expired')),
          inventory jsonb,
          updated_at timestamptz not null default now()
        );

        create table if not exists chat_messages (
          id bigserial primary key,
          player_name citext not null,
          message text not null,
          created_at timestamptz not null default now()
        );

        create table if not exists player_statistics (
          player_name citext not null,
          key text not null,
          value bigint not null default 0,
          updated_at timestamptz not null default now(),
          primary key (player_name, key)
        );

        create table if not exists player_stat_history (
          id bigserial primary key,
          player_name citext not null,
          key text not null,
          value bigint not null,
          recorded_at timestamptz not null default now()
        );

        create table if not exists discord_events (
          id bigserial primary key,
          event_type text not null,
          status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
          payload jsonb not null default '{}'::jsonb,
          error text,
          created_at timestamptz not null default now(),
          sent_at timestamptz
        );

        create table if not exists dashboard_layouts (
          user_id uuid primary key references users(id) on delete cascade,
          layout jsonb not null,
          updated_at timestamptz not null default now()
        );

        create table if not exists notifications (
          id bigserial primary key,
          user_id uuid references users(id) on delete cascade,
          type text not null,
          title text not null,
          body text,
          read boolean not null default false,
          created_at timestamptz not null default now()
        );

        create table if not exists integration_status (
          key text primary key,
          status text not null,
          detail jsonb,
          last_event_at timestamptz,
          updated_at timestamptz not null default now()
        );

        create table if not exists audit_logs (
          id bigserial primary key,
          user_id uuid,
          username text,
          action text not null,
          target text,
          ip inet,
          metadata jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now()
        );

        create table if not exists app_meta (
          key text primary key,
          value jsonb not null,
          updated_at timestamptz not null default now()
        );

        create table if not exists login_attempts (
          id bigserial primary key,
          username citext,
          ip inet,
          success boolean not null,
          created_at timestamptz not null default now()
        );

        create table if not exists panel_settings (
          key text primary key,
          value jsonb not null,
          updated_at timestamptz not null default now()
        );
      `);

      isPostgresReady = true;
      console.log("[db] PostgreSQL connected and schemas validated.");
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn("[db] PostgreSQL connection attempt failed, using safe fallback:", (err as Error).message);
    isPostgresReady = false;
    if (pool) {
      try {
        await pool.end();
      } catch {
        // ignore
      }
      pool = null;
    }
  }
}

export async function q<T extends QueryResultRow = any>(
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: T[]; rowCount: number }> {
  const p = getDbPool();
  if (p && isPostgresReady) {
    try {
      const res = await p.query<T>(sql, params);
      return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
    } catch (err) {
      console.error("[db] Query error:", err, "SQL:", sql);
      throw err;
    }
  }

  // Safe fallback when DB is not connected yet
  return { rows: [], rowCount: 0 };
}
