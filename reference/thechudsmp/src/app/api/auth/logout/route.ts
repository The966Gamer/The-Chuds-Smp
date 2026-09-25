import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireCsrf, handleRouteError } from "@/lib/api";
import { revokeSession, SESSION_COOKIE } from "@/lib/auth";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const guard = await requireAuth(req);
    if (!guard.ok) return guard.res;
    const csrf = await requireCsrf(req, guard.ctx);
    if (!csrf.ok) return csrf.res;

    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (token) await revokeSession(token);
    store.delete(SESSION_COOKIE);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
