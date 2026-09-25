import { NextRequest, NextResponse } from "next/server";
import { requirePermission, requireCsrf, readJson, handleRouteError } from "@/lib/api";
import { obj, str, enumOf, ValidationError } from "@/lib/validate";
import { q } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create a panel user (admin only). Username + password + role. */
export async function POST(req: NextRequest) {
  try {
    const guard = await requirePermission(req, "manage_permissions");
    if (!guard.ok) return guard.res;
    const csrf = await requireCsrf(req, guard.ctx);
    if (!csrf.ok) return csrf.res;

    const body = obj(await readJson(req));
    const username = str(body, "username", { min: 3, max: 20 });
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      throw new ValidationError("Username may only contain letters, numbers and underscores", "username");
    }
    const password = str(body, "password", { min: 10, max: 200 });
    const role = enumOf(body, "role", ["player", "moderator", "admin"]);
    const mcUsername = str(body, "mcUsername", { min: 2, max: 20 });

    const passwordHash = await hashPassword(password);
    const res = await q<{ id: string }>(
      `insert into users (username, username_display, password_hash, role, mc_username)
       values ($1, $1, $2, $3, $4)
       returning id`,
      [username.toLowerCase(), passwordHash, role, mcUsername],
    ).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate key|unique constraint/i.test(msg)) {
        throw new ValidationError("That username already exists", "username");
      }
      throw e;
    });

    await audit(guard.ctx, "user.create", username.toLowerCase(), { role });
    return NextResponse.json({ ok: true, id: res.rows[0]?.id });
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json(
        { error: { code: "bad_request", message: e.message, field: e.field } },
        { status: 400 },
      );
    }
    return handleRouteError(e);
  }
}
