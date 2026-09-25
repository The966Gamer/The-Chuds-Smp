/**
 * Event pipeline: persist server events, notifications, Discord queue rows.
 *
 * The Minecraft mod posts events to /api/integration/events with the
 * shared INTEGRATION_SECRET_KEY. This module normalizes and stores them,
 * updates derived tables (players, graves, chat), and emits realtime.
 */
import { q } from "./db";

export type ServerEventType =
  | "player_join"
  | "player_leave"
  | "player_death"
  | "grave_created"
  | "grave_removed"
  | "grave_expiring"
  | "chat_message"
  | "player_statistics"
  | "server_event"
  | "server_start"
  | "server_stop"
  | "server_restart"
  | "server_crash"
  | "admin_action";

export interface IntegrationEventInput {
  type: ServerEventType;
  playerName?: string;
  message?: string;
  data?: Record<string, unknown>;
  occurredAt?: string;
}

function clampText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  return t.slice(0, max);
}

/** Upsert a player row and return its id. */
export async function upsertPlayer(name: string, uuid?: string | null): Promise<void> {
  const clean = name.trim().slice(0, 20);
  if (!/^[A-Za-z0-9_]{2,20}$/.test(clean)) return;
  await q(
    `insert into players (username, uuid, first_seen, last_seen)
     values ($1, $2, now(), now())
     on conflict (username) do update
       set last_seen = now(),
           uuid = coalesce(excluded.uuid, players.uuid),
           updated_at = now()`,
    [clean, uuid ?? null],
  );
}

export async function insertEvent(ev: IntegrationEventInput): Promise<number | null> {
  const type = clampText(ev.type, 40);
  if (!type) return null;
  const res = await q<{ id: number }>(
    `insert into server_events (type, source, player_name, message, data, created_at)
     values ($1, $2, $3, $4, $5::jsonb, coalesce($6, now())) returning id`,
    [
      type,
      "integration",
      ev.playerName ? ev.playerName.trim().slice(0, 20) : null,
      clampText(ev.message, 500),
      JSON.stringify(ev.data ?? {}),
      ev.occurredAt ? new Date(ev.occurredAt) : null,
    ],
  );
  return res.rows[0]?.id ?? null;
}

export async function recordChat(playerName: string, message: string): Promise<void> {
  await q(
    `insert into chat_messages (player_name, message) values ($1, $2)`,
    [playerName.trim().slice(0, 20), message.trim().slice(0, 500)],
  );
}

export async function upsertGrave(input: {
  graveKey: string;
  playerName: string;
  x: number;
  y: number;
  z: number;
  dimension: string;
  deathTime?: string;
  despawnAt?: string;
  status?: string;
  inventory?: unknown;
}): Promise<void> {
  await q(
    `insert into graves (grave_key, player_name, x, y, z, dimension, death_time, despawn_at, status, inventory)
     values ($1, $2, $3, $4, $5, $6, coalesce($7, now()), $8, coalesce($9, 'active'), $10::jsonb)
     on conflict (grave_key) do update set
       x = excluded.x, y = excluded.y, z = excluded.z,
       dimension = excluded.dimension,
       despawn_at = coalesce(excluded.despawn_at, graves.despawn_at),
       status = excluded.status,
       inventory = coalesce(excluded.inventory, graves.inventory),
       updated_at = now()`,
    [
      input.graveKey.slice(0, 120),
      input.playerName.trim().slice(0, 20),
      Math.trunc(input.x),
      Math.trunc(input.y),
      Math.trunc(input.z),
      input.dimension.slice(0, 60),
      input.deathTime ? new Date(input.deathTime) : null,
      input.despawnAt ? new Date(input.despawnAt) : null,
      input.status ?? null,
      input.inventory === undefined ? null : JSON.stringify(input.inventory),
    ],
  );
}

export async function updateStatistics(
  playerName: string,
  stats: Record<string, number>,
): Promise<number> {
  const entries = Object.entries(stats).filter(
    ([k, v]) => typeof v === "number" && Number.isFinite(v) && k.length <= 120,
  );
  if (entries.length === 0) return 0;
  let applied = 0;
  for (const [key, value] of entries) {
    await q(
      `insert into player_statistics (player_name, key, value, updated_at)
       values ($1, $2, $3, now())
       on conflict (player_name, key) do update
         set value = excluded.value,
             updated_at = now()
       where excluded.value >= player_statistics.value`,
      [playerName.trim().slice(0, 20), key, Math.trunc(value)],
    );
    await q(
      `insert into player_stat_history (player_name, key, value) values ($1, $2, $3)`,
      [playerName.trim().slice(0, 20), key, Math.trunc(value)],
    );
    applied += 1;
  }
  return applied;
}

export async function queueDiscordEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
  await q(
    `insert into discord_events (event_type, status, payload) values ($1, 'pending', $2::jsonb)`,
    [eventType.slice(0, 60), JSON.stringify(payload)],
  );
}

/** Best-effort queue write for non-request callers (countdown watcher). */
export async function queueDiscordEventQuiet(eventType: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await queueDiscordEvent(eventType, payload);
  } catch {
    // DB unavailable — the toast already fired; skip this mirror
  }
}

/**
 * Queue the panel notification rows for an event type. Every event the mod
 * posts gets a bell row (deaths, graves, crashes, power, joins, leaves and
 * chat) — the per-event visibility matrix is enforced in the delivery layer.
 * Chat rows are created pre-read so busy in-game chat doesn't spam the
 * unread badge; they still appear in the feed.
 */
export async function createNotificationsForEvent(
  ev: IntegrationEventInput,
  eventId: number | null,
): Promise<void> {
  const meta = notificationMetaFor(ev);
  if (!meta) return;
  await q(
    `insert into notifications (type, title, body, read, created_at)
     values ($1, $2, $3, $4, now())`,
    [meta.type, meta.title.slice(0, 120), meta.body, meta.type === "chat"],
  );
}

/**
 * Create one panel-notification row for an already-normalized event type
 * and payload (used by the grave-countdown mirror, which has no mod event).
 */
export async function createNotificationForType(
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const meta = notificationMetaFor({
    type: type as IntegrationEventInput["type"],
    playerName: typeof payload.playerName === "string" ? payload.playerName : undefined,
    message: typeof payload.message === "string" ? payload.message : undefined,
  });
  if (!meta) return;
  await q(
    `insert into notifications (type, title, body, read, created_at)
     values ($1, $2, $3, $4, now())`,
    [meta.type, meta.title.slice(0, 120), meta.body, meta.type === "chat"],
  );
}

function notificationMetaFor(
  ev: IntegrationEventInput,
): { type: string; title: string; body: string } | null {
  const who = ev.playerName ?? null;
  const msg = clampText(ev.message, 300);
  switch (ev.type) {
    case "player_death":
      return { type: "death", title: who ? `${who} died` : "A player died", body: msg ?? "Better luck next time." };
    case "grave_created":
      return { type: "grave", title: who ? `Grave created — ${who}` : "Grave created", body: msg ?? "Their items are waiting at the grave." };
    case "grave_expiring":
      return { type: "grave", title: who ? `Grave expiring — ${who}` : "Grave expiring", body: msg ?? "Recover it in game before it despawns." };
    case "server_crash":
      return { type: "crash", title: "Server crash detected", body: msg ?? "Check the console." };
    case "server_stop":
      return { type: "server", title: "Server stopped", body: msg ?? "The Minecraft server went offline." };
    case "server_start":
      return { type: "server", title: "Server started", body: msg ?? "The Minecraft server is online." };
    case "server_restart":
      return { type: "server", title: "Server restarted", body: msg ?? "The Minecraft server restarted." };
    case "player_join":
      return { type: "join", title: who ? `${who} joined` : "Player joined", body: msg ?? "Joined the server." };
    case "player_leave":
      return { type: "leave", title: who ? `${who} left` : "Player left", body: msg ?? "Left the server." };
    case "chat_message":
      return { type: "chat", title: who ? `${who} said` : "Chat message", body: msg ?? "" };
    default:
      return null;
  }
}

export async function markIntegrationHeartbeat(detail: Record<string, unknown>): Promise<void> {
  await q(
    `insert into integration_status (key, status, detail, last_event_at, updated_at)
     values ('minecraft_mod', 'connected', $1::jsonb, now(), now())
     on conflict (key) do update set status = 'connected', detail = $1::jsonb,
       last_event_at = now(), updated_at = now()`,
    [JSON.stringify(detail)],
  );
}
