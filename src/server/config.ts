import fs from "node:fs";
import path from "node:path";

export interface AppConfig {
  FALIX_API_BASE: string;
  FALIX_API_KEY: string;
  FALIX_SERVER_ID: string;
  MINECRAFT_SERVER_HOST: string;
  MINECRAFT_SERVER_PORT: string;
  RCON_PORT: string;
  RCON_PASSWORD: string;
  DATABASE_URL: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_DB_PASSWORD: string;
  INTEGRATION_SECRET_KEY: string;
  DISCORD_WEBHOOK_URL: string;
  DISCORD_BOT_TOKEN: string;
  SESSION_SECRET: string;
  ADMIN_USERNAME: string;
}

const CONFIG_FILE = path.resolve(process.cwd(), "config.storage.json");

function readStoredConfig(): Partial<AppConfig> {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch {
    // non-fatal
  }
  return {};
}

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const stored = readStoredConfig();

  cachedConfig = {
    FALIX_API_BASE: (process.env.FALIX_API_BASE || stored.FALIX_API_BASE || "https://client.falixnodes.net/api/v2").replace(/\/+$/, ""),
    FALIX_API_KEY: process.env.FALIX_API_KEY || stored.FALIX_API_KEY || "",
    FALIX_SERVER_ID: process.env.FALIX_SERVER_ID || stored.FALIX_SERVER_ID || "",
    MINECRAFT_SERVER_HOST: process.env.MINECRAFT_SERVER_HOST || stored.MINECRAFT_SERVER_HOST || "127.0.0.1",
    MINECRAFT_SERVER_PORT: process.env.MINECRAFT_SERVER_PORT || stored.MINECRAFT_SERVER_PORT || "25565",
    RCON_PORT: process.env.RCON_PORT || stored.RCON_PORT || "",
    RCON_PASSWORD: process.env.RCON_PASSWORD || stored.RCON_PASSWORD || "",
    DATABASE_URL: process.env.DATABASE_URL || stored.DATABASE_URL || "",
    SUPABASE_URL: process.env.SUPABASE_URL || stored.SUPABASE_URL || "",
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || stored.SUPABASE_ANON_KEY || "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || stored.SUPABASE_SERVICE_ROLE_KEY || "",
    SUPABASE_DB_PASSWORD: process.env.SUPABASE_DB_PASSWORD || stored.SUPABASE_DB_PASSWORD || "",
    INTEGRATION_SECRET_KEY: process.env.INTEGRATION_SECRET_KEY || stored.INTEGRATION_SECRET_KEY || "",
    DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL || stored.DISCORD_WEBHOOK_URL || "",
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || stored.DISCORD_BOT_TOKEN || "",
    SESSION_SECRET: process.env.SESSION_SECRET || stored.SESSION_SECRET || "thechudsmp-super-secret-session-key",
    ADMIN_USERNAME: process.env.ADMIN_USERNAME || stored.ADMIN_USERNAME || "SuperDuck220",
  };

  return cachedConfig;
}

export function saveConfig(patch: Partial<AppConfig>) {
  const current = readStoredConfig();
  const next = { ...current, ...patch };
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), "utf-8");
  } catch (err) {
    console.error("[config] Failed to write config.storage.json:", err);
  }
  cachedConfig = null;
  return getConfig();
}
