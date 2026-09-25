import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireCsrf, readJson, handleRouteError } from "@/lib/api";
import { obj } from "@/lib/validate";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAuth(req);
    if (!guard.ok) return guard.res;
    const res = await q<{ layout: Record<string, unknown> }>(
      `select layout from dashboard_layouts where user_id = $1`,
      [guard.ctx.user.id],
    );
    return NextResponse.json({ ok: true, layout: res.rows[0]?.layout ?? null });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const guard = await requireAuth(req);
    if (!guard.ok) return guard.res;
    const csrf = await requireCsrf(req, guard.ctx);
    if (!csrf.ok) return csrf.res;

    const body = obj(await readJson(req));
    const layout = body.layout;
    if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
      return NextResponse.json({ error: { code: "bad_request", message: "layout must be an object" } }, { status: 400 });
    }
    const serialized = JSON.stringify(layout).slice(0, 50_000);
    await q(
      `insert into dashboard_layouts (user_id, layout) values ($1, $2::jsonb)
       on conflict (user_id) do update set layout = $2::jsonb, updated_at = now()`,
      [guard.ctx.user.id, serialized],
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
