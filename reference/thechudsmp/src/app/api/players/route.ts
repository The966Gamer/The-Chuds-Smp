import { NextRequest, NextResponse } from "next/server";
import { requirePermission, handleRouteError, jsonError } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { q } from "@/lib/db";
import { resolveHeads } from "@/lib/heads";
import { getPlayersOnline, listServerPlayers } from "@/lib/falix";
import { getConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const guard = await requirePermission(req, "view_players");
    if (!guard.ok) return guard.res;
    if (!(await getSettings()).features.players) {
      return jsonError(404, "feature_disabled", "This section has been disabled by an administrator");
    }

    const search = (req.nextUrl.searchParams.get("search") ?? "").trim().slice(0, 40);
    const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1) || 1);
    const pageSize = Math.min(50, Math.max(10, Number(req.nextUrl.searchParams.get("pageSize") ?? 25) || 25));

    const params: unknown[] = [];
    let where = "";
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      where = `where username like $${params.length}`;
    }

    const countRes = await q<{ count: string }>(
      `select count(*)::text as count from players ${where}`,
      params,
    );
    const total = Number(countRes.rows[0]?.count ?? 0);

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
       from players ${where}
       order by last_seen desc nulls last
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    // Online state from the Falix watchdog snapshot.
    const config = getConfig();
    const onlineNames = new Set<string>();
    try {
      const online = await getPlayersOnline(config.FALIX_SERVER_ID);
      for (const n of online.playerNames) onlineNames.add(n.toLowerCase());
    } catch {
      // server offline or scope missing; online state stays false
    }

    // Sync real player data (uuid, op status, last-seen) from the Falix
    // player list (documented endpoint, backed by usercache/playerdata).
    // Failure here is non-fatal: the panel's own records remain authoritative
    // for anything the API cannot provide right now.
    const uuidHints: Record<string, string | null> = {};
    try {
      const remote = await listServerPlayers(config.FALIX_SERVER_ID, {
        limit: 100,
        search: search || undefined,
      });
      for (const rp of remote.players) {
        const lowerName = rp.name.toLowerCase();
        uuidHints[rp.name] = rp.uuid;
        await q(
          `insert into players (username, uuid, permission_level, first_seen, last_seen)
           values ($1, $2, $3, now(), coalesce($4, now()))
           on conflict (username) do update set
             uuid = coalesce(excluded.uuid, players.uuid),
             permission_level = case
               when excluded.permission_level <> 'player' then excluded.permission_level
               else players.permission_level end,
             last_seen = coalesce($4, players.last_seen),
             updated_at = now()`,
          [
            lowerName,
            rp.uuid,
            rp.isOp ? "admin" : "player",
            rp.lastSeen ? new Date(rp.lastSeen) : null,
          ],
        ).catch(() => undefined);
      }
    } catch {
      // Falix players endpoint unavailable (scope/offline) — keep DB data.
    }

    // Resolve missing heads (cached in DB), passing real UUIDs when known.
    const missing = res.rows.filter((r) => !r.head_url).map((r) => r.username);
    const heads = missing.length > 0
      ? await resolveHeads(missing, uuidHints).catch(() => ({}) as Record<string, string | null>)
      : {};

    const players = res.rows.map((r) => ({
      username: r.username,
      uuid: r.uuid,
      headUrl: r.head_url ?? heads[r.username] ?? null,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      playtimeSeconds: Number(r.playtime_seconds ?? 0),
      permissionLevel: r.permission_level,
      joins: r.joins,
      deaths: r.deaths,
      online: onlineNames.has(r.username.toLowerCase()),
    }));

    return NextResponse.json({ ok: true, players, total, page, pageSize });
  } catch (e) {
    return handleRouteError(e);
  }
}
