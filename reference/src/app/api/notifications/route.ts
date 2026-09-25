import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireCsrf, handleRouteError } from "@/lib/api";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAuth(req);
    if (!guard.ok) return guard.res;
    const res = await q<{
      id: number;
      type: string;
      title: string;
      body: string | null;
      read: boolean;
      created_at: Date;
    }>(
      `select id, type, title, body, read, created_at from notifications
       where user_id is null or user_id = $1
       order by created_at desc limit 30`,
      [guard.ctx.user.id],
    );
    return NextResponse.json({ ok: true, notifications: res.rows });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = await requireAuth(req);
    if (!guard.ok) return guard.res;
    const csrf = await requireCsrf(req, guard.ctx);
    if (!csrf.ok) return csrf.res;
    await q(`update notifications set read = true where user_id = $1 or user_id is null`, [
      guard.ctx.user.id,
    ]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
