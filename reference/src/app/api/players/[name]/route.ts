import { NextRequest, NextResponse } from "next/server";
import { requirePermission, handleRouteError } from "@/lib/api";
import { q } from "@/lib/db";
import { resolveHead } from "@/lib/heads";
import { resolvePlayer } from "@/lib/falix";
import { getConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const guard = await requirePermission(req, "view_players");
    if (!guard.ok) return guard.res;
    const { name } = await params;
    const clean = decodeURIComponent(name).slice(0, 20);

    const res = await q<{
      username: string;
      uuid: string | null;
      head_url: string | null;
      first_seen: Date | null;
      last_seen: Date | null;
      playtime_seconds: string;
      permission_level: string;
      joins: number;
      deaths: number;
    }>(
      `select username, uuid, head_url, first_seen, last_seen, playtime_seconds::text as playtime_seconds,
              permission_level, joins, deaths
       from players where username = $1 limit 1`,
      [clean],
    );
    const player = res.rows[0];
    if (!player) {
      return NextResponse.json({ error: { code: "not_found", message: "Player not found" } }, { status: 404 });
    }

    // Head: prefer cache, then a real UUID (mod-relayed or Falix-resolved).
    let headUrl = player.head_url;
    if (!headUrl) {
      let uuidHint = player.uuid ?? undefined;
      if (!uuidHint) {
        try {
          const resolved = await resolvePlayer(getConfig().FALIX_SERVER_ID, player.username);
          uuidHint = resolved?.uuid;
          if (resolved?.uuid) {
            await q(`update players set uuid = $2, updated_at = now() where username = $1`, [
              clean,
              resolved.uuid,
            ]).catch(() => undefined);
          }
        } catch {
          // resolve unavailable; name-verified fallback still applies
        }
      }
      headUrl = await resolveHead(player.username, uuidHint).catch(() => null);
    }

    const stats = await q<{ key: string; value: string }>(
      `select key, value::text as value from player_statistics where player_name = $1 order by value desc limit 60`,
      [clean],
    );

    const events = await q<{
      id: number;
      type: string;
      message: string | null;
      created_at: Date;
    }>(
      `select id, type, message, created_at from server_events
       where player_name = $1 order by id desc limit 25`,
      [clean],
    );

    const graves = await q<{
      id: number;
      grave_key: string;
      x: number;
      y: number;
      z: number;
      dimension: string;
      death_time: Date;
      status: string;
    }>(
      `select id, grave_key, x, y, z, dimension, death_time, status from graves
       where player_name = $1 order by death_time desc limit 10`,
      [clean],
    );

    return NextResponse.json({
      ok: true,
      player: {
        username: player.username,
        uuid: player.uuid,
        headUrl,
        firstSeen: player.first_seen,
        lastSeen: player.last_seen,
        playtimeSeconds: Number(player.playtime_seconds ?? 0),
        permissionLevel: player.permission_level,
        joins: player.joins,
        deaths: player.deaths,
      },
      statistics: stats.rows.map((s) => ({ key: s.key, value: Number(s.value) })),
      events: events.rows,
      graves: graves.rows,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
