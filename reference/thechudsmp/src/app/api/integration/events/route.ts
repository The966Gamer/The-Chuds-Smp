import { NextRequest, NextResponse } from "next/server";
import { obj, str, optionalStr, optionalInt, ValidationError } from "@/lib/validate";
import { readJson, handleRouteError, jsonError, clientIp, rateLimit, rateLimitResponse } from "@/lib/api";
import { getConfig, maskSecret } from "@/lib/config";
import { q } from "@/lib/db";
import { resolveHead } from "@/lib/heads";
import {
  insertEvent,
  upsertPlayer,
  recordChat,
  upsertGrave,
  updateStatistics,
  queueDiscordEvent,
  createNotificationsForEvent,
  markIntegrationHeartbeat,
  type IntegrationEventInput,
} from "@/lib/events";
import { processDiscordQueue } from "@/lib/discord";
import { publish } from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES = [
  "player_join",
  "player_leave",
  "player_death",
  "grave_created",
  "grave_removed",
  "chat_message",
  "player_statistics",
  "server_event",
  "server_start",
  "server_stop",
  "server_restart",
  "server_crash",
] as const;

type ValidType = (typeof VALID_TYPES)[number];

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const rl = rateLimit(`integration:${ip}`, 600, 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    const config = getConfig();
    if (!config.INTEGRATION_SECRET_KEY) {
      return jsonError(503, "integration_not_configured", "Integration secret is not configured");
    }
    const provided = req.headers.get("x-integration-key") ?? "";
    if (provided !== config.INTEGRATION_SECRET_KEY) {
      console.warn(
        `[integration] rejected event from ${ip} (key ${maskSecret(provided)})`,
      );
      return jsonError(401, "unauthorized", "Invalid integration key");
    }

    const body = obj(await readJson(req));
    const eventsRaw = Array.isArray(body.events) ? body.events : [body];
    const accepted: string[] = [];

    for (const raw of eventsRaw.slice(0, 100)) {
      const e = obj(raw);
      const type = str(e, "type", { max: 40 }) as ValidType;
      if (!(VALID_TYPES as readonly string[]).includes(type)) {
        throw new ValidationError(`Unknown event type: ${type}`, "type");
      }
      const playerName = optionalStr(e, "playerName", { max: 20 });
      const message = optionalStr(e, "message", { max: 500 });
      const data = (e.data && typeof e.data === "object"
        ? (e.data as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      const occurredAt = optionalStr(e, "occurredAt", { max: 60 });

      const input: IntegrationEventInput = { type, playerName, message, data, occurredAt };

      // Update derived tables first.
      if (type === "player_join" || type === "player_leave") {
        if (!playerName) throw new ValidationError(`${type} requires playerName`, "playerName");
        const uuid = typeof data.uuid === "string" && data.uuid ? data.uuid : null;
        await upsertPlayer(playerName, uuid);
        // Store the relayed UUID immediately so head resolution can use real
        // game data on the very first render, without guessable name lookups.
        if (uuid) {
          await q(
            `update players set uuid = $2, updated_at = now() where username = $1 and (uuid is null or uuid <> $2)`,
            [playerName.toLowerCase(), uuid],
          ).catch(() => undefined);
        }
      }

      if (type === "chat_message") {
        if (!playerName || !message) {
          throw new ValidationError("chat_message requires playerName and message", "message");
        }
        await recordChat(playerName, message);
      }

      if (type === "grave_created") {
        const graveKey = str(data, "graveKey", { max: 120 });
        const x = optionalInt(data, "x");
        const y = optionalInt(data, "y");
        const z = optionalInt(data, "z");
        if (!playerName || x === undefined || y === undefined || z === undefined) {
          throw new ValidationError("grave_created requires playerName, x, y, z", "data");
        }
        await upsertGrave({
          graveKey,
          playerName,
          x,
          y,
          z,
          dimension: typeof data.dimension === "string" ? data.dimension : "overworld",
          deathTime: typeof data.deathTime === "string" ? data.deathTime : undefined,
          despawnAt: typeof data.despawnAt === "string" ? data.despawnAt : undefined,
          status: typeof data.status === "string" ? data.status : undefined,
          inventory: data.inventory,
        });
      }

      if (type === "grave_removed") {
        const graveKey = str(data, "graveKey", { max: 120 });
        const status = typeof data.status === "string" ? data.status : "recovered";
        await q(
          `update graves set status = $2, updated_at = now() where grave_key = $1`,
          [graveKey, status],
        );
      }

      if (type === "player_statistics") {
        if (!playerName) throw new ValidationError("player_statistics requires playerName", "playerName");
        const stats = obj(data.stats ?? {});
        const clean: Record<string, number> = {};
        for (const [k, v] of Object.entries(stats)) {
          if (typeof v === "number" && Number.isFinite(v)) clean[k.slice(0, 120)] = v;
        }
        await updateStatistics(playerName, clean);
      }

      const eventId = await insertEvent(input);
      await createNotificationsForEvent(input, eventId);
      await queueDiscordEvent(type, { playerName, message, ...data });
      // Fast-path delivery: flush the Discord queue immediately instead of
      // waiting up to 30s for the background worker (and keep working on
      // serverless hosts where no persistent worker survives).
      void processDiscordQueue(5).catch(() => undefined);
      await markIntegrationHeartbeat({ ip, lastType: type });

      if (playerName) {
        const uuidHint = typeof data.uuid === "string" && data.uuid ? data.uuid : undefined;
        await resolveHead(playerName, uuidHint).catch(() => undefined);
      }

      accepted.push(type);
      publish("event", { id: eventId, type, playerName, message, at: Date.now() });
    }

    return NextResponse.json({ ok: true, accepted: accepted.length });
  } catch (e) {
    if (e instanceof ValidationError) {
      return jsonError(400, "bad_request", e.message, { field: e.field });
    }
    return handleRouteError(e);
  }
}
