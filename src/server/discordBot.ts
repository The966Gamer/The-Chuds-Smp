import WebSocket from "ws";
import { getConfig } from "./config";
import {
  getFalixConsoleStatus,
  sendFalixPowerSignal,
  sendFalixCommand,
  FalixError,
} from "./falix";
import { pingMinecraftServer, recordMinecraftEvent } from "./minecraft";
import { rconExec } from "./rcon";
import { memDb } from "./db";

const DISCORD_API = "https://discord.com/api/v10";

export const DISCORD_SLASH_COMMANDS = [
  {
    name: "help",
    description: "List all TheChudSMP bot commands, controls, and syntax",
  },
  {
    name: "status",
    description: "Check Minecraft server and Falix status",
  },
  {
    name: "start",
    description: "Start the Minecraft server (or get captcha verification link)",
  },
  {
    name: "stop",
    description: "Stop the Minecraft server",
  },
  {
    name: "restart",
    description: "Restart the Minecraft server",
  },
  {
    name: "console",
    description: "Execute a command on the Minecraft server console",
    options: [
      {
        name: "command",
        description: "The command to run (e.g. list, say hello, time set day)",
        type: 3, // STRING
        required: true,
      },
    ],
  },
  {
    name: "players",
    description: "Show online Minecraft players",
  },
  {
    name: "graves",
    description: "List active graves with coordinates and despawn timer",
  },
];

interface BotState {
  running: boolean;
  botUser: { id: string; username: string; discriminator: string; avatar: string | null } | null;
  lastError: string | null;
  connectedAt: string | null;
  syncedGuilds: string[];
}

const state: BotState = {
  running: false,
  botUser: null,
  lastError: null,
  connectedAt: null,
  syncedGuilds: [],
};

let ws: WebSocket | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let lastSeq: number | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let isStopping = false;

async function discordRest(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Discord API ${res.status}: ${errText}`);
  }
  return res.json().catch(() => null);
}

export async function syncGuildCommands(token: string, appId: string, guildId: string) {
  try {
    await discordRest(token, "PUT", `/applications/${appId}/guilds/${guildId}/commands`, DISCORD_SLASH_COMMANDS);
    console.log(`[discord-bot] Registered ${DISCORD_SLASH_COMMANDS.length} slash commands in guild ${guildId}`);
    if (!state.syncedGuilds.includes(guildId)) {
      state.syncedGuilds.push(guildId);
    }
  } catch (err) {
    console.error(`[discord-bot] Failed to register slash commands in guild ${guildId}:`, (err as Error).message);
  }
}

export async function registerAllCommands(token: string, appId: string) {
  // 1. Register global commands
  try {
    await discordRest(token, "PUT", `/applications/${appId}/commands`, DISCORD_SLASH_COMMANDS);
    console.log(`[discord-bot] Registered ${DISCORD_SLASH_COMMANDS.length} global slash commands for app ${appId}`);
  } catch (err) {
    console.error("[discord-bot] Failed to register global slash commands:", (err as Error).message);
  }

  // 2. Register guild-specific commands for instant availability in all guilds
  try {
    const guilds = await discordRest(token, "GET", "/users/@me/guilds");
    if (Array.isArray(guilds)) {
      for (const g of guilds) {
        if (g?.id) {
          await syncGuildCommands(token, appId, g.id);
        }
      }
    }
  } catch (err) {
    console.error("[discord-bot] Failed to list guilds for command registration:", (err as Error).message);
  }
}

export async function executeBotAction(
  actionName: string,
  rawArg?: string,
  callerName?: string,
): Promise<{ content: string; embeds?: any[] }> {
  const name = actionName.toLowerCase().trim();
  const cfg = getConfig();
  const caller = callerName ? ` (invoked by ${callerName})` : "";

  if (name === "help") {
    return {
      content:
        `🛡️ **TheChudSMP Discord Bot Commands**\n\n` +
        `You can use slash commands (e.g. \`/status\`) or text commands (e.g. \`!status\` or \`@bot status\`):\n\n` +
        `• **/status** or \`!status\` — Check Minecraft server ping, online players, latency, & Falix node status\n` +
        `• **/start** or \`!start\` — Start the server (provides captcha verification link if required by Falix)\n` +
        `• **/stop** or \`!stop\` — Stop the Minecraft server\n` +
        `• **/restart** or \`!restart\` — Restart the Minecraft server\n` +
        `• **/console <command>** or \`!console <command>\` — Run any console command (e.g. \`!console list\`)\n` +
        `• **/players** or \`!players\` — List online players and current playtimes\n` +
        `• **/graves** or \`!graves\` — List active death chests, coordinates, and despawn timers\n` +
        `• **/help** or \`!help\` — Show this help message`,
    };
  }

  if (name === "status") {
    let mcStatus: any = null;
    let falixStatus: any = null;

    if (cfg.MINECRAFT_SERVER_HOST) {
      try {
        mcStatus = await pingMinecraftServer(
          cfg.MINECRAFT_SERVER_HOST,
          Number(cfg.MINECRAFT_SERVER_PORT) || 25565,
          3500,
        );
      } catch (e) {
        mcStatus = { online: false, error: (e as Error).message };
      }
    }

    if (cfg.FALIX_SERVER_ID && cfg.FALIX_API_KEY) {
      try {
        falixStatus = await getFalixConsoleStatus(cfg.FALIX_SERVER_ID);
      } catch (e) {
        falixStatus = { error: (e as Error).message };
      }
    }

    const online = mcStatus?.online;
    const playersOnline = mcStatus?.playersOnline ?? 0;
    const playersMax = mcStatus?.playersMax ?? 0;
    const latency = mcStatus?.latencyMs != null ? `${mcStatus.latencyMs}ms` : "N/A";
    const version = mcStatus?.version || "N/A";
    const falixState = falixStatus?.status || (falixStatus?.error ? `Error (${falixStatus.error})` : "Unknown");

    return {
      content:
        `🎮 **Minecraft Server Status**\n` +
        `• Status: **${online ? "ONLINE 🟢" : "OFFLINE 🔴"}**\n` +
        `• Players: **${playersOnline} / ${playersMax}**\n` +
        `• Latency: **${latency}**\n` +
        `• Version: **${version}**\n` +
        `• Falix State: **${falixState}**\n` +
        `• Server Address: \`${cfg.MINECRAFT_SERVER_HOST}:${cfg.MINECRAFT_SERVER_PORT}\``,
    };
  }

  if (name === "start") {
    if (!cfg.FALIX_SERVER_ID || !cfg.FALIX_API_KEY) {
      return { content: "❌ Falix API credentials (FALIX_API_KEY, FALIX_SERVER_ID) are not configured." };
    }

    try {
      await sendFalixPowerSignal(cfg.FALIX_SERVER_ID, "start");
      void recordMinecraftEvent({
        type: "server_start",
        source: "discord-bot",
        message: `Server start signal dispatched from Discord${caller}`,
      });
      return { content: "⚡ **Start command sent to FalixNodes!** The server is booting up now." };
    } catch (err) {
      if (err instanceof FalixError && err.actionUrl) {
        return {
          content:
            `⚠️ **Falix Captcha Verification Required to Start Server**\n\n` +
            `Falix free tier requires completing a quick captcha to start the server:\n` +
            `1. Open verification link: **${err.actionUrl}**\n` +
            `2. Complete the captcha on that Falix page.\n` +
            `3. Click **"Start Server"** on that page to boot the server.\n\n` +
            `Once you click Start Server there, your Minecraft server will start!`,
        };
      }
      return { content: `❌ Failed to start server: ${(err as Error).message}` };
    }
  }

  if (name === "stop") {
    if (!cfg.FALIX_SERVER_ID || !cfg.FALIX_API_KEY) {
      return { content: "❌ Falix API credentials are not configured." };
    }
    try {
      await sendFalixPowerSignal(cfg.FALIX_SERVER_ID, "stop");
      void recordMinecraftEvent({
        type: "server_stop",
        source: "discord-bot",
        message: `Server stop signal dispatched from Discord${caller}`,
      });
      return { content: "🛑 **Stop signal sent.** The Minecraft server is shutting down." };
    } catch (err) {
      return { content: `❌ Failed to stop server: ${(err as Error).message}` };
    }
  }

  if (name === "restart") {
    if (!cfg.FALIX_SERVER_ID || !cfg.FALIX_API_KEY) {
      return { content: "❌ Falix API credentials are not configured." };
    }
    try {
      await sendFalixPowerSignal(cfg.FALIX_SERVER_ID, "restart");
      void recordMinecraftEvent({
        type: "server_restart",
        source: "discord-bot",
        message: `Server restart signal dispatched from Discord${caller}`,
      });
      return { content: "🔄 **Restart signal sent.** The Minecraft server is restarting." };
    } catch (err) {
      if (err instanceof FalixError && err.actionUrl) {
        return {
          content:
            `⚠️ **Falix Captcha Verification Required**\n\n` +
            `Falix free tier requires captcha verification:\n` +
            `1. Open link: **${err.actionUrl}**\n` +
            `2. Complete the captcha and click **"Start Server"**.\n`,
        };
      }
      return { content: `❌ Failed to restart server: ${(err as Error).message}` };
    }
  }

  if (name === "console") {
    const cmd = (rawArg || "").trim().replace(/^\//, "");
    if (!cmd) {
      return { content: "⚠️ Please provide a command to run. Example: `/console list` or `!console list`" };
    }

    // Try RCON first
    if (cfg.RCON_PORT && cfg.RCON_PASSWORD) {
      try {
        const output = await rconExec(cmd, 6000);
        return {
          content: `💻 **Console execution (RCON):** \`/${cmd}\`\n\`\`\`\n${(output || "(command executed with no output)").slice(0, 1800)}\n\`\`\``,
        };
      } catch {
        // Fallback to Falix
      }
    }

    if (cfg.FALIX_SERVER_ID && cfg.FALIX_API_KEY) {
      try {
        const res = await sendFalixCommand(cfg.FALIX_SERVER_ID, cmd);
        return {
          content: `💻 **Console execution (Falix):** \`/${cmd}\`\n\`\`\`\n${(res.output || (res.accepted ? "Command accepted by server" : "Dispatched to server")).slice(0, 1800)}\n\`\`\``,
        };
      } catch (falixErr) {
        return { content: `❌ Command execution failed: ${(falixErr as Error).message}` };
      }
    }

    return { content: "❌ Neither RCON nor Falix API is available for command execution." };
  }

  if (name === "players") {
    const players = Array.from(memDb.players.values()).filter((p) => p.online);
    if (players.length === 0) {
      return { content: "👤 **Online Players:** Nobody is currently online." };
    }
    const lines = players.map((p) => `• **${p.username}** (Playtime: ${Math.floor((p.playtime_seconds || 0) / 60)}m)`).join("\n");
    return { content: `👤 **Online Players (${players.length}):**\n${lines}` };
  }

  if (name === "graves") {
    const graves = memDb.graves.filter((g) => g.status === "active");
    if (graves.length === 0) {
      return { content: "🪦 **Graves:** No active graves recorded." };
    }
    const lines = graves.slice(0, 8).map((g) => {
      const remainingMs = g.despawn_at ? Math.max(0, new Date(g.despawn_at).getTime() - Date.now()) : null;
      const remainingStr = remainingMs ? `${Math.floor(remainingMs / 60000)}m remaining` : "active";
      return `• **${g.player_name}** at \`${g.x}, ${g.y}, ${g.z}\` (${g.dimension}) — *${remainingStr}*`;
    }).join("\n");
    return { content: `🪦 **Active Graves (${graves.length}):**\n${lines}` };
  }

  return { content: `Unknown command: \`${actionName}\`. Type \`/help\` or \`!help\` to see available commands.` };
}

export function startDiscordBot() {
  const cfg = getConfig();
  const token = cfg.DISCORD_BOT_TOKEN?.trim();

  if (!token) {
    state.running = false;
    state.botUser = null;
    state.lastError = "DISCORD_BOT_TOKEN not configured";
    return;
  }

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return; // Already active
  }

  isStopping = false;
  state.lastError = null;

  try {
    console.log("[discord-bot] Connecting to Discord Gateway...");
    ws = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");

    ws.on("open", () => {
      console.log("[discord-bot] Gateway WebSocket connected.");
    });

    ws.on("message", async (raw: WebSocket.Data) => {
      try {
        const packet = JSON.parse(raw.toString());
        const { op, d, s, t } = packet;

        if (s !== null && s !== undefined) lastSeq = s;

        // Op 10: Hello
        if (op === 10) {
          const heartbeatInterval = d.heartbeat_interval;
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          heartbeatTimer = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ op: 1, d: lastSeq }));
            }
          }, heartbeatInterval);

          // Op 2: Identify with standard non-privileged intents: GUILDS (1) + GUILD_MESSAGES (512) + DIRECT_MESSAGES (2048) = 2561
          // (Avoids error 4014: Disallowed intent(s) if Message Content Privileged Intent is not enabled in portal)
          ws?.send(
            JSON.stringify({
              op: 2,
              d: {
                token,
                intents: 2561,
                properties: {
                  os: "linux",
                  browser: "thechudsmp-bot",
                  device: "thechudsmp-bot",
                },
              },
            }),
          );
        }

        // Op 0: Dispatch
        if (op === 0) {
          if (t === "READY") {
            state.running = true;
            state.botUser = {
              id: d.user.id,
              username: d.user.username,
              discriminator: d.user.discriminator,
              avatar: d.user.avatar,
            };
            state.connectedAt = new Date().toISOString();
            console.log(`[discord-bot] Successfully authenticated as ${d.user.username}#${d.user.discriminator} (ID: ${d.user.id})`);

            // Register slash commands both globally and in each guild
            void registerAllCommands(token, d.application.id);
          }

          if (t === "GUILD_CREATE") {
            const guildId = d.id;
            const appId = state.botUser?.id;
            if (guildId && appId && !state.syncedGuilds.includes(guildId)) {
              void syncGuildCommands(token, appId, guildId);
            }
          }

          // Handle Slash Commands (INTERACTION_CREATE)
          if (t === "INTERACTION_CREATE" && d.type === 2) {
            const name = d.data?.name;
            const cmdOption = d.data?.options?.find((o: any) => o.name === "command");
            const arg = cmdOption?.value as string | undefined;
            const caller = d.member?.user?.username || d.user?.username;
            const appId = d.application_id || state.botUser?.id;

            // 1. Defer immediately to prevent 3-second timeout
            try {
              await discordRest(token, "POST", `/interactions/${d.id}/${d.token}/callback`, {
                type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
              });
            } catch (ackErr) {
              console.warn("[discord-bot] Interaction ack error:", (ackErr as Error).message);
            }

            // 2. Execute command
            try {
              const reply = await executeBotAction(name, arg, caller);
              await discordRest(token, "PATCH", `/webhooks/${appId}/${d.token}/messages/@original`, {
                content: reply.content,
                embeds: reply.embeds,
              });
            } catch (cmdErr) {
              console.error("[discord-bot] Error fulfilling interaction:", cmdErr);
              try {
                await discordRest(token, "PATCH", `/webhooks/${appId}/${d.token}/messages/@original`, {
                  content: `❌ Command execution error: ${(cmdErr as Error).message}`,
                });
              } catch {
                // ignore
              }
            }
          }

          // Handle Text / Prefix Commands (!status, !start, !help, @bot status...)
          if (t === "MESSAGE_CREATE") {
            // Ignore messages from bots
            if (d.author?.bot) return;

            const content = (d.content || "").trim();
            const botId = state.botUser?.id;
            const mentionPrefix1 = `<@${botId}>`;
            const mentionPrefix2 = `<@!${botId}>`;

            let cmdStr = "";
            if (content.startsWith("!")) {
              cmdStr = content.slice(1).trim();
            } else if (content.startsWith(mentionPrefix1)) {
              cmdStr = content.slice(mentionPrefix1.length).trim();
            } else if (content.startsWith(mentionPrefix2)) {
              cmdStr = content.slice(mentionPrefix2.length).trim();
            }

            if (cmdStr) {
              const [cmdName, ...argParts] = cmdStr.split(/\s+/);
              const arg = argParts.join(" ");
              const validCommands = ["status", "start", "stop", "restart", "console", "players", "graves", "help"];

              if (validCommands.includes(cmdName.toLowerCase())) {
                const caller = d.author?.username;
                try {
                  const reply = await executeBotAction(cmdName, arg, caller);
                  await discordRest(token, "POST", `/channels/${d.channel_id}/messages`, {
                    content: reply.content,
                    message_reference: {
                      message_id: d.id,
                      fail_if_not_exists: false,
                    },
                  });
                } catch (e) {
                  console.error("[discord-bot] Error executing text command:", e);
                }
              }
            }
          }
        }

        // Op 1: Heartbeat request
        if (op === 1) {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 1, d: lastSeq }));
          }
        }

        // Op 9: Invalid Session
        if (op === 9) {
          console.warn("[discord-bot] Invalid Gateway session, reconnecting in 5s...");
          ws?.close();
        }
      } catch (err) {
        console.error("[discord-bot] Packet parse error:", err);
      }
    });

    ws.on("close", (code, reason) => {
      state.running = false;
      state.botUser = null;
      if (heartbeatTimer) clearInterval(heartbeatTimer);

      const msg = `Gateway closed (${code}): ${reason.toString()}`;
      console.warn(`[discord-bot] ${msg}`);
      state.lastError = msg;

      if (!isStopping) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          startDiscordBot();
        }, 5000);
      }
    });

    ws.on("error", (err) => {
      console.error("[discord-bot] WebSocket error:", err.message);
      state.lastError = err.message;
    });
  } catch (err) {
    state.lastError = (err as Error).message;
    state.running = false;
  }
}

export function stopDiscordBot() {
  isStopping = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) {
    try {
      ws.close();
    } catch {
      // ignore
    }
    ws = null;
  }
  state.running = false;
  state.botUser = null;
  state.lastError = null;
  state.syncedGuilds = [];
}

export function restartDiscordBot() {
  stopDiscordBot();
  setTimeout(() => {
    startDiscordBot();
  }, 1000);
}

export function getDiscordBotStatus() {
  return {
    ...state,
    configured: Boolean(getConfig().DISCORD_BOT_TOKEN),
  };
}
