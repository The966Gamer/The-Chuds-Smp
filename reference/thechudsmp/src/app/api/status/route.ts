import { NextRequest, NextResponse } from "next/server";
import { requireAuth, handleRouteError } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { getConsoleStatus, getPlayersOnline, getMinecraftStatus, getServer } from "@/lib/falix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CacheShape {
  at: number;
  value: unknown;
}
const cache = new Map<string, CacheShape>();

async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAuth(req);
    if (!guard.ok) return guard.res;

    const config = getConfig();
    const serverId = config.FALIX_SERVER_ID;

    // Falix control-plane status (authoritative for power state).
    const falix = await cached("falix-status", 8000, () =>
      getConsoleStatus(serverId).catch((e) => ({
        error: e instanceof Error ? e.message : String(e),
      })),
    );

    // Live Minecraft query (authoritative for "can players connect").
    const mc = await cached("mc-status", 10_000, () =>
      config.MINECRAFT_SERVER_HOST
        ? getMinecraftStatus(config.MINECRAFT_SERVER_HOST, Number(config.MINECRAFT_SERVER_PORT) || undefined).catch(
            () => null,
          )
        : Promise.resolve(null),
    );

    const players = await cached("players-online", 8000, () =>
      getPlayersOnline(serverId).catch(() => null),
    );

    const serverInfo = await cached("server-info", 60_000, () =>
      getServer(serverId).catch(() => null),
    );

    const falixErr = (falix as { error?: string }).error;
    return NextResponse.json({
      panelOnline: true,
      falix: falixErr ? { error: falixErr } : falix,
      minecraft: mc,
      players: players ?? { onlinePlayers: 0, playerNames: [], querySucceeded: false },
      server: serverInfo
        ? {
            id: serverInfo.id,
            name: serverInfo.name,
            address: serverInfo.allocation
              ? `${serverInfo.allocation.hostname ?? serverInfo.allocation.ip}:${serverInfo.allocation.port ?? ""}`
              : `${config.MINECRAFT_SERVER_HOST}:${config.MINECRAFT_SERVER_PORT}`,
            software: serverInfo.software ?? null,
            limits: serverInfo.limits ?? null,
          }
        : null,
      config: {
        host: config.MINECRAFT_SERVER_HOST,
        port: config.MINECRAFT_SERVER_PORT,
        serverId: config.FALIX_SERVER_ID,
      },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
