/**
 * Minimal Source RCON client (protocol documented at
 * https://developer.valvesoftware.com/wiki/Source_RCON_Protocol).
 * Used only when the panel is configured with RCON_PORT/RCON_PASSWORD as a
 * fallback console transport. Single-use connections keep the protocol simple.
 */
import net from "node:net";

const SERVERDATA_AUTH = 3;
const SERVERDATA_AUTH_RESPONSE = 2;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_RESPONSE_VALUE = 0;

export class RconError extends Error {}

interface Packet {
  id: number;
  type: number;
  body: string;
}

function encode(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, "ascii");
  const size = 4 + 4 + bodyBuf.length + 2;
  const buf = Buffer.alloc(4 + size);
  buf.writeInt32LE(size, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  buf.writeInt8(0, size + 8);
  buf.writeInt8(0, size + 9);
  return buf;
}

function tryDecode(buf: Buffer): { packet: Packet; rest: Buffer } | null {
  if (buf.length < 12) return null;
  const size = buf.readInt32LE(0);
  if (buf.length < size + 4) return null;
  const id = buf.readInt32LE(4);
  const type = buf.readInt32LE(8);
  const body = buf.slice(12, 4 + size - 2).toString("utf8");
  return { packet: { id, type, body }, rest: buf.slice(4 + size) };
}

export interface RconConfig {
  host: string;
  port: number;
  password: string;
}

export async function rconExec(
  cfg: RconConfig,
  command: string,
  timeoutMs = 8000,
): Promise<string> {
  const clean = command.replace(/[\r\n\u0000]/g, " ").trim();
  if (!clean) throw new RconError("Empty command");
  return new Promise<string>((resolve, reject) => {
    const socket = net.createConnection({ host: cfg.host, port: cfg.port });
    let buffer: Buffer = Buffer.alloc(0);
    let authed = false;
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        socket.destroy();
        reject(new RconError("RCON timed out"));
      }
    }, timeoutMs);

    const fail = (err: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    };

    socket.on("error", (e) => fail(new RconError(`RCON connection failed: ${e.message}`)));
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const decoded = tryDecode(buffer);
        if (!decoded) break;
        buffer = decoded.rest;
        const { packet } = decoded;
        if (!authed) {
          if (packet.type === SERVERDATA_AUTH_RESPONSE) {
            if (packet.id === -1) {
              fail(new RconError("RCON authentication failed (wrong password?)"));
              return;
            }
            authed = true;
            socket.write(encode(7, SERVERDATA_EXECCOMMAND, clean));
          }
        } else if (packet.type === SERVERDATA_RESPONSE_VALUE && packet.id === 7) {
          done = true;
          clearTimeout(timer);
          socket.end();
          resolve(packet.body);
          return;
        }
      }
    });
    socket.on("connect", () => {
      socket.write(encode(1, SERVERDATA_AUTH, cfg.password));
    });
  });
}
