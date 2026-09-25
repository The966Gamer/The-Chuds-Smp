import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig, saveConfig } from "./src/server/config";
import { initDb, q, memDb, getDbPool } from "./src/server/db";
import {
  hashPassword,
  verifyPassword,
  createSession,
  validateSession,
  requireAuth,
  requireRole,
  type UserSession,
} from "./src/server/auth";
import {
  getFalixConsoleStatus,
  getFalixServer,
  sendFalixPowerSignal,
  readFalixConsoleLog,
  sendFalixCommand,
  FalixError,
} from "./src/server/falix";
import { rconExec, checkRconStatus } from "./src/server/rcon";
import { pingMinecraftServer, recordMinecraftEvent } from "./src/server/minecraft";
import { queueDiscordNotification } from "./src/server/discord";
import { registerClient, broadcastEvent } from "./src/server/sse";
import {
  startDiscordBot,
  stopDiscordBot,
  restartDiscordBot,
  getDiscordBotStatus,
} from "./src/server/discordBot";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isServerless = Boolean(
  process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.SERVERLESS,
);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use(cookieParser());

// Support Netlify function route mapping
app.use((req, _res, next) => {
  if (req.url.startsWith("/.netlify/functions/api")) {
    req.url = req.url.replace("/.netlify/functions/api", "/api");
  }
  next();
});

// Initialize database schemas in background
void initDb();

// Start Discord Bot if token configured (only in persistent Node environments, not serverless functions)
if (!isServerless) {
  void startDiscordBot();
}

// ------------------------------------------------------------------ Auth APIs
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      res.status(400).json({ error: "Username and password required" });
      return;
    }

    const uName = String(username).trim();
    const pool = getDbPool();

    let user = null;
    if (pool) {
      try {
        const dbRes = await q(
          `select id, username, password_hash, role, power_scope, mc_username, head_url from users where username = $1`,
          [uName],
        );
        if (dbRes.rows.length > 0) {
          user = dbRes.rows[0];
        }
      } catch (dbErr) {
        console.warn("[auth] DB lookup failed, falling back to memory:", dbErr);
      }
    }

    if (!user) {
      user = memDb.users.get(uName.toLowerCase());
    }

    if (!user) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const valid = verifyPassword(String(password), user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const userAgent = (req.headers["user-agent"] as string) || "";
    const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "";
    const { token, csrfToken, expiresAt } = await createSession(user.id, userAgent, ip);

    res.cookie("chudsmp_session", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      expires: expiresAt,
      path: "/",
    });

    res.json({
      csrfToken,
      token,
      user: {
        username: user.username,
        role: user.role,
      },
    });
  } catch (err: any) {
    console.error("[auth] Login error:", err);
    res.status(500).json({ error: "Login processing error", details: err?.message || String(err) });
  }
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  const token = req.cookies?.chudsmp_session;
  res.clearCookie("chudsmp_session", { path: "/" });
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const session = (req as any).userSession as UserSession;
  const featuresMap = (memDb.panel_settings.get("features") as Record<string, boolean>) || {};
  const enabledFeatures = Object.keys(featuresMap).filter((k) => featuresMap[k]);

  res.json({
    user: session.user,
    csrfToken: session.csrfToken,
    features: enabledFeatures,
    powerScope: session.user.powerScope || "full",
  });
});

// ------------------------------------------------------------------ Setup Wizard
app.post("/api/setup", async (req, res) => {
  const { falix, minecraft, supabase, rcon, integrationSecret, discordWebhook, admin } = req.body;

  if (!admin?.username || !admin?.password) {
    res.status(400).json({ error: "Admin username and password are required" });
    return;
  }

  const patch: Record<string, string> = {};
  if (falix?.apiBase) patch.FALIX_API_BASE = falix.apiBase;
  if (falix?.apiKey) patch.FALIX_API_KEY = falix.apiKey;
  if (falix?.serverId) patch.FALIX_SERVER_ID = falix.serverId;
  if (minecraft?.host) patch.MINECRAFT_SERVER_HOST = minecraft.host;
  if (minecraft?.port) patch.MINECRAFT_SERVER_PORT = minecraft.port;
  if (rcon?.port) patch.RCON_PORT = rcon.port;
  if (rcon?.password) patch.RCON_PASSWORD = rcon.password;
  if (supabase?.databaseUrl) patch.DATABASE_URL = supabase.databaseUrl;
  if (supabase?.url) patch.SUPABASE_URL = supabase.url;
  if (supabase?.anonKey) patch.SUPABASE_ANON_KEY = supabase.anonKey;
  if (supabase?.serviceKey) patch.SUPABASE_SERVICE_ROLE_KEY = supabase.serviceKey;
  if (supabase?.dbPassword) patch.SUPABASE_DB_PASSWORD = supabase.dbPassword;
  if (integrationSecret) patch.INTEGRATION_SECRET_KEY = integrationSecret;
  if (discordWebhook) patch.DISCORD_WEBHOOK_URL = discordWebhook;

  saveConfig(patch);

  // Initialize DB tables
  await initDb();

  // Create or update admin account
  const adminPwHash = hashPassword(admin.password);
  const pool = getDbPool();

  if (pool) {
    try {
      await q(
        `insert into users (username, username_display, password_hash, role, power_scope, mc_username)
         values ($1, $1, $2, 'admin', 'full', $1)
         on conflict (username) do update set
           password_hash = excluded.password_hash,
           role = 'admin',
           power_scope = 'full',
           updated_at = now()`,
        [admin.username, adminPwHash],
      );
    } catch {
      // fallback
    }
  }

  // Also update in memory
  memDb.users.set(admin.username.toLowerCase(), {
    id: crypto.randomUUID(),
    username: admin.username,
    username_display: admin.username,
    password_hash: adminPwHash,
    role: "admin",
    power_scope: "full",
    mc_username: admin.username,
    head_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  res.json({ ok: true, message: "Setup completed successfully" });
});

// ------------------------------------------------------------------ Server Status
app.get("/api/status", async (req, res) => {
  const cfg = getConfig();
  let falixStatus = null;
  let mcStatus = null;

  // 1. Falix Status
  if (cfg.FALIX_API_KEY && cfg.FALIX_SERVER_ID) {
    try {
      falixStatus = await getFalixConsoleStatus(cfg.FALIX_SERVER_ID);
    } catch (err) {
      if (err instanceof FalixError) {
        falixStatus = { error: err.message, status: "error" };
      } else {
        falixStatus = { error: (err as Error).message, status: "error" };
      }
    }
  }

  // 2. Minecraft Server Ping
  if (cfg.MINECRAFT_SERVER_HOST) {
    try {
      mcStatus = await pingMinecraftServer(
        cfg.MINECRAFT_SERVER_HOST,
        Number(cfg.MINECRAFT_SERVER_PORT) || 25565,
        3500,
      );
    } catch (err) {
      mcStatus = { online: false, error: (err as Error).message };
    }
  }

  // 3. Online player list from memory
  const onlinePlayers = Array.from(memDb.players.values())
    .filter((p) => p.online)
    .map((p) => p.username);

  if (mcStatus?.playerNames && mcStatus.playerNames.length > 0) {
    for (const name of mcStatus.playerNames) {
      if (!onlinePlayers.includes(name)) onlinePlayers.push(name);
    }
  }

  res.json({
    falix: falixStatus,
    minecraft: mcStatus,
    players: {
      onlinePlayers: mcStatus?.playersOnline ?? onlinePlayers.length,
      playerNames: onlinePlayers,
    },
    server: {
      name: falixStatus && "serverName" in falixStatus ? (falixStatus as any).serverName : "Minecraft Server",
      address: `${cfg.MINECRAFT_SERVER_HOST}:${cfg.MINECRAFT_SERVER_PORT}`,
      software: mcStatus?.version ? { name: "Minecraft", version: mcStatus.version } : null,
    },
    config: {
      host: cfg.MINECRAFT_SERVER_HOST,
      port: cfg.MINECRAFT_SERVER_PORT,
    },
  });
});

// ------------------------------------------------------------------ Server Power
app.post("/api/power", async (req, res) => {
  const { signal } = req.body;
  const cfg = getConfig();

  // Validate integration key if called from worker/bot, or validate user session
  const integrationKey = req.headers["x-integration-key"];
  let userSession: UserSession | null = null;

  if (integrationKey && integrationKey === cfg.INTEGRATION_SECRET_KEY) {
    // Authorized via integration secret
  } else {
    const token = req.cookies?.chudsmp_session || req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    userSession = await validateSession(token);
    if (!userSession) {
      res.status(401).json({ error: "Invalid session" });
      return;
    }

    // Power permission scope check
    if (userSession.user.powerScope === "none") {
      res.status(403).json({ error: "You do not have permission to execute power commands" });
      return;
    }
    if (userSession.user.powerScope === "start" && signal !== "start") {
      res.status(403).json({ error: "You only have permission to start the server" });
      return;
    }
  }

  if (!cfg.FALIX_SERVER_ID || !cfg.FALIX_API_KEY) {
    res.status(503).json({ error: "Falix API is not configured" });
    return;
  }

  try {
    const result = await sendFalixPowerSignal(cfg.FALIX_SERVER_ID, signal);

    // Record server event
    await recordMinecraftEvent({
      type: `server_${signal}`,
      source: userSession ? `panel (${userSession.user.username})` : "discord",
      message: `Server ${signal} signal sent`,
    });

    res.json({ ok: true, result });
  } catch (err) {
    if (err instanceof FalixError && err.actionUrl) {
      res.status(400).json({
        error: {
          code: "falix_action_required",
          message: err.message,
          action_url: err.actionUrl,
        },
      });
      return;
    }
    res.status(err instanceof FalixError ? err.status : 500).json({
      error: (err as Error).message,
    });
  }
});

// ------------------------------------------------------------------ Console
app.get("/api/console", requireAuth, async (req, res) => {
  const cfg = getConfig();
  const linesCount = Number(req.query.lines) || 40;

  if (cfg.FALIX_SERVER_ID && cfg.FALIX_API_KEY) {
    try {
      const data = await readFalixConsoleLog(cfg.FALIX_SERVER_ID, linesCount);
      res.json(data);
      return;
    } catch (err) {
      // Fall through to events fallback
    }
  }

  // Fallback to recent events formatted as console log
  const fallback = memDb.server_events.slice(0, linesCount).map((e) => {
    const time = new Date(e.created_at).toTimeString().split(" ")[0];
    return `[${time}] [Server thread/INFO]: ${e.player_name ? `<${e.player_name}> ` : ""}${e.message || e.type}`;
  });

  res.json({ lines: fallback, source: "events" });
});

app.post("/api/console/command", async (req, res) => {
  const { command } = req.body;
  if (!command) {
    res.status(400).json({ error: "Command required" });
    return;
  }

  const cfg = getConfig();
  const integrationKey = req.headers["x-integration-key"];

  if (!integrationKey || integrationKey !== cfg.INTEGRATION_SECRET_KEY) {
    const token = req.cookies?.chudsmp_session || req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const session = token ? await validateSession(token) : null;
    if (!session || !["admin", "moderator"].includes(session.user.role)) {
      res.status(403).json({ error: "Administrator or moderator permissions required" });
      return;
    }
  }

  // Try RCON first if configured
  if (cfg.RCON_PORT && cfg.RCON_PASSWORD) {
    try {
      const output = await rconExec(command, 6000);
      res.json({ ok: true, output });
      return;
    } catch {
      // Fallback to Falix API
    }
  }

  // Falix API command
  if (cfg.FALIX_SERVER_ID && cfg.FALIX_API_KEY) {
    try {
      const result = await sendFalixCommand(cfg.FALIX_SERVER_ID, command);
      res.json({ ok: true, output: result.output || (result.accepted ? "Command accepted" : "Sent to server") });
      return;
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
      return;
    }
  }

  res.status(503).json({ error: "No console transport configured (Falix or RCON required)" });
});

// ------------------------------------------------------------------ Players
app.get("/api/players", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
  const search = (req.query.search as string || "").trim().toLowerCase();

  const all = Array.from(memDb.players.values()).filter((p) =>
    search ? p.username.toLowerCase().includes(search) : true,
  );

  const start = (page - 1) * pageSize;
  const paged = all.slice(start, start + pageSize).map((p) => ({
    username: p.username,
    headUrl: p.head_url,
    online: Boolean(p.online),
    firstSeen: p.first_seen,
    lastSeen: p.last_seen,
    playtimeSeconds: p.playtime_seconds || 0,
    permissionLevel: p.permission_level || "player",
    joins: p.joins || 0,
    deaths: p.deaths || 0,
  }));

  res.json({ players: paged, total: all.length });
});

app.get("/api/players/:username", async (req, res) => {
  const uName = req.params.username.toLowerCase();
  const player = memDb.players.get(uName) || {
    username: req.params.username,
    online: false,
    first_seen: null,
    last_seen: null,
    playtime_seconds: 0,
    permission_level: "player",
    joins: 0,
    deaths: 0,
    head_url: `https://mc-heads.net/avatar/${encodeURIComponent(req.params.username)}/64`,
    uuid: null,
  };

  const graves = memDb.graves.filter((g) => g.player_name.toLowerCase() === uName);
  const events = memDb.server_events.filter(
    (e) => e.player_name && e.player_name.toLowerCase() === uName,
  );

  res.json({
    player: {
      username: player.username,
      uuid: player.uuid || null,
      headUrl: player.head_url,
      online: Boolean(player.online),
      firstSeen: player.first_seen,
      lastSeen: player.last_seen,
      playtimeSeconds: player.playtime_seconds,
      permissionLevel: player.permission_level,
      joins: player.joins,
      deaths: player.deaths,
    },
    statistics: [],
    graves: graves.slice(0, 10),
    events: events.slice(0, 10),
  });
});

// ------------------------------------------------------------------ Graves
app.get("/api/graves", async (req, res) => {
  const statusFilter = (req.query.status as string) || "";
  let graves = memDb.graves;

  if (statusFilter) {
    graves = graves.filter((g) => g.status === statusFilter);
  }

  const mapped = graves.map((g) => {
    let remainingMs = null;
    if (g.despawn_at) {
      remainingMs = Math.max(0, new Date(g.despawn_at).getTime() - Date.now());
    }
    return {
      id: g.id,
      graveKey: g.grave_key,
      playerName: g.player_name,
      x: g.x,
      y: g.y,
      z: g.z,
      dimension: g.dimension,
      deathTime: g.death_time,
      despawnAt: g.despawn_at,
      remainingMs,
      status: g.status,
      headUrl: `https://mc-heads.net/avatar/${encodeURIComponent(g.player_name)}/64`,
    };
  });

  res.json({ graves: mapped });
});

app.post("/api/graves", async (req, res) => {
  const { playerName, x, y, z, dimension, despawnMinutes } = req.body;
  if (!playerName || x === undefined || y === undefined || z === undefined) {
    res.status(400).json({ error: "Player name and X, Y, Z coordinates are required" });
    return;
  }

  const cleanDim = dimension || "minecraft:overworld";
  const numX = Number(x);
  const numY = Number(y);
  const numZ = Number(z);

  if (isNaN(numX) || isNaN(numY) || isNaN(numZ)) {
    res.status(400).json({ error: "Coordinates must be valid numbers" });
    return;
  }

  await recordMinecraftEvent({
    type: "grave_created",
    source: "manual-panel",
    playerName: String(playerName).trim(),
    message: `Grave logged for ${playerName} at ${numX}, ${numY}, ${numZ} (${cleanDim})`,
    data: {
      graveKey: `grave-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      x: numX,
      y: numY,
      z: numZ,
      dimension: cleanDim,
      despawnMinutes: Number(despawnMinutes) || 60,
    },
  });

  res.json({ ok: true });
});

app.patch("/api/graves/:graveKey", async (req, res) => {
  const { status } = req.body;
  const graveKey = req.params.graveKey;
  const gr = memDb.graves.find((g) => g.grave_key === graveKey);
  if (!gr) {
    res.status(404).json({ error: "Grave not found" });
    return;
  }

  gr.status = status || "recovered";
  try {
    await q(`update graves set status = $1, updated_at = now() where grave_key = $2`, [gr.status, graveKey]);
  } catch {
    // non-fatal
  }

  broadcastEvent("event", {
    type: "grave_removed",
    data: { graveKey },
    createdAt: new Date().toISOString(),
  });

  res.json({ ok: true, grave: gr });
});

// ------------------------------------------------------------------ Chat
app.get("/api/chat", async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const before = req.query.before ? Number(req.query.before) : null;

  let messages = memDb.chat_messages;
  if (before) {
    messages = messages.filter((m) => m.id < before);
  }

  const sliced = messages.slice(0, limit).reverse();
  const formatted = sliced.map((m) => ({
    id: m.id,
    playerName: m.player_name,
    message: m.message,
    createdAt: m.created_at,
    headUrl: `https://mc-heads.net/avatar/${encodeURIComponent(m.player_name)}/64`,
  }));

  res.json({
    messages: formatted,
    hasMore: messages.length > limit,
  });
});

app.post("/api/chat", requireAuth, async (req, res) => {
  const { message } = req.body;
  const session = (req as any).userSession as UserSession;

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Message required" });
    return;
  }

  const clean = message.replace(/[\r\n]/g, " ").trim();
  const playerName = session.user.mcUsername || session.user.username;

  // Send to in-game server via console if possible
  const cfg = getConfig();
  if (cfg.RCON_PORT && cfg.RCON_PASSWORD) {
    void rconExec(`say [Panel] <${playerName}> ${clean}`).catch(() => undefined);
  } else if (cfg.FALIX_SERVER_ID && cfg.FALIX_API_KEY) {
    void sendFalixCommand(cfg.FALIX_SERVER_ID, `say [Panel] <${playerName}> ${clean}`).catch(() => undefined);
  }

  // Record chat event
  await recordMinecraftEvent({
    type: "chat_message",
    source: "panel",
    playerName,
    message: clean,
  });

  res.json({ ok: true });
});

// ------------------------------------------------------------------ Activity
app.get("/api/activity", async (req, res) => {
  const filter = (req.query.filter as string) || "all";
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
  const before = req.query.before ? Number(req.query.before) : null;

  let events = memDb.server_events;
  if (before) {
    events = events.filter((e) => e.id < before);
  }

  if (filter === "joins") events = events.filter((e) => e.type === "player_join");
  else if (filter === "leaves") events = events.filter((e) => e.type === "player_leave");
  else if (filter === "deaths") events = events.filter((e) => e.type === "player_death");
  else if (filter === "graves") events = events.filter((e) => e.type.startsWith("grave_"));
  else if (filter === "chat") events = events.filter((e) => e.type === "chat_message");
  else if (filter === "server") events = events.filter((e) => e.type.startsWith("server_"));
  else if (filter === "admin") events = events.filter((e) => e.type === "admin_action");

  const sliced = events.slice(0, limit).map((e) => ({
    id: e.id,
    type: e.type,
    source: e.source,
    playerName: e.player_name,
    message: e.message,
    data: e.data,
    createdAt: e.created_at,
    headUrl: e.player_name ? `https://mc-heads.net/avatar/${encodeURIComponent(e.player_name)}/64` : null,
  }));

  res.json({
    events: sliced,
    hasMore: events.length > limit,
  });
});

// ------------------------------------------------------------------ Statistics
app.get("/api/statistics", requireAuth, async (req, res) => {
  const session = (req as any).userSession as UserSession;
  const mcName = session.user.mcUsername || session.user.username;

  res.json({
    unavailable: false,
    reason: null,
    player: mcName,
    headUrl: `https://mc-heads.net/avatar/${encodeURIComponent(mcName)}/64`,
    statistics: [],
    history: [],
  });
});

// ------------------------------------------------------------------ Discord Config
app.get("/api/discord", requireAuth, async (req, res) => {
  const cfg = getConfig();
  const maskedUrl = cfg.DISCORD_WEBHOOK_URL
    ? cfg.DISCORD_WEBHOOK_URL.replace(/webhooks\/(\d+)\/(.*)/, "webhooks/$1/••••••••")
    : null;

  const supportedEvents = [
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
  ];

  res.json({
    configured: Boolean(cfg.DISCORD_WEBHOOK_URL),
    maskedUrl,
    enabledEvents: supportedEvents,
    supportedEvents,
    recent: memDb.discord_events.slice(0, 15),
  });
});

app.put("/api/discord", requireAuth, requireRole(["admin"]), async (req, res) => {
  const { webhookUrl } = req.body;
  if (webhookUrl !== undefined) {
    saveConfig({ DISCORD_WEBHOOK_URL: webhookUrl });
  }
  res.json({ ok: true });
});

app.post("/api/discord", requireAuth, requireRole(["admin"]), async (req, res) => {
  await queueDiscordNotification("server_start", {
    message: "Test notification dispatched from control panel",
  });
  res.json({ ok: true });
});

app.get("/api/discord/bot", requireAuth, async (req, res) => {
  const cfg = getConfig();
  const botStatus = getDiscordBotStatus();
  res.json({
    configured: Boolean(cfg.DISCORD_BOT_TOKEN),
    maskedToken: cfg.DISCORD_BOT_TOKEN ? `${cfg.DISCORD_BOT_TOKEN.slice(0, 6)}••••••••` : null,
    botRunning: botStatus.running,
    botUser: botStatus.botUser,
    connectedAt: botStatus.connectedAt,
    lastError: botStatus.lastError,
  });
});

app.post("/api/discord/bot", requireAuth, requireRole(["admin"]), async (req, res) => {
  const { token } = req.body;
  const clean = token ? String(token).trim() : "";
  saveConfig({ DISCORD_BOT_TOKEN: clean });
  if (clean) {
    restartDiscordBot();
  } else {
    stopDiscordBot();
  }
  res.json({ ok: true, botRunning: Boolean(clean) });
});

app.post("/api/discord/bot/reconnect", requireAuth, requireRole(["admin"]), async (req, res) => {
  restartDiscordBot();
  res.json({ ok: true, message: "Reconnecting Discord Bot..." });
});

// ------------------------------------------------------------------ Panel Settings
app.get("/api/panel-settings", requireAuth, async (req, res) => {
  res.json({
    features: memDb.panel_settings.get("features") || {},
    grave: memDb.panel_settings.get("grave") || { despawnMinutes: 60, protection: true },
    discordNames: memDb.panel_settings.get("discordNames") || {},
  });
});

app.post("/api/panel-settings", requireAuth, requireRole(["admin"]), async (req, res) => {
  const { features, grave, discordNames } = req.body;

  if (features) {
    const cur = (memDb.panel_settings.get("features") as Record<string, boolean>) || {};
    memDb.panel_settings.set("features", { ...cur, ...features });
  }
  if (grave) {
    const cur = (memDb.panel_settings.get("grave") as Record<string, any>) || {};
    memDb.panel_settings.set("grave", { ...cur, ...grave });
  }
  if (discordNames) {
    const cur = (memDb.panel_settings.get("discordNames") as Record<string, string>) || {};
    for (const [k, v] of Object.entries(discordNames)) {
      if (!v) delete cur[k];
      else cur[k] = String(v);
    }
    memDb.panel_settings.set("discordNames", cur);
  }

  res.json({
    features: memDb.panel_settings.get("features"),
    grave: memDb.panel_settings.get("grave"),
    discordNames: memDb.panel_settings.get("discordNames"),
  });
});

// ------------------------------------------------------------------ Settings & Sessions
app.get("/api/settings", requireAuth, async (req, res) => {
  const cfg = getConfig();
  res.json({
    server: {
      falixServerId: cfg.FALIX_SERVER_ID,
      falixApiBase: cfg.FALIX_API_BASE,
      minecraftHost: cfg.MINECRAFT_SERVER_HOST,
      minecraftPort: cfg.MINECRAFT_SERVER_PORT,
    },
    integration: {
      configured: Boolean(cfg.INTEGRATION_SECRET_KEY),
      maskedKey: cfg.INTEGRATION_SECRET_KEY ? "••••••••" : "",
    },
    rcon: {
      configured: Boolean(cfg.RCON_PORT && cfg.RCON_PASSWORD),
      port: cfg.RCON_PORT || null,
    },
    secrets: {
      falixKey: cfg.FALIX_API_KEY ? "••••••••" : "",
      supabaseServiceKey: cfg.SUPABASE_SERVICE_ROLE_KEY ? "••••••••" : "",
    },
  });
});

app.post("/api/settings", requireAuth, async (req, res) => {
  const { action, currentPassword, newPassword, sessionId } = req.body;
  const session = (req as any).userSession as UserSession;

  if (action === "change_password") {
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      res.status(400).json({ error: "New password must be at least 8 characters" });
      return;
    }

    const u = memDb.users.get(session.user.username.toLowerCase());
    if (u && !verifyPassword(currentPassword, u.password_hash)) {
      res.status(401).json({ error: "Current password incorrect" });
      return;
    }

    const newHash = hashPassword(newPassword);
    if (u) u.password_hash = newHash;

    const pool = getDbPool();
    if (pool) {
      try {
        await q(`update users set password_hash = $1 where id = $2`, [newHash, session.user.id]);
      } catch {
        // non-fatal
      }
    }

    res.json({ ok: true });
    return;
  }

  if (action === "list_sessions") {
    const list = Array.from(memDb.sessions.values()).map((s) => ({
      id: s.id,
      created_at: s.created_at,
      last_seen_at: s.last_seen_at,
      expires_at: s.expires_at,
      user_agent: s.user_agent,
    }));
    res.json({ sessions: list });
    return;
  }

  if (action === "revoke_session" && sessionId) {
    for (const [key, s] of memDb.sessions.entries()) {
      if (s.id === sessionId) {
        memDb.sessions.delete(key);
        break;
      }
    }
    res.json({ ok: true });
    return;
  }

  res.json({ ok: true });
});

// ------------------------------------------------------------------ Users & Permissions
app.get("/api/permissions", requireAuth, requireRole(["admin"]), async (req, res) => {
  const users = Array.from(memDb.users.values()).map((u) => ({
    username: u.username,
    displayName: u.username_display || u.username,
    role: u.role,
    powerScope: u.power_scope || "full",
    createdAt: u.created_at,
  }));
  res.json({ users });
});

app.put("/api/permissions", requireAuth, requireRole(["admin"]), async (req, res) => {
  const { username, powerScope } = req.body;
  const u = memDb.users.get(String(username).toLowerCase());
  if (u) {
    u.power_scope = powerScope;
  }
  res.json({ ok: true });
});

app.put("/api/settings", requireAuth, requireRole(["admin"]), async (req, res) => {
  const { username, role } = req.body;
  const u = memDb.users.get(String(username).toLowerCase());
  if (u) {
    u.role = role;
  }
  res.json({ ok: true });
});

app.post("/api/users", requireAuth, requireRole(["admin"]), async (req, res) => {
  const { username, password, mcUsername, role } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }

  const hash = hashPassword(password);
  memDb.users.set(username.toLowerCase(), {
    id: crypto.randomUUID(),
    username,
    username_display: username,
    password_hash: hash,
    role: role || "player",
    power_scope: "full",
    mc_username: mcUsername || username,
    head_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  res.json({ ok: true });
});

// ------------------------------------------------------------------ Layout
app.get("/api/layout", requireAuth, async (req, res) => {
  const session = (req as any).userSession as UserSession;
  const layout = memDb.dashboard_layouts.get(session.user.id) || null;
  res.json({ layout });
});

app.put("/api/layout", requireAuth, async (req, res) => {
  const session = (req as any).userSession as UserSession;
  const { layout } = req.body;
  if (layout) {
    memDb.dashboard_layouts.set(session.user.id, layout);
  }
  res.json({ ok: true });
});

// ------------------------------------------------------------------ Notifications
app.get("/api/notifications", requireAuth, async (req, res) => {
  res.json({ notifications: memDb.notifications.slice(0, 30) });
});

app.post("/api/notifications", requireAuth, async (req, res) => {
  for (const n of memDb.notifications) {
    n.read = true;
  }
  res.json({ ok: true });
});

// ------------------------------------------------------------------ Realtime SSE
app.get("/api/realtime", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  registerClient(res);

  // Send immediate status ping
  res.write(`data: ${JSON.stringify({ type: "ping", time: Date.now() })}\n\n`);
});

// ------------------------------------------------------------------ Inbound Minecraft Mod Event Webhook
app.post("/api/mc/event", async (req, res) => {
  const cfg = getConfig();
  const secret = req.headers["x-integration-key"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");

  if (cfg.INTEGRATION_SECRET_KEY && secret !== cfg.INTEGRATION_SECRET_KEY) {
    res.status(401).json({ error: "Unauthorized integration secret" });
    return;
  }

  const { type, playerName, message, data } = req.body;
  if (!type) {
    res.status(400).json({ error: "Event type required" });
    return;
  }

  await recordMinecraftEvent({
    type,
    source: "minecraft-mod",
    playerName,
    message,
    data,
  });

  res.json({ ok: true, received: type });
});

// ------------------------------------------------------------------ Vite & Static Frontend
async function setupVite() {
  if (process.env.NODE_ENV === "production") {
    app.use(express.static(path.resolve(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(__dirname, "dist", "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[thechudsmp] Server running on http://0.0.0.0:${PORT}`);
  });
}

if (!isServerless) {
  setupVite().catch((err) => {
    console.error("Fatal startup error:", err);
  });
}

export { app };
export default app;
