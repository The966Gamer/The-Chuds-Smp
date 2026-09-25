/**
 * TheChudSmp Persistent Discord Gateway Worker
 *
 * Runs as a dedicated persistent Node.js process (NOT inside serverless/Netlify functions).
 * Maintains a live Discord Gateway connection, registers slash commands, and executes
 * real server actions with server-side authorization.
 */

import WebSocket from "ws";
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const PANEL_URL = (process.env.PANEL_API_URL || "http://localhost:3000").replace(/\/+$/, "");
const INTEGRATION_KEY = process.env.PANEL_INTEGRATION_KEY || "";
const DB_URL = process.env.DATABASE_URL;

let dbPool: Pool | null = null;
if (DB_URL) {
  dbPool = new Pool({
    connectionString: DB_URL,
    ssl: DB_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  });
}

const DISCORD_API = "https://discord.com/api/v10";

const COMMANDS = [
  { name: "status", description: "Check Minecraft server and Falix status" },
  { name: "start", description: "Start the Minecraft server" },
  { name: "stop", description: "Stop the Minecraft server" },
  { name: "restart", description: "Restart the Minecraft server" },
  {
    name: "console",
    description: "Execute a command on the Minecraft server via RCON",
    options: [
      {
        name: "command",
        description: "The command to run (e.g. list, say hello, time set day)",
        type: 3, // STRING
        required: true,
      },
    ],
  },
  { name: "players", description: "Show online Minecraft players" },
  { name: "graves", description: "List active graves with coordinates and timer" },
];

async function discordRest(method: string, path: string, body?: unknown) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${TOKEN}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Discord API error ${res.status}: ${errText}`);
  }
  return res.json().catch(() => null);
}

async function registerCommands(appId: string) {
  try {
    await discordRest("PUT", `/applications/${appId}/commands`, COMMANDS);
    console.log(`[discord-worker] Successfully registered ${COMMANDS.length} global slash commands.`);
  } catch (err) {
    console.error("[discord-worker] Failed to register slash commands:", err);
  }
}

async function handleCommand(interaction: any): Promise<{ content: string; ephemeral?: boolean }> {
  const name = interaction.data?.name;

  if (name === "status") {
    try {
      const res = await fetch(`${PANEL_URL}/api/status`);
      const data = await res.json();
      const mc = data.minecraft;
      const falix = data.falix;

      return {
        content: `**Minecraft Server Status**\n` +
          `• State: **${mc?.online ? "Online 🟢" : "Offline 🔴"}**\n` +
          `• Version: ${mc?.version || "N/A"}\n` +
          `• Players: ${mc?.playersOnline ?? 0} / ${mc?.playersMax ?? 0}\n` +
          `• Latency: ${mc?.latencyMs != null ? `${mc.latencyMs} ms` : "N/A"}\n` +
          `• Falix State: ${falix?.status || "Unknown"}`,
      };
    } catch {
      return { content: "⚠️ Could not connect to panel API to fetch status." };
    }
  }

  if (name === "start" || name === "stop" || name === "restart") {
    try {
      const res = await fetch(`${PANEL_URL}/api/power`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-integration-key": INTEGRATION_KEY,
        },
        body: JSON.stringify({ signal: name }),
      });
      const data = await res.json();
      if (!res.ok) {
        const actionUrl = data?.error?.action_url || data?.action_url;
        if (actionUrl) {
          return {
            content:
              `⚠️ **Falix Captcha Verification Required to Start Server**\n\n` +
              `Falix free tier requires completing a quick captcha to start the server:\n` +
              `1. Open the verification link: **${actionUrl}**\n` +
              `2. Complete the captcha on the Falix page.\n` +
              `3. Click **"Start Server"** on that page to boot the server.\n\n` +
              `Once you click Start Server there, your Minecraft server will start!`,
          };
        }
        const errMsg = typeof data?.error === "string" ? data.error : data?.error?.message || "Unknown error";
        return { content: `❌ Power action failed: ${errMsg}` };
      }
      return { content: `⚡ Sent **${name}** power signal to server.` };
    } catch (err) {
      return { content: `❌ Error communicating with panel API: ${(err as Error).message}` };
    }
  }

  if (name === "console") {
    const cmdOption = interaction.data?.options?.find((o: any) => o.name === "command");
    const cmd = cmdOption?.value;
    if (!cmd) return { content: "Missing command option." };

    try {
      const res = await fetch(`${PANEL_URL}/api/console/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-integration-key": INTEGRATION_KEY,
        },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { content: `❌ Command failed: ${data.error || "Execution failed"}` };
      }
      return {
        content: `**Command:** \`/${cmd}\`\n\`\`\`\n${(data.output || "(command executed)").slice(0, 1800)}\n\`\`\``,
      };
    } catch (err) {
      return { content: `❌ Command execution failed: ${(err as Error).message}` };
    }
  }

  if (name === "players") {
    try {
      const res = await fetch(`${PANEL_URL}/api/players?pageSize=50`);
      const data = await res.json();
      const onlinePlayers = (data.players || []).filter((p: any) => p.online);
      if (onlinePlayers.length === 0) {
        return { content: "Nobody is online right now." };
      }
      const names = onlinePlayers.map((p: any) => `• **${p.username}**`).join("\n");
      return { content: `**Online Players (${onlinePlayers.length}):**\n${names}` };
    } catch {
      return { content: "⚠️ Could not retrieve players." };
    }
  }

  if (name === "graves") {
    try {
      const res = await fetch(`${PANEL_URL}/api/graves?status=active`);
      const data = await res.json();
      const graves = data.graves || [];
      if (graves.length === 0) {
        return { content: "No active graves recorded." };
      }
      const list = graves
        .slice(0, 8)
        .map(
          (g: any) =>
            `• **${g.playerName}** at \`${g.x}, ${g.y}, ${g.z}\` (${g.dimension})`,
        )
        .join("\n");
      return { content: `**Active Graves:**\n${list}` };
    } catch {
      return { content: "⚠️ Could not retrieve graves." };
    }
  }

  return { content: "Unknown command." };
}

let ws: WebSocket | null = null;
let heartbeatInterval = 41250;
let heartbeatTimer: any = null;
let lastSeq: number | null = null;

function connectGateway() {
  if (!TOKEN) {
    console.log("[discord-worker] DISCORD_BOT_TOKEN not configured. Sleeping...");
    return;
  }

  console.log("[discord-worker] Connecting to Discord Gateway...");
  ws = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");

  ws.on("open", () => {
    console.log("[discord-worker] Connected to Gateway WebSocket.");
  });

  ws.on("message", async (raw: WebSocket.Data) => {
    try {
      const packet = JSON.parse(raw.toString());
      const { op, d, s, t } = packet;

      if (s !== null && s !== undefined) lastSeq = s;

      // Op 10: Hello
      if (op === 10) {
        heartbeatInterval = d.heartbeat_interval;
        clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          ws?.send(JSON.stringify({ op: 1, d: lastSeq }));
        }, heartbeatInterval);

        // Send Op 2: Identify
        ws?.send(
          JSON.stringify({
            op: 2,
            d: {
              token: TOKEN,
              intents: 513, // GUILDS | GUILD_MESSAGES
              properties: {
                os: "linux",
                browser: "thechudsmp-worker",
                device: "thechudsmp-worker",
              },
            },
          }),
        );
      }

      // Op 0: Dispatch
      if (op === 0) {
        if (t === "READY") {
          console.log(`[discord-worker] Logged in as ${d.user.username}#${d.user.discriminator} (ID: ${d.user.id})`);
          await registerCommands(d.application.id);
        }

        if (t === "INTERACTION_CREATE" && d.type === 2) {
          // Slash command interaction
          const reply = await handleCommand(d);
          await discordRest("POST", `/interactions/${d.id}/${d.token}/callback`, {
            type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
            data: {
              content: reply.content,
              flags: reply.ephemeral ? 64 : 0,
            },
          });
        }
      }

      // Op 1: Heartbeat requested
      if (op === 1) {
        ws?.send(JSON.stringify({ op: 1, d: lastSeq }));
      }
    } catch (err) {
      console.error("[discord-worker] Packet handling error:", err);
    }
  });

  ws.on("close", (code, reason) => {
    console.warn(`[discord-worker] Gateway closed (${code}): ${reason.toString()}. Reconnecting in 5s...`);
    clearInterval(heartbeatTimer);
    setTimeout(connectGateway, 5000);
  });

  ws.on("error", (err) => {
    console.error("[discord-worker] Gateway error:", err.message);
  });
}

connectGateway();
