import net from "node:net";
import { getConfig } from "./config";

const SERVERDATA_AUTH = 3;
const SERVERDATA_AUTH_RESPONSE = 2;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_RESPONSE_VALUE = 0;

export class RconError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RconError";
  }
}

interface Packet {
  id: number;
  type: number;
  body: string;
}

function encodePacket(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, "utf8");
  // Total size after the 4-byte length field:
  // 4 bytes ID + 4 bytes Type + body length + 2 null bytes (0x00, 0x00)
  const size = 4 + 4 + bodyBuf.length + 2;
  const buf = Buffer.alloc(4 + size);
  buf.writeInt32LE(size, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  buf.writeInt8(0, 12 + bodyBuf.length);
  buf.writeInt8(0, 12 + bodyBuf.length + 1);
  return buf;
}

function tryDecodePacket(buf: Buffer): { packet: Packet; rest: Buffer } | null {
  if (buf.length < 12) return null;
  const size = buf.readInt32LE(0);
  if (buf.length < size + 4) return null;
  const id = buf.readInt32LE(4);
  const type = buf.readInt32LE(8);
  const body = buf.subarray(12, 4 + size - 2).toString("utf8");
  return { packet: { id, type, body }, rest: buf.subarray(4 + size) };
}

export async function rconExec(command: string, timeoutMs = 7000): Promise<string> {
  const cfg = getConfig();
  if (!cfg.RCON_PORT || !cfg.RCON_PASSWORD) {
    throw new RconError("RCON is not configured (missing port or password)");
  }

  const host = cfg.MINECRAFT_SERVER_HOST || "127.0.0.1";
  const port = Number(cfg.RCON_PORT);
  const password = cfg.RCON_PASSWORD;

  const clean = command.replace(/[\r\n\u0000]/g, " ").trim();
  if (!clean) throw new RconError("Empty command");

  return new Promise<string>((resolve, reject) => {
    let socket: net.Socket | null = null;
    let buffer: Buffer = Buffer.alloc(0);
    let authed = false;
    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        if (socket) socket.destroy();
        reject(new RconError("RCON connection timed out"));
      }
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      if (socket) {
        socket.removeAllListeners();
        socket.destroy();
      }
    };

    try {
      socket = net.createConnection({ host, port }, () => {
        socket?.write(encodePacket(1, SERVERDATA_AUTH, password));
      });
    } catch (e) {
      cleanup();
      reject(new RconError(`RCON socket creation error: ${(e as Error).message}`));
      return;
    }

    socket.on("error", (err) => {
      if (!done) {
        done = true;
        cleanup();
        reject(new RconError(`RCON error: ${err.message}`));
      }
    });

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const decoded = tryDecodePacket(buffer);
        if (!decoded) break;
        buffer = decoded.rest;
        const { packet } = decoded;

        if (!authed) {
          if (packet.type === SERVERDATA_AUTH_RESPONSE) {
            if (packet.id === -1) {
              done = true;
              cleanup();
              reject(new RconError("RCON authentication failed (incorrect password)"));
              return;
            }
            authed = true;
            socket?.write(encodePacket(7, SERVERDATA_EXECCOMMAND, clean));
          }
        } else if (packet.type === SERVERDATA_RESPONSE_VALUE && packet.id === 7) {
          done = true;
          cleanup();
          resolve(packet.body);
          return;
        }
      }
    });
  });
}

export async function checkRconStatus(): Promise<{ online: boolean; latencyMs?: number; error?: string }> {
  const cfg = getConfig();
  if (!cfg.RCON_PORT || !cfg.RCON_PASSWORD) {
    return { online: false, error: "Not configured" };
  }

  const start = Date.now();
  try {
    const res = await rconExec("list", 4000);
    return { online: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { online: false, error: (err as Error).message };
  }
}
