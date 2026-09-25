import net from "node:net";
import { getConfig } from "./config";
import { q, memDb } from "./db";
import { broadcastEvent } from "./sse";
import { queueDiscordNotification } from "./discord";

export interface MinecraftStatus {
  online: boolean;
  version?: string | null;
  playersOnline?: number | null;
  playersMax?: number | null;
  latencyMs?: number | null;
  motd?: string | null;
  playerNames?: string[];
  error?: string | null;
}

// Minecraft Server List Ping (SLP) packet encoder
function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  while (true) {
    if ((value & 0xffffff80) === 0) {
      bytes.push(value);
      return Buffer.from(bytes);
    }
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
}

export async function pingMinecraftServer(
  host: string,
  port: number,
  timeoutMs = 4000,
): Promise<MinecraftStatus> {
  const startTime = Date.now();

  return new Promise<MinecraftStatus>((resolve) => {
    let socket: net.Socket | null = null;
    let done = false;
    let buffer = Buffer.alloc(0);

    const finish = (result: MinecraftStatus) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (socket) {
        socket.removeAllListeners();
        socket.destroy();
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ online: false, error: "Connection timed out" });
    }, timeoutMs);

    try {
      socket = net.createConnection({ host, port }, () => {
        // Handshake packet (protocol 47 = 1.8+, state = 1 for status)
        const hostBuf = Buffer.from(host, "utf8");
        const handshakePayload = Buffer.concat([
          writeVarInt(0), // packet ID 0
          writeVarInt(754), // protocol version
          writeVarInt(hostBuf.length),
          hostBuf,
          Buffer.from([(port >> 8) & 0xff, port & 0xff]), // port
          writeVarInt(1), // next state = status
        ]);
        const handshakePacket = Buffer.concat([writeVarInt(handshakePayload.length), handshakePayload]);

        // Status request packet
        const statusReq = Buffer.concat([writeVarInt(1), writeVarInt(0)]);

        socket?.write(Buffer.concat([handshakePacket, statusReq]));
      });
    } catch (err) {
      finish({ online: false, error: (err as Error).message });
      return;
    }

    socket.on("error", (err) => {
      finish({ online: false, error: err.message });
    });

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        // Read varint length
        let offset = 0;
        let packetLen = 0;
        let shift = 0;
        while (offset < buffer.length) {
          const b = buffer[offset++];
          packetLen |= (b & 0x7f) << shift;
          if ((b & 0x80) === 0) break;
          shift += 7;
        }

        if (buffer.length - offset < packetLen) return; // wait for full packet
        if (offset >= buffer.length) return;

        // Packet ID
        const packetId = buffer[offset++];
        if (packetId !== 0) return;

        // String length
        let strLen = 0;
        shift = 0;
        while (offset < buffer.length) {
          const b = buffer[offset++];
          strLen |= (b & 0x7f) << shift;
          if ((b & 0x80) === 0) break;
          shift += 7;
        }

        if (offset + strLen > buffer.length) return;
        const jsonStr = buffer.subarray(offset, offset + strLen).toString("utf8");
        const json = JSON.parse(jsonStr);

        const latencyMs = Date.now() - startTime;
        const motd =
          typeof json.description === "string"
            ? json.description
            : json.description?.text || JSON.stringify(json.description || "");

        const playerNames: string[] = [];
        if (Array.isArray(json.players?.sample)) {
          for (const s of json.players.sample) {
            if (s && typeof s.name === "string") playerNames.push(s.name);
          }
        }

        finish({
          online: true,
          version: json.version?.name || null,
          playersOnline: json.players?.online ?? 0,
          playersMax: json.players?.max ?? 0,
          latencyMs,
          motd,
          playerNames,
        });
      } catch {
        // wait for more data or parse error
      }
    });
  });
}

export async function recordMinecraftEvent(event: {
  type: string;
  source?: string;
  playerName?: string;
  message?: string;
  data?: Record<string, unknown>;
}) {
  const { type, source = "minecraft", playerName, message, data = {} } = event;
  const createdAt = new Date().toISOString();

  // Store in DB
  try {
    await q(
      `insert into server_events (type, source, player_name, message, data, created_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [type, source, playerName || null, message || null, JSON.stringify(data), createdAt],
    );
  } catch {
    // fallback
  }

  // Memory fallback
  memDb.server_events.unshift({
    id: Date.now(),
    type,
    source,
    player_name: playerName || null,
    message: message || null,
    data,
    created_at: createdAt,
  });
  if (memDb.server_events.length > 200) memDb.server_events.pop();

  // Update specific tables
  if (playerName) {
    const pNameLower = playerName.toLowerCase();
    const existing = memDb.players.get(pNameLower);

    if (type === "player_join") {
      const updated = {
        username: playerName,
        online: true,
        first_seen: existing?.first_seen || createdAt,
        last_seen: createdAt,
        playtime_seconds: existing?.playtime_seconds || 0,
        permission_level: existing?.permission_level || "player",
        joins: (existing?.joins || 0) + 1,
        deaths: existing?.deaths || 0,
        head_url: `https://mc-heads.net/avatar/${encodeURIComponent(playerName)}/64`,
      };
      memDb.players.set(pNameLower, updated);

      try {
        await q(
          `insert into players (username, first_seen, last_seen, joins, head_url)
           values ($1, $2, $3, 1, $4)
           on conflict (username) do update set
             last_seen = excluded.last_seen,
             joins = players.joins + 1,
             updated_at = now()`,
          [playerName, createdAt, createdAt, updated.head_url],
        );
      } catch {
        // non-fatal
      }
    } else if (type === "player_leave") {
      if (existing) {
        existing.online = false;
        existing.last_seen = createdAt;
      }
    } else if (type === "player_death") {
      if (existing) {
        existing.deaths = (existing.deaths || 0) + 1;
      }
    }
  }

  if (type === "grave_created" && data) {
    const graveKey = (data.graveKey as string) || `grave-${Date.now()}`;
    const x = Number(data.x) || 0;
    const y = Number(data.y) || 64;
    const z = Number(data.z) || 0;
    const dimension = String(data.dimension || "minecraft:overworld");
    const despawnMinutes = Number(data.despawnMinutes) || 60;
    const despawnAt = new Date(Date.now() + despawnMinutes * 60 * 1000).toISOString();

    const graveRecord = {
      id: Date.now(),
      grave_key: graveKey,
      player_name: playerName || "Steve",
      x,
      y,
      z,
      dimension,
      death_time: createdAt,
      despawn_at: despawnAt,
      status: "active",
      inventory: data.inventory || null,
      created_at: createdAt,
    };

    memDb.graves.unshift(graveRecord);
    try {
      await q(
        `insert into graves (grave_key, player_name, x, y, z, dimension, death_time, despawn_at, status, inventory)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9)`,
        [graveKey, playerName || "Steve", x, y, z, dimension, createdAt, despawnAt, JSON.stringify(data.inventory || null)],
      );
    } catch {
      // non-fatal
    }
  } else if (type === "grave_removed" && data?.graveKey) {
    const key = String(data.graveKey);
    const gr = memDb.graves.find((g) => g.grave_key === key);
    if (gr) gr.status = "recovered";

    try {
      await q(`update graves set status = 'recovered', updated_at = now() where grave_key = $1`, [key]);
    } catch {
      // non-fatal
    }
  }

  if (type === "chat_message" && playerName && message) {
    memDb.chat_messages.unshift({
      id: Date.now(),
      player_name: playerName,
      message,
      created_at: createdAt,
    });
    if (memDb.chat_messages.length > 200) memDb.chat_messages.pop();

    try {
      await q(`insert into chat_messages (player_name, message, created_at) values ($1, $2, $3)`, [
        playerName,
        message,
        createdAt,
      ]);
    } catch {
      // non-fatal
    }
  }

  // Broadcast to realtime SSE connections
  broadcastEvent("event", {
    type,
    playerName,
    message,
    data,
    createdAt,
  });

  // Queue Discord notification
  void queueDiscordNotification(type, {
    playerName,
    message,
    data,
  });
}
