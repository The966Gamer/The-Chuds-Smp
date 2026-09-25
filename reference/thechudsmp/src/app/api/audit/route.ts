import { NextRequest, NextResponse } from "next/server";
import { requirePermission, handleRouteError } from "@/lib/api";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const guard = await requirePermission(req, "view_audit");
    if (!guard.ok) return guard.res;
    const before = Number(req.nextUrl.searchParams.get("before") ?? 0) || 0;
    const limit = Math.min(100, Math.max(10, Number(req.nextUrl.searchParams.get("limit") ?? 40) || 40));
    const params: unknown[] = [];
    let where = "";
    if (before > 0) {
      params.push(before);
      where = `where id < $${params.length}`;
    }
    params.push(limit);
    const res = await q<{
      id: number;
      username: string | null;
      action: string;
      target: string | null;
      ip: string | null;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>(
      `select id, username, action, target, ip, metadata, created_at from audit_logs ${where}
       order by id desc limit $${params.length}`,
      params,
    );
    return NextResponse.json({ ok: true, entries: res.rows, hasMore: res.rows.length === limit });
  } catch (e) {
    return handleRouteError(e);
  }
}
