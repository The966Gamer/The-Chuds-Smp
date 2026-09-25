import { getBotToken, rconSendCommand, rconStatus } from "./rconService";
import WebSocket from "ws";
import { q } from "./db";
import { getRconConfig } from "./rconService";
import { getConfig } from "./config";

/**
 * Discord bot — control the Minecraft server from Discord with slash
 * commands, over the panel's existing stack (Postgres for data, RCON for
 * console commands). No bot framework dependency: a minimal Discord gateway
 * (wss) + REST client, ~200 lines, single shard, auto-reconnect.
 *
 * Commands (registered globally, usable in any server the bot is in):
 *   /status   — Falix/Minecraft/RCON state
 *   /start    — start the server (power signal via Falix API)
 *   /stop     — stop the server (Falix API)
 *   /restart  — restart the server (Falix API)
 *   /console  — run an RCON command (say, list, whitelist, tp…)
 *   /graves   — list active graves
 *   /players  — online players
 */

const API = "https://discord.com/api/v10";

interface GatewayPayload {
  op: number;
  t?: string | null;
  s?: number | null;
  d?: any;
}

let running = false;
let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastSequence: number | null = null;
let botUserId: string | null = null;
let registeredApplicationId: string | null = null;

function log(...args: unknown[]): void {
  console.log("[discord-bot]", ...args);
}

// ---------------------------------------------------------------- REST ----

async function rest<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getBotToken();
  if (!token) throw new Error("Discord bot token not configured");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord API ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function reply(interactionId: string, token: string, content: string, ephemeral = true): Promise<void> {
  await rest("POST", `/interactions/${interactionId}/${token}/callback`, {
    type: 4,
    data: { content: content.slice(0, 1900), flags: ephemeral ? 64 : 0 },
  });
}

// ------------------------------------------------------- command registry ----

interface CommandSpec {
  name: string;
  description: string;
  options?: { name: string; description: string; type: number; required?: boolean }[];
}

const COMMANDS: CommandSpec[] = [
  { name: "status", description: "Show Minecraft server status (Falix + RCON)" },
  { name: "start", description: "Start the Minecraft server" },
  { name: "stop", description: "Stop the Minecraft server" },
  { name: "restart", description: "Restart the Minecraft server" },
  {
    name: "console",
    description: "Run a console command on the server via RCON",
    options: [{ name: "command", description: "e.g. list, say hello, whitelist add Steve", type: 3, required: true }],
  },
  { name: "graves", description: "List active graves" },
  { name: "players", description: "List online players" },
];

async function registerCommands(): Promise<void> {
  if (!registeredApplicationId) return;
  await rest("PUT", `/applications/${registeredApplicationId}/commands`, COMMANDS);
  log("slash commands registered:", COMMANDS.map((c) => `/${c.name}`).join(" "));
}

// ------------------------------------------------------------ handlers ----

function fmtUptime(sec?: number | null): string {
  if (!sec || sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function handleStatus(): Promise<string> {
  const cfg = getConfig();
  const rcon = await rconStatus();
  const lines = [
    "**Server status**",
    `Minecraft: \`${cfg.MINECRAFT_SERVER_HOST || "?"}:${cfg.MINECRAFT_SERVER_PORT || "?"}\``,
  ];
  try {
    const res = await fetch(`${process.env.PANEL_URL ?? "http://localhost:3000"}/api/status`, { signal: AbortSignal.timeout(5000) });
    // status requires auth — treat unreachable as unknown, RCON remains the source of truth here
  } catch {
    // ignore — RCON tells us enough
  }
  lines.push(
    rcon.online
      ? `RCON: online (${rcon.latencyMs}ms)`
      : rcon.configured
        ? `RCON: offline — ${rcon.error ?? "unreachable"}`
        : "RCON: not configured",
  );
  if (rcon.online) {
    const list = await rconSendCommand("list", 6000);
    if (list.ok) lines.push(`Players: ${list.response}`);
  }
  return lines.join("\n");
}

async function handleConsole(command: string): Promise<string> {
  const clean = command.replace(/[^\x20-\x7e]/g, "").trim();
  if (!clean) return "Empty command.";
  if (/^(stop|end)$/i.test(clean)) return "Refused — use /stop for a graceful stop with notifications.";
  const res = await rconSendCommand(clean, 8000);
  return res.ok
    ? `\`${clean}\`\n\`\`\`\n${(res.response || "(no output)").slice(0, 1500)}\n\`\`\``
    : `RCON error: ${res.error}`;
}

async function handleGraves(): Promise<string> {
  const res = await q<{ player_name: string; x: number; y: number; z: number; dimension: string; death_time: string }>(
    `select player_name, x, y, z, dimension, death_time from graves
     where status = 'active' order by death_time desc limit 12`,
  );
  if (res.rows.length === 0) return "No active graves — nobody has died (recently).";
  const lines = res.rows.map(
    (g) =>
      `**${g.player_name}** — ${g.dimension} @ ${g.x}, ${g.y}, ${g.z} · died ${new Date(g.death_time).toLocaleString()}`,
  );
  return ["**Active graves**", ...lines].join("\n");
}

async function handlePlayers(): Promise<string> {
  const res = await rconSendCommand("list", 6000);
  if (!res.ok) return `RCON error: ${res.error}`;
  return `Players online: ${res.response}`;
}

// -------------------------------------------------------------- gateway ----

function connectGateway(token: string): void {
  ws = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");

  ws.onopen = () => {
    // identify
    ws!.send(
      JSON.stringify({
        op: 2,
        d: {
          token,
          intents: 0, // slash-command bots need no message intents
          properties: { os: "node", browser: "falix-panel", device: "falix-panel" },
        },
      }),
    );
  };

  ws.onmessage = (event) => {
    void (async () => {
      const p = JSON.parse(String(event.data)) as GatewayPayload;
      if (p.s != null) lastSequence = p.s;

      if (p.op === 10) {
        // hello — start heartbeat, then resume or identify
        const interval = p.d?.heartbeat_interval ?? 41250;
        const sock = ws;
        if (!sock) return;
        heartbeatTimer = setInterval(() => {
          if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ op: 1, d: lastSequence }));
        }, interval);
        if (lastSequence !== null && currentSessionId) {
          sock.send(JSON.stringify({ op: 6, d: { token, session_id: currentSessionId, seq: lastSequence } }));
        } else {
          sock.send(
            JSON.stringify({
              op: 2,
              d: {
                token,
                intents: 0,
                properties: { os: "node", browser: "falix-panel", device: "falix-panel" },
              },
            }),
          );
        }
      } else if (p.op === 11) {
        // heartbeat ack — fine
      } else if (p.t === "READY") {
        botUserId = p.d?.user?.id ?? null;
        currentSessionId = p.d?.session_id ?? null;
        registeredApplicationId = p.d?.application?.id ?? null;
        log("gateway ready as", p.d?.user?.username ?? "(unknown)");
        await registerCommands().catch((e) => log("command registration failed:", e.message));
      } else if (p.t === "INTERACTION_CREATE") {
        await handleInteraction(p.d).catch((e) => log("interaction error:", e.message));
      } else if (p.op === 7) {
        ws?.close(4000);
      } else if (p.op === 9) {
        // invalid session — re-identify after backoff
        setTimeout(() => reconnect(token), 3000);
      }
    })();
  };

  ws.onclose = (event) => {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (!running) return;
    const backoff = Math.min(30_000, 1000 * 2 ** Math.min(5, event.code === 4004 ? 5 : Math.random() * 4));
    log(`closed (${event.code}) — reconnecting in ${Math.round(backoff)}ms`);
    setTimeout(() => reconnect(token), backoff);
  };

  ws.onerror = () => {
    // onclose fires after this; nothing else to do
  };
}

let currentSessionId: string | null = null;

function reconnect(token: string): void {
  connectGateway(token);
}

async function handleInteraction(d: any): Promise<void> {
  const name = d?.data?.name as string | undefined;
  const id = d?.id as string;
  const token = d?.token as string;
  if (!name || !id || !token) return;

  const options: Record<string, string> = {};
  for (const opt of d.data?.options ?? []) options[opt.name] = String(opt.value);

  try {
    switch (name) {
      case "status":
        await reply(id, token, await handleStatus());
        break;
      case "start":
      case "stop":
      case "restart": {
        // Power actions go through the panel's own permission-free path:
        // the bot acts as the server owner. Falix API via the panel lib.
        const { sendPowerSignal } = await import("./falix");
        const cfg = getConfig();
        const result = await sendPowerSignal(cfg.FALIX_SERVER_ID, name as "start" | "stop" | "restart");
        await reply(id, token, `Server ${name} sent — state: ${result.state ?? "unknown"}`, false);
        await import("./events").then((m) =>
          m.insertEvent({
            type: name === "start" ? "server_start" : name === "stop" ? "server_stop" : "server_restart",
            message: `${name} issued from Discord by <@${d?.member?.user?.id ?? d?.user?.id ?? "unknown"}>`,
            data: { via: "discord", signal: name, state: result.state },
          }).catch(() => undefined),
        );
        break;
      }
      case "console":
        await reply(id, token, await handleConsole(options.command ?? ""));
        break;
      case "graves":
        await reply(id, token, await handleGraves());
        break;
      case "players":
        await reply(id, token, await handlePlayers());
        break;
      default:
        await reply(id, token, `Unknown command: ${name}`);
    }
  } catch (e) {
    await reply(id, token, `Error: ${e instanceof Error ? e.message : "unknown failure"}`).catch(() => undefined);
  }
}

/** Start the bot if a token exists. Safe to call repeatedly. */
export function ensureDiscordBot(): void {
  if (running) return;
  void (async () => {
    const token = await getBotToken();
    if (!token) return; // not configured — silent
    running = true;
    connectGateway(token);
    log("starting gateway connection");
  })();
}

export function isDiscordBotRunning(): boolean {
  return running;
}
