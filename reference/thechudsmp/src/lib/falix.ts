/**
 * FalixProvider — adapter for the official Falix v2 API.
 *
 * Only documented endpoints are used (see
 * https://client.falixnodes.net/api-docs/ — OpenAPI spec at
 * /api/v2/openapi.json). Requests are authenticated with a Bearer API key.
 * The adapter maps upstream errors onto typed errors and respects
 * X-RateLimit headers and Retry-After.
 *
 * Server-side only. The API key never leaves this module.
 */
import { getConfig } from "./config";

export type FalixPowerSignal = "start" | "stop" | "restart" | "kill";

export class FalixError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public retryAfter?: number,
    /** Set when Falix demands an out-of-band user action (e.g. free-plan start verification). */
    public actionUrl?: string,
  ) {
    super(message);
  }
}

export interface FalixServerDetail {
  id: number;
  uuid: string;
  shortUuid: string;
  name: string;
  status: string | null;
  limits?: {
    memory_mib?: number;
    disk_mib?: number;
    cpu_percent?: number;
  };
  allocation?: { ip?: string; port?: number; hostname?: string } | null;
  software?: { name?: string; version?: string } | null;
}

export interface FalixConsoleStatus {
  status: string;
  nodeId: number;
  serverName: string;
  message: string;
  nodeReady: boolean;
  resources: {
    cpu: number;
    memory: number;
    disk: number;
    network_rx: number;
    network_tx: number;
    uptime: number;
  } | null;
}

export interface FalixPowerResult {
  signal: string;
  state: "applied" | "queued" | "transferring";
}

export interface FalixPlayerStatus {
  onlinePlayers: number;
  playerNames: string[];
  querySucceeded: boolean;
}

const UPDATE_CODES: Record<number, { code: string; hint: string }> = {
  401: { code: "falix_unauthorized", hint: "The Falix API key was rejected. Check FALIX_API_KEY." },
  403: {
    code: "falix_forbidden",
    hint:
      "The API key lacks the scope or server permission for this action. " +
      "Regenerate the key with the required scopes (servers:read, servers:command, servers:control).",
  },
  404: { code: "falix_not_found", hint: "The Falix server id was not found for this API key." },
  409: { code: "falix_conflict", hint: "Falix reports a conflicting state for this operation." },
  429: { code: "falix_rate_limited", hint: "Falix rate limit hit. Slow down or retry later." },
  502: { code: "falix_upstream", hint: "Falix upstream node error (502). Try again shortly." },
  503: { code: "falix_unavailable", hint: "Falix API temporarily unavailable (503)." },
};

function baseUrl(): string {
  const c = getConfig();
  return c.FALIX_API_BASE.replace(/\/+$/, "");
}

interface RawResponse {
  status: number;
  ok: boolean;
  json: unknown;
  requestId?: string;
  retryAfter?: number;
  remaining?: number;
}

async function call(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  init: { body?: unknown; scope: string } ,
): Promise<RawResponse> {
  const c = getConfig();
  if (!c.FALIX_API_KEY) {
    throw new FalixError(500, "not_configured", "FALIX_API_KEY is not configured");
  }
  let res: globalThis.Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${c.FALIX_API_KEY}`,
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new FalixError(
      503,
      "network_error",
      /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|certificate/i.test(msg)
        ? "Falix API unreachable (network/DNS error). Check FALIX_API_BASE and this server's internet access."
        : `Falix API unreachable: ${msg}`,
    );
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  const requestId = res.headers.get("x-request-id") ?? undefined;
  const retryAfterRaw = res.headers.get("retry-after");
  const retryAfter = retryAfterRaw ? Number(retryAfterRaw) : undefined;
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (!res.ok) {
    const body = json as { error?: { code?: string; message?: string; action_url?: string } } | null;
    const mapped = UPDATE_CODES[res.status];
    const upstreamMessage = body?.error?.message;
    const actionUrl = typeof body?.error?.action_url === "string" ? body.error.action_url : undefined;
    const message = actionUrl
      ? // Falix free-plan verification flow: the server demands an out-of-band
        // action before honoring the request (e.g. first start of the day).
        `Falix requires a quick verification before this action (free-plan restriction). Open the verification link, complete the check, then retry within 5 minutes.${upstreamMessage ? ` (${upstreamMessage})` : ""}`
      : upstreamMessage
        ? `${mapped?.hint ?? "Falix API error"} (${upstreamMessage})`
        : (mapped?.hint ?? `Falix API error ${res.status}`);
    if (requestId) console.log(`[falix] ${method} ${path} failed req=${requestId}`);
    throw new FalixError(
      res.status,
      actionUrl ? "falix_action_required" : (mapped?.code ?? body?.error?.code ?? "falix_error"),
      message,
      requestId,
      Number.isFinite(retryAfter) ? retryAfter : undefined,
      actionUrl,
    );
  }
  return {
    status: res.status,
    ok: res.ok,
    json,
    requestId,
    retryAfter,
    remaining: remaining ? Number(remaining) : undefined,
  };
}

function unwrap<T>(raw: RawResponse, scope: string): T {
  // Falix v2 envelopes successful payloads in { data: ... }.
  const env = raw.json as { data?: unknown } | null;
  if (env && "data" in env) return env.data as T;
  // Fallback for endpoints that return bare payloads.
  return raw.json as T;
}

export async function getMe(): Promise<{ id?: string; username?: string }> {
  const raw = await call("GET", "/me", { scope: "account:read" });
  return unwrap(raw, "account:read");
}

export async function getServer(serverId: string): Promise<FalixServerDetail> {
  const raw = await call("GET", `/servers/${encodeURIComponent(serverId)}`, { scope: "servers:read" });
  return unwrap<FalixServerDetail>(raw, "servers:read");
}

export async function listServers(limit = 100): Promise<FalixServerDetail[]> {
  const raw = await call("GET", `/servers?limit=${limit}`, { scope: "servers:read" });
  const data = unwrap<{ object?: string; data?: unknown[] } | unknown[]>(raw, "servers:read");
  if (Array.isArray(data)) return data as FalixServerDetail[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown[] }).data)) {
    return (data as { data: unknown[] }).data as FalixServerDetail[];
  }
  return [];
}

export async function getConsoleStatus(serverId: string): Promise<FalixConsoleStatus> {
  const raw = await call("GET", `/servers/${encodeURIComponent(serverId)}/console/status`, {
    scope: "servers:read",
  });
  const data = unwrap<
    FalixConsoleStatus & { node_id: number; server_name: string; node_ready: boolean }
  >(raw, "servers:read");
  return {
    status: data.status,
    nodeId: data.node_id,
    serverName: data.server_name,
    message: data.message,
    nodeReady: data.node_ready,
    resources: data.resources ?? null,
  };
}

export async function sendPowerSignal(
  serverId: string,
  signal: FalixPowerSignal,
): Promise<FalixPowerResult> {
  const raw = await call("POST", `/servers/${encodeURIComponent(serverId)}/power`, {
    body: { signal },
    scope: "servers:control",
  });
  return unwrap<FalixPowerResult>(raw, "servers:control");
}

export async function readConsoleLog(
  serverId: string,
  lines = 40,
): Promise<{ lines: string[]; source: string | null; truncated: boolean }> {
  const raw = await call(
    "GET",
    `/servers/${encodeURIComponent(serverId)}/console/log?lines=${Math.min(Math.max(lines, 5), 40)}`,
    { scope: "servers:read" },
  );
  const data = unwrap<{ lines: string[]; source: string | null; truncated: boolean }>(raw, "servers:read");
  return {
    lines: Array.isArray(data?.lines) ? data.lines : [],
    source: data?.source ?? null,
    truncated: Boolean(data?.truncated),
  };
}

export async function sendCommand(serverId: string, command: string): Promise<{ accepted: boolean }> {
  // Commands are single-line; strip leading slash per API docs.
  const clean = command.replace(/[\r\n\u0000]/g, " ").trim();
  const stripped = clean.startsWith("/") ? clean.slice(1) : clean;
  if (!stripped) throw new FalixError(400, "bad_request", "Command cannot be empty");
  const raw = await call("POST", `/servers/${encodeURIComponent(serverId)}/commands`, {
    body: { command: stripped },
    scope: "servers:command",
  });
  return unwrap<{ accepted: boolean }>(raw, "servers:command");
}

export interface FalixResolvedPlayer {
  name: string;
  uuid: string;
  id: string; // uuid without dashes
}

/**
 * Resolve a player name to a UUID using the documented
 * `GET /servers/{id}/players/resolve` endpoint. `onlineMode=false` computes
 * the deterministic offline-mode UUID without contacting Mojang.
 */
export async function resolvePlayer(
  serverId: string,
  name: string,
  onlineMode?: boolean,
): Promise<FalixResolvedPlayer | null> {
  const params = new URLSearchParams({ name });
  if (onlineMode !== undefined) params.set("online_mode", String(onlineMode));
  const raw = await call(
    "GET",
    `/servers/${encodeURIComponent(serverId)}/players/resolve?${params.toString()}`,
    { scope: "servers:read" },
  );
  const data = unwrap<{ name?: string; uuid?: string; id?: string }>(raw, "servers:read");
  if (!data?.uuid || !data?.name) return null;
  return { name: data.name, uuid: data.uuid, id: data.id ?? data.uuid.replace(/-/g, "") };
}

export interface FalixServerPlayer {
  uuid: string;
  name: string;
  isOp: boolean;
  isBanned: boolean;
  status: "Online" | "Offline" | string;
  lastSeen: string | null;
}

export interface FalixPlayerListResult {
  players: FalixServerPlayer[];
  operators: string[];
  banned: string[];
  onlinePlayers: number;
  total: number;
}

/**
 * List players known to the server (from usercache/playerdata) with op/ban
 * status and live Online/Offline state — documented
 * `GET /servers/{id}/players`.
 */
export async function listServerPlayers(
  serverId: string,
  opts: { limit?: number; offset?: number; search?: string } = {},
): Promise<FalixPlayerListResult> {
  const params = new URLSearchParams({
    limit: String(Math.min(Math.max(opts.limit ?? 100, 1), 100)),
    offset: String(Math.max(opts.offset ?? 0, 0)),
  });
  if (opts.search) params.set("search", opts.search);
  const raw = await call(
    "GET",
    `/servers/${encodeURIComponent(serverId)}/players?${params.toString()}`,
    { scope: "servers:read" },
  );
  const env = raw.json as {
    data?: unknown;
    operators?: string[];
    banned_players?: string[];
    online_players?: number;
    pagination?: { total?: number; count?: number };
  } | null;
  const rows = Array.isArray(env?.data) ? env!.data : [];
  const players: FalixServerPlayer[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (typeof r.uuid === "string" && typeof r.name === "string") {
      players.push({
        uuid: r.uuid,
        name: r.name,
        isOp: r.is_op === true,
        isBanned: r.is_banned === true,
        status: typeof r.status === "string" ? r.status : "Offline",
        lastSeen: typeof r.last_seen === "string" ? r.last_seen : null,
      });
    }
  }
  return {
    players,
    operators: Array.isArray(env?.operators) ? env!.operators : [],
    banned: Array.isArray(env?.banned_players) ? env!.banned_players : [],
    onlinePlayers: typeof env?.online_players === "number" ? env!.online_players : 0,
    total: env?.pagination?.total ?? players.length,
  };
}

export async function getPlayersOnline(serverId: string): Promise<FalixPlayerStatus> {
  const raw = await call("GET", `/servers/${encodeURIComponent(serverId)}/players/online`, {
    scope: "servers:read",
  });
  const data = unwrap<{ online_players: number; player_names: string[]; query_succeeded: boolean }>(
    raw,
    "servers:read",
  );
  return {
    onlinePlayers: typeof data?.online_players === "number" ? data.online_players : 0,
    playerNames: Array.isArray(data?.player_names) ? data.player_names.slice(0, 200) : [],
    querySucceeded: Boolean(data?.query_succeeded),
  };
}

export async function getMinecraftStatus(
  host: string,
  port?: number,
): Promise<{
  online: boolean;
  edition?: string;
  version?: string | null;
  playersOnline?: number | null;
  playersMax?: number | null;
  latencyMs?: number | null;
  motd?: string | null;
  favicon?: string | null;
  playerSample?: string[] | null;
  reason?: string | null;
  checkedAt?: number;
} | null> {
  const params = new URLSearchParams({ host, edition: "java" });
  if (port && port !== 25565) params.set("port", String(port));
  const raw = await call("GET", `/minecraft/status?${params.toString()}`, { scope: "utility:mcquery" });
  return unwrap(raw, "utility:mcquery") as never;
}

export async function getDiscordWebhook(serverId: string): Promise<{
  configured: boolean;
  events: string[];
  maskedUrl?: string | null;
}> {
  const raw = await call("GET", `/servers/${encodeURIComponent(serverId)}/settings/discord-webhook`, {
    scope: "servers:read",
  });
  const data = unwrap<{ configured: boolean; events: string[]; webhook_url?: string | null }>(
    raw,
    "servers:read",
  );
  return {
    configured: Boolean(data?.configured),
    events: Array.isArray(data?.events) ? data.events : [],
    maskedUrl: data?.webhook_url ?? null,
  };
}

export async function setDiscordWebhook(
  serverId: string,
  webhookUrl: string,
  events: string[],
): Promise<void> {
  await call("PUT", `/servers/${encodeURIComponent(serverId)}/settings/discord-webhook`, {
    body: { webhook_url: webhookUrl, events },
    scope: "servers:control",
  });
}

export async function deleteDiscordWebhook(serverId: string): Promise<void> {
  await call("DELETE", `/servers/${encodeURIComponent(serverId)}/settings/discord-webhook`, {
    scope: "servers:control",
  });
}

export async function testDiscordWebhook(serverId: string): Promise<unknown> {
  const raw = await call("POST", `/servers/${encodeURIComponent(serverId)}/settings/discord-webhook/test`, {
    body: {},
    scope: "servers:control",
  });
  return raw.json;
}
