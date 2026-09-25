import { NextRequest, NextResponse } from "next/server";
import { requirePermission, handleRouteError, jsonError } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { q } from "@/lib/db";
import { resolveHeads } from "@/lib/heads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const guard = await requirePermission(req, "view_chat");
    if (!guard.ok) return guard.res;
    if (!(await getSettings()).features.chat) {
      return jsonError(404, "feature_disabled", "This section has been disabled by an administrator");
    }

    const beforeParam = req.nextUrl.searchParams.get("before");
    const before = beforeParam ? Number(beforeParam) : null;
    const limit = Math.min(100, Math.max(10, Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50));

    const params: unknown[] = [];
    let where = "";
    if (before && Number.isFinite(before)) {
      params.push(before);
      where = `where id < $${params.length}`;
    }
    params.push(limit);

    const res = await q<{
      id: number;
      player_name: string;
      message: string;
      created_at: Date;
    }>(
      `select id, player_name, message, created_at from chat_messages ${where}
       order by id desc limit $${params.length}`,
      params,
    );

    const names = [...new Set(res.rows.map((r) => r.player_name))];
    const heads = names.length > 0
      ? await resolveHeads(names).catch(() => ({}) as Record<string, string | null>)
      : {};

    const messages = res.rows.map((r) => ({
      id: r.id,
      playerName: r.player_name,
      message: r.message,
      createdAt: r.created_at,
      headUrl: heads[r.player_name] ?? null,
    }));

    return NextResponse.json({ ok: true, messages, hasMore: res.rows.length === limit });
  } catch (e) {
    return handleRouteError(e);
  }
}
