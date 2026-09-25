/**
 * DiscordProvider — sends queued notifications to a Discord webhook.
 *
 * The webhook URL is a server-side secret: it is stored in the config store
 * (written by first-run setup) or app_meta, never returned to the browser.
 */
import fs from "fs";
import path from "path";
import { getConfig, reloadConfig } from "./config";
import { q } from "./db";
import { getSettings } from "./settings";

/**
 * Discord-deliverable events. `chat_message` and `grave_expiring` arrive via
 * the same pipeline: the mod posts chat events directly, and the panel's
 * desktop-notification grave watcher mirrors its countdown reminders into the
 * queue so the same milestones also reach Discord.
 */
export const DISCORD_EVENTS = [
  "player_join",
  "player_leave",
  "player_death",
  "grave_created",
  "grave_expiring",
  "chat_message",
  "server_start",
  "server_stop",
  "server_restart",
  "server_crash",
] as const;

export type DiscordEvent = (typeof DISCORD_EVENTS)[number];

const EMBED_COLORS: Record<string, number> = {
  player_join: 0x57f287,
  player_leave: 0xed4245,
  player_death: 0xeb459e,
  grave_created: 0xfee75c,
  grave_expiring: 0xe67e22,
  chat_message: 0x5865f2,
  server_start: 0x57f287,
  server_stop: 0xed4245,
  server_restart: 0xfee75c,
  server_crash: 0x000001,
};

// ------------------------------------------------------------- name mapping

export interface DiscordNameMapping {
  /** MC username → the Discord user to ping (@mention string, e.g. <@id>). */
  [mcUsername: string]: string;
}

function sanitizeMention(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  // Accept raw <@id>/<@!id> pings or a numeric user ID; store as a mention.
  const m = t.match(/^<@!?([0-9]{5,25})>$/);
  if (m) return `<@${m[1]}>`;
  if (/^[0-9]{5,25}$/.test(t)) return `<@${t}>`;
  return null;
}

/** Read the admin-entered MC → Discord name map (empty on any failure). */
export async function getDiscordNameMapping(): Promise<DiscordNameMapping> {
  try {
    const res = await q<{ value: unknown }>(
      `select value from panel_settings where key = 'discord_names'`,
    );
    const raw = res.rows[0]?.value as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== "object") return {};
    const clean: DiscordNameMapping = {};
    for (const [mcName, mention] of Object.entries(raw)) {
      const ping = sanitizeMention(mention);
      if (ping && /^[A-Za-z0-9_]{2,20}$/.test(mcName)) clean[mcName.toLowerCase()] = ping;
    }
    return clean;
  } catch {
    return {}; // table missing etc. — no pings, notifications still send
  }
}

/** Merge-save the admin's MC → Discord map (admin API validates values). */
export async function saveDiscordNameMapping(
  patch: DiscordNameMapping,
): Promise<DiscordNameMapping> {
  const current = await getDiscordNameMapping();
  const next: DiscordNameMapping = { ...current };
  for (const [mcName, mention] of Object.entries(patch)) {
    const key = mcName.trim().toLowerCase();
    if (!/^[A-Za-z0-9_]{2,20}$/.test(key)) continue;
    if (mention === null || mention === "") {
      delete next[key];
      continue;
    }
    const ping = sanitizeMention(mention);
    if (ping) next[key] = ping;
  }
  await q(
    `insert into panel_settings (key, value) values ('discord_names', $1::jsonb)
     on conflict (key) do update set value = $1::jsonb, updated_at = now()`,
    [JSON.stringify(next)],
  );
  return next;
}

/**
 * The webhook URL is a server-side secret. Resolution order: config file
 * (written by first-run setup) → app_meta (editable in the Discord page) →
 * environment. It is never returned to the browser in full.
 */
export async function getWebhookUrl(): Promise<string | null> {
  const fromConfig = getConfig().DISCORD_WEBHOOK_URL?.trim();
  if (fromConfig) return fromConfig;
  try {
    const res = await q<{ value: { url?: string } }>(
      `select value from app_meta where key = 'discord_webhook_url'`,
    );
    const fromDb = res.rows[0]?.value?.url?.trim();
    if (fromDb) return fromDb;
  } catch {
    // DB not reachable yet (pre-seed) — config/env still work.
  }
  return process.env.DISCORD_WEBHOOK_URL?.trim() || null;
}

export async function setWebhookUrl(url: string | null): Promise<void> {
  if (url === null) {
    try {
      await q(`delete from app_meta where key = 'discord_webhook_url'`);
    } catch {
      // DB unavailable; fall through to config-file handling.
    }
    try {
      const cfgPath = path.join(process.cwd(), ".panel-config.json");
      const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
      delete raw.DISCORD_WEBHOOK_URL;
      fs.writeFileSync(cfgPath, JSON.stringify(raw, null, 2), { encoding: "utf8", mode: 0o600 });
      reloadConfig();
    } catch {
      // config file missing — nothing to remove
    }
    return;
  }
  if (!/^https:\/\/(canary\.|ptb\.)?(discord\.com|discordapp\.com)\/api\/webhooks\/[\d]+\/[\w-]+$/.test(url)) {
    throw new Error("Webhook URL must be a discord.com/api/webhooks/... URL");
  }
  await q(
    `insert into app_meta (key, value) values ('discord_webhook_url', $1::jsonb)
     on conflict (key) do update set value = $1::jsonb, updated_at = now()`,
    [JSON.stringify({ url })],
  );
}

export async function isDiscordConfigured(): Promise<boolean> {
  return Boolean(await getWebhookUrl());
}

interface QueuedEvent {
  id: number;
  event_type: string;
  payload: Record<string, unknown>;
}

let workerStarted = false;

/**
 * Background worker: drains the pending Discord queue periodically so
 * death/grave/server notifications go out automatically (not only when an
 * admin clicks "test" on the Discord page). No-op when unconfigured.
 */
export function ensureDiscordWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  const tick = async () => {
    try {
      await processDiscordQueue(20);
    } catch {
      // DB or webhook hiccup — try again next tick
    }
  };
  setInterval(() => void tick(), 30_000).unref();
}

export async function processDiscordQueue(limit = 10): Promise<{ sent: number; failed: number }> {
  if (!(await isDiscordConfigured())) return { sent: 0, failed: 0 };
  const res = await q<QueuedEvent>(
    `select id, event_type, payload from discord_events
     where status = 'pending' order by id asc limit $1`,
    [limit],
  );
  let sent = 0;
  let failed = 0;
  for (const row of res.rows) {
    const enabled = await isEventEnabled(row.event_type);
    if (!enabled) {
      await q(`update discord_events set status = 'skipped' where id = $1`, [row.id]);
      continue;
    }
    try {
      await sendEmbedWithMention(row.event_type, row.payload);
      await q(`update discord_events set status = 'sent', sent_at = now() where id = $1`, [row.id]);
      sent += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await q(`update discord_events set status = 'failed', error = $2 where id = $1`, [
        row.id,
        msg.slice(0, 500),
      ]);
      failed += 1;
    }
  }
  return { sent, failed };
}

async function isEventEnabled(eventType: string): Promise<boolean> {
  // Routes through getEnabledEvents() so event types added after a panel was
  // configured (grave countdown, chat) default to ON instead of being skipped.
  const enabled = await getEnabledEvents();
  return enabled.includes(eventType);
}

export async function setEnabledEvents(events: string[]): Promise<void> {
  const valid = events.filter((e): e is DiscordEvent =>
    (DISCORD_EVENTS as readonly string[]).includes(e),
  );
  await q(
    `insert into app_meta (key, value) values ('discord_enabled_events', $1::jsonb)
     on conflict (key) do update set value = $1::jsonb, updated_at = now()`,
    [JSON.stringify({ events: valid })],
  );
}

export async function getEnabledEvents(): Promise<string[]> {
  const res = await q<{ value: { events?: string[] } }>(
    `select value from app_meta where key = 'discord_enabled_events'`,
  );
  const list = res.rows[0]?.value?.events;
  if (!Array.isArray(list) || list.length === 0) return [...DISCORD_EVENTS];
  // Union with the current catalog so newly added event types (grave
  // countdown, chat) default to ON for panels configured before they existed.
  return [...new Set([...list, ...DISCORD_EVENTS])];
}

async function sendEmbed(eventType: string, payload: Record<string, unknown>): Promise<void> {
  const url = await getWebhookUrl();
  if (!url) throw new Error("Discord webhook is not configured");
  const title = humanTitle(eventType, payload);
  const description = typeof payload.message === "string" ? payload.message.slice(0, 500) : null;
  const body = {
    username: "Falix Panel",
    embeds: [
      {
        title,
        description: description ?? undefined,
        color: EMBED_COLORS[eventType] ?? 0x5865f2,
        timestamp: new Date().toISOString(),
        footer: { text: "Falix Control Panel" },
        fields: buildFields(payload),
      },
    ],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      // body unreadable — status alone
    }
    const hint =
      res.status === 404
        ? " — the webhook was deleted or the URL is wrong. Re-copy it from Discord (Server Settings → Integrations → Webhooks → Copy Webhook URL)."
        : res.status === 401 || res.status === 403
          ? " — the webhook token is invalid. Re-copy the full webhook URL."
          : "";
    throw new Error(`Discord webhook returned ${res.status}${detail ? `: ${detail}` : ""}${hint}`);
  }
}

/**
 * Enrich a queued payload right before sending:
 * - `content` carries @mentions so Discord actually pings the mapped user
 *   (embed text alone does not trigger notifications).
 * - `message` in death payloads is the vanilla death message; for the
 *   grave-expiry mirror it is our countdown line.
 */
export async function sendEmbedWithMention(eventType: string, payload: Record<string, unknown>): Promise<void> {
  const enriched = { ...payload };
  if (eventType === "player_death" || eventType === "grave_expiring") {
    const mention = await mentionFor(subjectPlayer(payload));
    if (mention) enriched.content = mention;
  }
  await sendEmbed(eventType, enriched);
}

/**
 * The Discord user to @mention for an MC player, from the admin's mapping in
 * Settings. Comparison is case-insensitive on the MC username.
 */
async function mentionFor(mcUsername: string | null | undefined): Promise<string | null> {
  if (!mcUsername) return null;
  const map = await getDiscordNameMapping();
  return map[mcUsername.trim().toLowerCase()] ?? null;
}

/** The MC username of the subject of an event, under either payload key. */
function subjectPlayer(payload: Record<string, unknown>): string | null {
  const p = payload.playerName ?? payload.player;
  return typeof p === "string" ? p : null;
}

function humanTitle(eventType: string, payload: Record<string, unknown>): string {
  const player = subjectPlayer(payload);
  switch (eventType) {
    case "player_join":
      return `${player ?? "A player"} joined the server`;
    case "player_leave":
      return `${player ?? "A player"} left the server`;
    case "player_death":
      return `${player ?? "A player"} died`;
    case "grave_created":
      return `Grave created${player ? ` for ${player}` : ""}`;
    case "grave_expiring": {
      const mins = typeof payload.minutesLeft === "number" ? Math.round(payload.minutesLeft) : null;
      return mins !== null
        ? `⏳ ${player ?? "Your"} grave expires in ${mins} minute${mins === 1 ? "" : "s"}`
        : `⏳ Grave expiring${player ? ` — ${player}` : ""}`;
    }
    case "chat_message":
      return `${player ?? "Chat"} said`;
    case "server_start":
      return "Server started";
    case "server_stop":
      return "Server stopped";
    case "server_restart":
      return "Server restarted";
    case "server_crash":
      return "Server crashed";
    default:
      return `Event: ${eventType}`;
  }
}

function buildFields(payload: Record<string, unknown>): { name: string; value: string; inline?: boolean }[] {
  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (typeof payload.dimension === "string") {
    fields.push({ name: "Dimension", value: payload.dimension, inline: true });
  }
  if (typeof payload.x === "number" && typeof payload.y === "number" && typeof payload.z === "number") {
    fields.push({
      name: "Location",
      value: `${payload.x}, ${payload.y}, ${payload.z}`,
      inline: true,
    });
  }
  return fields.slice(0, 5);
}
