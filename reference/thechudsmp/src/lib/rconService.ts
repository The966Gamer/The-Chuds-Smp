import { getConfig } from "./config";
import { rconExec, RconError, type RconConfig } from "./rcon";
import { q } from "./db";

/**
 * RCON service layer. The panel talks to the Minecraft server over the Source
 * RCON protocol (RCON_PORT + RCON_PASSWORD in config) — no Falix API call, no
 * HTTP API on the server itself. One single-use connection per command keeps
 * the protocol simple and avoids idle-socket state on serverless hosts.
 */

let cachedConfig: RconConfig | null = null;

/**
 * RCON target. The host is the Minecraft server host itself; the port is the
 * RCON port (enable-rcon=true in server.properties). Cached for the process
 * lifetime; the Settings writer invalidates via clearRconConfigCache().
 */
export function getRconConfig(): RconConfig | null {
  if (cachedConfig) return cachedConfig;
  const c = getConfig();
  const host = c.MINECRAFT_SERVER_HOST?.trim();
  const port = Number(c.RCON_PORT?.trim());
  const password = c.RCON_PASSWORD?.trim();
  if (!host || !port || !password) return null;
  cachedConfig = { host, port, password };
  return cachedConfig;
}

export function clearRconConfigCache(): void {
  cachedConfig = null;
}

export function isRconConfigured(): boolean {
  return getRconConfig() !== null;
}

export class RconUnavailableError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Execute a console command on the Minecraft server via RCON. */
export async function rconSendCommand(command: string, timeoutMs = 8000): Promise<{ ok: true; response: string } | { ok: false; error: string }> {
  const cfg = getRconConfig();
  if (!cfg) {
    throw new RconUnavailableError(
      "RCON is not configured — set RCON_PORT and RCON_PASSWORD (and MINECRAFT_SERVER_HOST) in Settings or the environment",
    );
  }
  try {
    const response = await rconExec(cfg, command, timeoutMs);
    return { ok: true, response };
  } catch (e) {
    if (e instanceof RconError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "RCON command failed" };
  }
}

/** Cheap liveness probe: run a no-op-ish command and measure round-trip. */
export async function rconStatus(): Promise<{ configured: boolean; online: boolean; latencyMs?: number; error?: string }> {
  const cfg = getRconConfig();
  if (!cfg) return { configured: false, online: false, error: "not configured" };
  const started = Date.now();
  try {
    await rconExec(cfg, "list", 6000);
    return { configured: true, online: true, latencyMs: Date.now() - started };
  } catch (e) {
    return { configured: true, online: false, error: e instanceof Error ? e.message : "unreachable" };
  }
}

// ---------------------------------------------------------------------
// Discord bot token (server-side secret, stored in app_meta like the webhook)
// ---------------------------------------------------------------------

export async function getBotToken(): Promise<string | null> {
  try {
    const res = await q<{ value: { token?: string } }>(
      `select value from app_meta where key = 'discord_bot_token'`,
    );
    const fromDb = res.rows[0]?.value?.token?.trim();
    if (fromDb) return fromDb;
  } catch {
    // DB unavailable — env fallback still works.
  }
  return process.env.DISCORD_BOT_TOKEN?.trim() || null;
}

export async function setBotToken(token: string | null): Promise<void> {
  if (token === null) {
    await q(`delete from app_meta where key = 'discord_bot_token'`);
    return;
  }
  // Discord bot tokens look like four base64-ish segments separated by dots
  // (e.g. MTA… .G1xYzA. …). Anything else is rejected before storing.
  if (!/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}$/.test(token.trim())) {
    throw new Error("That does not look like a Discord bot token — copy the full token from the Developer Portal (Bot → Reset Token)");
  }
  await q(
    `insert into app_meta (key, value) values ('discord_bot_token', $1::jsonb)
     on conflict (key) do update set value = $1::jsonb, updated_at = now()`,
    [JSON.stringify({ token: token.trim() })],
  );
}
