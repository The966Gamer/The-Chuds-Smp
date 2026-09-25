import { NextRequest, NextResponse } from "next/server";
import { requirePermission, requireCsrf, readJson, handleRouteError, jsonError } from "@/lib/api";
import { obj, str, ValidationError } from "@/lib/validate";
import { q } from "@/lib/db";
import { isPowerScope } from "@/lib/power";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const guard = await requirePermission(req, "manage_permissions");
    if (!guard.ok) return guard.res;
    const res = await q<{
      username: string;
      username_display: string;
      role: string;
      power_scope: string;
      created_at: Date;
    }>(
      `select username, username_display, role, power_scope, created_at from users order by created_at asc limit 100`,
    );
    return NextResponse.json({
      ok: true,
      users: res.rows.map((r) => ({
        username: r.username,
        displayName: r.username_display,
        role: r.role,
        powerScope: r.power_scope,
        createdAt: r.created_at,
      })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** Admin: set a user's per-user server power scope (full / start / none). */
export async function PUT(req: NextRequest) {
  try {
    const guard = await requirePermission(req, "manage_permissions");
    if (!guard.ok) return guard.res;
    const csrf = await requireCsrf(req, guard.ctx);
    if (!csrf.ok) return csrf.res;

    const body = obj(await readJson(req));
    const username = str(body, "username", { min: 3, max: 20 }).toLowerCase();
    if (!isPowerScope(body.powerScope)) {
      throw new ValidationError("powerScope must be one of: full, start, none", "powerScope");
    }

    const res = await q<{ id: string }>(
      `update users set power_scope = $2, updated_at = now() where username = $1 returning id`,
      [username, body.powerScope],
    );
    if (res.rows.length === 0) {
      throw new ValidationError("User not found", "username");
    }

    await audit(guard.ctx, "user.power_scope", username, { scope: body.powerScope });
    return NextResponse.json({ ok: true, username, powerScope: body.powerScope });
  } catch (e) {
    if (e instanceof ValidationError) {
      return jsonError(400, "bad_request", e.message, { field: e.field });
    }
    return handleRouteError(e);
  }
}
