import { NextRequest, NextResponse } from "next/server";
import { requirePermission, handleRouteError, jsonError } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { q } from "@/lib/db";
import { hasPermission } from "@/lib/auth";
import { resolveHead } from "@/lib/heads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const guard = await requirePermission(req, "view_statistics_self");
    if (!guard.ok) return guard.res;
    if (!(await getSettings()).features.statistics) {
      return jsonError(404, "feature_disabled", "This section has been disabled by an administrator");
    }

    const requested = req.nextUrl.searchParams.get("player");
    const canViewOthers = hasPermission(guard.ctx.user.role, "view_statistics_others");
    let playerName: string | null = guard.ctx.user.mcUsername ?? guard.ctx.user.usernameDisplay;

    if (requested && canViewOthers) {
      playerName = requested.slice(0, 20);
    }

    if (!playerName) {
      return NextResponse.json({
        ok: true,
        unavailable: true,
        reason:
          "No Minecraft username is linked to your panel account yet. Log into the Minecraft server once, then refresh.",
        statistics: [],
        history: [],
      });
    }

    const stats = await q<{ key: string; value: string; updated_at: Date }>(
      `select key, value::text as value, updated_at from player_statistics
       where player_name = $1 order by value desc limit 200`,
      [playerName.toLowerCase()],
    );

    const history = await q<{ key: string; value: string; recorded_at: Date }>(
      `select key, value::text as value, recorded_at from player_stat_history
       where player_name = $1 order by recorded_at desc limit 500`,
      [playerName.toLowerCase()],
    );

    const headUrl = await resolveHead(playerName).catch(() => null);

    return NextResponse.json({
      ok: true,
      unavailable: stats.rows.length === 0,
      reason:
        stats.rows.length === 0
          ? "No statistics have been reported for this player yet. The Minecraft integration sends statistics when you play."
          : null,
      player: playerName,
      headUrl,
      statistics: stats.rows.map((s) => ({ key: s.key, value: Number(s.value), updatedAt: s.updated_at })),
      history: history.rows.map((h) => ({ key: h.key, value: Number(h.value), at: h.recorded_at })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
