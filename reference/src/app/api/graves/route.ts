import { NextRequest, NextResponse } from "next/server";
import { requirePermission, handleRouteError, jsonError } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { q } from "@/lib/db";
import { resolveHeads } from "@/lib/heads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const guard = await requirePermission(req, "view_graves");
    if (!guard.ok) return guard.res;
    if (!(await getSettings()).features.graves) {
      return jsonError(404, "feature_disabled", "This section has been disabled by an administrator");
    }

    const status = req.nextUrl.searchParams.get("status");
    const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1) || 1);
    const pageSize = Math.min(50, Math.max(10, Number(req.nextUrl.searchParams.get("pageSize") ?? 25) || 25));

    const params: unknown[] = [];
    let where = "";
    if (status && ["active", "recovered", "despawned", "expired"].includes(status)) {
      params.push(status);
      where = `where status = $${params.length}`;
    }

    const countRes = await q<{ count: string }>(`select count(*)::text as count from graves ${where}`, params);
    const total = Number(countRes.rows[0]?.count ?? 0);

    const res = await q<{
      id: number;
      grave_key: string;
      player_name: string;
      x: number;
      y: number;
      z: number;
      dimension: string;
      death_time: Date;
      despawn_at: Date | null;
      status: string;
    }>(
      `select id, grave_key, player_name, x, y, z, dimension, death_time, despawn_at, status
       from graves ${where}
       order by death_time desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    const names = [...new Set(res.rows.map((r) => r.player_name))];
    const heads = names.length > 0
      ? await resolveHeads(names).catch(() => ({}) as Record<string, string | null>)
      : {};

    const now = Date.now();
    const graves = res.rows.map((r) => ({
      id: r.id,
      graveKey: r.grave_key,
      playerName: r.player_name,
      x: r.x,
      y: r.y,
      z: r.z,
      dimension: r.dimension,
      deathTime: r.death_time,
      despawnAt: r.despawn_at,
      remainingMs: r.despawn_at ? Math.max(0, new Date(r.despawn_at).getTime() - now) : null,
      status: r.status,
      headUrl: heads[r.player_name] ?? null,
    }));

    return NextResponse.json({ ok: true, graves, total, page, pageSize });
  } catch (e) {
    return handleRouteError(e);
  }
}
