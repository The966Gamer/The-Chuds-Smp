import WebSocket from "ws";
import { getConfig } from "./config";

export class FalixError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public actionUrl?: string,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "FalixError";
  }
}

export interface FalixServerDetail {
  id: number;
  uuid: string;
  shortUuid?: string;
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

const UPDATE_CODES: Record<number, { code: string; hint: string }> = {
  401: { code: "falix_unauthorized", hint: "The Falix API key was rejected. Check FALIX_API_KEY." },
  403: {
    code: "falix_forbidden",
    hint: "The API key lacks the scope for this action. Regenerate with servers:read, servers:command, servers:control.",
  },
  404: { code: "falix_not_found", hint: "Falix resource or server not found." },
  409: { code: "falix_conflict", hint: "Falix reports a conflicting server state for this operation." },
  429: { code: "falix_rate_limited", hint: "Falix rate limit hit. Slow down or retry later." },
  502: { code: "falix_upstream", hint: "Falix upstream node error (502). Try again shortly." },
  503: { code: "falix_unavailable", hint: "Falix API temporarily unavailable (503)." },
};

async function falixRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const cfg = getConfig();
  if (!cfg.FALIX_API_KEY) {
    throw new FalixError(500, "not_configured", "FALIX_API_KEY is not configured");
  }

  const url = `${cfg.FALIX_API_BASE}${path}`;
  let res: globalThis.Response;

  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.FALIX_API_KEY}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new FalixError(503, "network_error", `Falix API unreachable: ${msg}`);
  }

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const errBody = json as { error?: { code?: string; message?: string; action_url?: string } } | null;
    const actionUrl = errBody?.error?.action_url;
    const mapped = UPDATE_CODES[res.status];
    const upstreamMsg = errBody?.error?.message;

    let message: string;
    if (actionUrl) {
      message = `Falix free tier requires captcha verification. Open the verification link, complete the captcha, and press 'Start Server' on that Falix page to start your server.${upstreamMsg ? ` (${upstreamMsg})` : ""}`;
    } else if (upstreamMsg) {
      message = `${mapped?.hint || "Falix API error"}: ${upstreamMsg}`;
    } else {
      message = mapped?.hint || `Falix API error ${res.status}`;
    }

    throw new FalixError(
      res.status,
      actionUrl ? "falix_action_required" : (mapped?.code || errBody?.error?.code || "falix_error"),
      message,
      actionUrl,
    );
  }

  const env = json as { data?: unknown } | null;
  if (env && typeof env === "object" && "data" in env) {
    return env.data as T;
  }
  return json as T;
}

export async function getFalixServer(serverId: string): Promise<FalixServerDetail> {
  return falixRequest<FalixServerDetail>("GET", `/servers/${encodeURIComponent(serverId)}`);
}

export async function getFalixConsoleStatus(serverId: string): Promise<FalixConsoleStatus> {
  const data = await falixRequest<any>("GET", `/servers/${encodeURIComponent(serverId)}/console/status`);
  return {
    status: data.status,
    nodeId: data.node_id ?? data.nodeId ?? 0,
    serverName: data.server_name ?? data.serverName ?? "",
    message: data.message ?? "",
    nodeReady: Boolean(data.node_ready ?? data.nodeReady),
    resources: data.resources || null,
  };
}

export async function sendFalixPowerSignal(
  serverId: string,
  signal: "start" | "stop" | "restart" | "kill",
): Promise<{ signal: string; state: string }> {
  return falixRequest<{ signal: string; state: string }>("POST", `/servers/${encodeURIComponent(serverId)}/power`, {
    signal,
  });
}

export async function readFalixConsoleLog(
  serverId: string,
  lines = 40,
): Promise<{ lines: string[]; source: string | null }> {
  try {
    const data = await falixRequest<any>(
      "GET",
      `/servers/${encodeURIComponent(serverId)}/console/log?lines=${Math.min(Math.max(lines, 5), 50)}`,
    );
    if (Array.isArray(data?.lines) && data.lines.length > 0) {
      return {
        lines: data.lines,
        source: data?.source ?? "falix",
      };
    }
  } catch {
    // fallback to latest.log file
  }

  // Fallback: read directly from /logs/latest.log
  try {
    const fileRes = await falixRequest<{ content?: string; data?: string }>(
      "GET",
      `/servers/${encodeURIComponent(serverId)}/files/content?path=/logs/latest.log`,
    );
    const content = typeof fileRes === "string" ? fileRes : fileRes?.content || (fileRes as any)?.data || "";
    if (content) {
      const split = content.split(/\r?\n/).filter(Boolean);
      return {
        lines: split.slice(-Math.min(Math.max(lines, 5), 100)),
        source: "file",
      };
    }
  } catch {
    // non-fatal
  }

  return { lines: [], source: "none" };
}

/**
 * Executes a command on the Minecraft server console via Falix API v2 WebSocket session.
 */
export async function sendFalixCommand(
  serverId: string,
  command: string,
  timeoutMs = 6000,
): Promise<{ accepted: boolean; output: string }> {
  const clean = command.replace(/^[/]+/, "").trim();
  if (!clean) {
    return { accepted: false, output: "No command specified" };
  }

  // 1. Mint a short-lived console token & get socket URL
  const session = await falixRequest<{
    token: string;
    socket: string;
  }>("POST", `/servers/${encodeURIComponent(serverId)}/console/token`);

  if (!session?.token || !session?.socket) {
    throw new FalixError(500, "console_session_failed", "Failed to retrieve Falix console session token");
  }

  // 2. Connect to node WebSocket and dispatch command
  return new Promise<{ accepted: boolean; output: string }>((resolve, reject) => {
    let ws: WebSocket | null = null;
    let timer: NodeJS.Timeout | null = null;
    const outputLines: string[] = [];
    let authenticated = false;
    let finished = false;

    const cleanup = () => {
      finished = true;
      if (timer) clearTimeout(timer);
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }
    };

    timer = setTimeout(() => {
      if (finished) return;
      const rawOut = outputLines.join("\n").trim();
      cleanup();
      if (authenticated) {
        resolve({
          accepted: true,
          output: rawOut || "Command dispatched to console",
        });
      } else {
        reject(new Error("Falix console WebSocket timed out waiting for authentication"));
      }
    }, timeoutMs);

    try {
      ws = new WebSocket(session.socket);

      ws.on("open", () => {
        ws?.send(JSON.stringify({ event: "auth", args: [session.token] }));
      });

      ws.on("message", (raw: WebSocket.Data) => {
        if (finished) return;
        try {
          const packet = JSON.parse(raw.toString());
          if (packet.event === "auth success") {
            authenticated = true;
            // Send the command
            ws?.send(JSON.stringify({ event: "send command", args: [clean] }));

            // Give the server 1.2s to collect output before resolving
            setTimeout(() => {
              if (finished) return;
              const text = outputLines.join("\n").trim();
              const isOffline = text.toLowerCase().includes("server is not running");
              cleanup();
              resolve({
                accepted: !isOffline,
                output: isOffline
                  ? "⚠️ Minecraft server is currently offline. Start the server first with /start or in the panel."
                  : (text || "Command accepted by server console"),
              });
            }, 1200);
          } else if (packet.event === "console output" && Array.isArray(packet.args)) {
            const cleanLine = String(packet.args[0] || "").replace(/\u001b\[[0-9;]*m/g, "").trim();
            if (cleanLine) {
              outputLines.push(cleanLine);
            }
          } else if (packet.event === "status" && Array.isArray(packet.args) && packet.args[0] === "offline") {
            outputLines.push("[Falcon]: server is not running");
          }
        } catch {
          // ignore parsing error
        }
      });

      ws.on("error", (err) => {
        if (finished) return;
        cleanup();
        reject(new Error(`Falix console connection error: ${err.message}`));
      });
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}
