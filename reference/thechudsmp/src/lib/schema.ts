/**
 * Database schema (idempotent DDL).
 *
 * The migration is written to be safe to run any number of times: every
 * statement uses IF NOT EXISTS / IF NOT PRESENT semantics and seeds are
 * upserts keyed on stable natural keys.
 */

export const MIGRATION_SQL = `
-- Self-heal: interrupted/partial setups from older schema revisions can leave
-- tables with missing columns (e.g. sessions without revoked_at) or broken
-- shapes (citext failing => users table without a usable username column).
-- Repair by verifying EVERY required column of EVERY table; any table missing
-- a column is dropped (with dependents) so the full CREATE below rebuilds it
-- to the current shape exactly.
do $$
declare
  required jsonb := '{
    "users": ["id", "username", "username_display", "password_hash", "role", "power_scope", "mc_username", "head_url", "head_fetched_at", "must_change_password", "created_at", "updated_at"],
    "sessions": ["id", "user_id", "token_hash", "csrf_token", "created_at", "last_seen_at", "expires_at", "revoked_at", "user_agent", "ip"],
    "players": ["id", "username", "uuid", "head_url", "head_fetched_at", "first_seen", "last_seen", "playtime_seconds", "permission_level", "joins", "deaths", "updated_at"],
    "server_events": ["id", "type", "source", "player_name", "message", "data", "created_at"],
    "graves": ["id", "grave_key", "player_name", "x", "y", "z", "dimension", "created_at", "death_time", "despawn_at", "status", "inventory", "updated_at"],
    "chat_messages": ["id", "player_name", "message", "created_at"],
    "player_statistics": ["player_name", "key", "value", "updated_at"],
    "player_stat_history": ["id", "player_name", "key", "value", "recorded_at"],
    "discord_events": ["id", "event_type", "status", "payload", "error", "created_at", "sent_at"],
    "dashboard_layouts": ["user_id", "layout", "updated_at"],
    "notifications": ["id", "user_id", "type", "title", "body", "read", "created_at"],
    "integration_status": ["key", "status", "detail", "last_event_at", "updated_at"],
    "audit_logs": ["id", "user_id", "username", "action", "target", "ip", "metadata", "created_at"],
    "app_meta": ["key", "value", "updated_at"],
    "login_attempts": ["id", "username", "ip", "success", "created_at"],
    "panel_settings": ["key", "value", "updated_at"]
  }';
  tbl text;
begin
  for tbl in select jsonb_object_keys(required) loop
    if to_regclass(format('public.%I', tbl)) is not null
       and exists (
         select 1
         from unnest(array(select jsonb_array_elements_text(required -> tbl))) as col(name)
         where not exists (
           select 1 from pg_catalog.pg_attribute a
           where a.attrelid = to_regclass(format('public.%I', tbl))
             and a.attname = col.name
             and a.attnum > 0
             and not a.attisdropped
         )
       )
    then
      execute format('drop table if exists public.%I cascade', tbl);
    end if;
  end loop;
end $$;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username citext not null unique,
  username_display text not null,
  password_hash text not null,
  role text not null default 'player' check (role in ('player','moderator','admin')),
  -- Per-user server power grant, independent of role: 'full' = start/stop/restart,
  -- 'start' = start only, 'none' = no power actions. Admins always have 'full'.
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
create index if not exists sessions_user_idx on sessions(user_id);
create index if not exists sessions_expires_idx on sessions(expires_at) where revoked_at is null;

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
create index if not exists players_last_seen_idx on players(last_seen desc nulls last);

create table if not exists server_events (
  id bigserial primary key,
  type text not null,
  source text not null default 'panel',
  player_name citext,
  message text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists server_events_created_idx on server_events(created_at desc);
create index if not exists server_events_type_idx on server_events(type, created_at desc);
create index if not exists server_events_player_idx on server_events(player_name, created_at desc);

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
create index if not exists graves_status_idx on graves(status, death_time desc);
create index if not exists graves_player_idx on graves(player_name, death_time desc);

create table if not exists chat_messages (
  id bigserial primary key,
  player_name citext not null,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_created_idx on chat_messages(created_at desc);

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
create index if not exists player_stat_history_idx on player_stat_history(player_name, key, recorded_at desc);

create table if not exists discord_events (
  id bigserial primary key,
  event_type text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  payload jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists discord_events_status_idx on discord_events(status, created_at desc);

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
create index if not exists notifications_user_idx on notifications(user_id, created_at desc);

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
create index if not exists audit_logs_created_idx on audit_logs(created_at desc);

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
create index if not exists login_attempts_idx on login_attempts(username, created_at desc);
create index if not exists login_attempts_ip_idx on login_attempts(ip, created_at desc);

-- Admin-editable panel settings (feature toggles, grave mod configuration).
-- Unlike app_meta (written by seed), this is safe to edit at runtime.
create table if not exists panel_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create extension if not exists pgcrypto;
`;

export async function runMigrations(exec: (sql: string) => Promise<unknown>): Promise<void> {
  // citext lives in a separate extension; create it first (idempotent).
  await exec("create extension if not exists citext;");
  await exec(MIGRATION_SQL);
}
