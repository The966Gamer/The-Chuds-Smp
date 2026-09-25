import { NextRequest, NextResponse } from "next/server";
import { requirePermission, handleRouteError, jsonError } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { q } from "@/lib/db";
import { resolveHeads } from "@/lib/heads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPE_GROUPS: Record<string, string[]> = {
  joins: ["player_join"],
  leaves: ["player_leave"],
  deaths: ["player_death"],
  graves: ["grave_created", "grave_removed"],
  chat: ["chat_message"],
  server: ["server_start", "server_stop", "server_restart", "server_crash", "server_event"],
  admin: ["admin_action"],
};

export async function GET(req: NextRequest) {
  try {
    const guard = await requirePermission(req, "view_activity");
    if (!guard.ok) return guard.res;
    if (!(await getSettings()).features.activity) {
      return jsonError(404, "feature_disabled", "This section has been disabled by an administrator");
    }

    const filter = req.nextUrl.searchParams.get("filter") ?? "all";
    const before = Number(req.nextUrl.searchParams.get("before") ?? 0) || 0;
    const limit = Math.min(100, Math.max(10, Number(req.nextUrl.searchParams.get("limit") ?? 40) || 40));

    const params: unknown[] = [];
    let where = "";
    if (filter !== "all" && TYPE_GROUPS[filter]) {
      const types = TYPE_GROUPS[filter];
      params.push(types);
      where = `where type = any($${params.length})`;
    }
    if (before > 0) {
      params.push(before);
      where = where ? `${where} and id < $${params.length}` : `where id < $${params.length}`;
    }
    params.push(limit);

    const res = await q<{
      id: number;
      type: string;
      source: string;
      player_name: string | null;
      message: string | null;
      data: Record<string, unknown>;
      created_at: Date;
    }>(
      `select id, type, source, player_name, message, data, created_at from server_events ${where}
       order by id desc limit $${params.length}`,
      params,
    );

    const names = [...new Set(res.rows.map((r) => r.player_name).filter((n): n is string => Boolean(n)))];
    const heads = names.length > 0
      ? await resolveHeads(names).catch(() => ({}) as Record<string, string | null>)
      : {};

    const events = res.rows.map((r) => ({
      id: r.id,
      type: r.type,
      source: r.source,
      playerName: r.player_name,
      message: r.message,
      data: r.data,
      createdAt: r.created_at,
      headUrl: r.player_name ? (heads[r.player_name] ?? null) : null,
    }));

    return NextResponse.json({ ok: true, events, hasMore: res.rows.length === limit });
  } catch (e) {
    return handleRouteError(e);
  }
}
