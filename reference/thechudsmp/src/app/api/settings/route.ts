import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireCsrf, requirePermission, readJson, handleRouteError, clientIp } from "@/lib/api";
import { obj, str } from "@/lib/validate";
import { getConfig, maskSecret } from "@/lib/config";
import { q } from "@/lib/db";
import { hashPassword, verifyPassword, revokeAllUserSessions, SESSION_COOKIE } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAuth(req);
    if (!guard.ok) return guard.res;
    const c = getConfig();
    return NextResponse.json({
      ok: true,
      server: {
        falixServerId: c.FALIX_SERVER_ID,
        falixApiBase: c.FALIX_API_BASE,
        minecraftHost: c.MINECRAFT_SERVER_HOST,
        minecraftPort: c.MINECRAFT_SERVER_PORT,
      },
      integration: {
        configured: Boolean(c.INTEGRATION_SECRET_KEY),
        maskedKey: maskSecret(c.INTEGRATION_SECRET_KEY),
      },
      rcon: {
        configured: Boolean(c.RCON_PORT && c.RCON_PASSWORD),
        port: c.RCON_PORT || null,
      },
      secrets: {
        falixKey: maskSecret(c.FALIX_API_KEY),
        supabaseServiceKey: maskSecret(c.SUPABASE_SERVICE_ROLE_KEY),
      },
    });
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

    const body = obj(await readJson(req));
    const action = str(body, "action", { max: 40 });
    const ip = clientIp(req);

    if (action === "change_password") {
      const current = str(body, "currentPassword", { min: 1, max: 200 });
      const next = str(body, "newPassword", { min: 10, max: 200 });
      const res = await q<{ password_hash: string }>(
        `select password_hash from users where id = $1`,
        [guard.ctx.user.id],
      );
      const row = res.rows[0];
      if (!row || !(await verifyPassword(row.password_hash, current))) {
        return NextResponse.json(
          { error: { code: "bad_request", message: "Current password is incorrect" } },
          { status: 400 },
        );
      }
      const newHash = await hashPassword(next);
      await q(`update users set password_hash = $2, updated_at = now() where id = $1`, [
        guard.ctx.user.id,
        newHash,
      ]);
      await revokeAllUserSessions(guard.ctx.user.id);
      await audit(guard.ctx, "account.change_password", guard.ctx.user.usernameDisplay, {}, ip);
      const store = await cookies();
      store.delete(SESSION_COOKIE);
      return NextResponse.json({ ok: true, reauth: true });
    }

    if (action === "revoke_sessions") {
      await revokeAllUserSessions(guard.ctx.user.id);
      await audit(guard.ctx, "account.revoke_sessions", guard.ctx.user.usernameDisplay, {}, ip);
      const store = await cookies();
      store.delete(SESSION_COOKIE);
      return NextResponse.json({ ok: true, reauth: true });
    }

    if (action === "list_sessions") {
      const res = await q<{
        id: string;
        created_at: Date;
        last_seen_at: Date;
        expires_at: Date;
        user_agent: string | null;
        ip: string | null;
      }>(
        `select id, created_at, last_seen_at, expires_at, user_agent, ip from sessions
         where user_id = $1 and revoked_at is null and expires_at > now()
         order by last_seen_at desc`,
        [guard.ctx.user.id],
      );
      return NextResponse.json({ ok: true, sessions: res.rows });
    }

    if (action === "reset_layout") {
      await q(`delete from dashboard_layouts where user_id = $1`, [guard.ctx.user.id]);
      await audit(guard.ctx, "dashboard.reset_layout", guard.ctx.user.usernameDisplay, {}, ip);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: { code: "bad_request", message: "Unknown action" } }, { status: 400 });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PUT(req: NextRequest) {
  // Permission management (admin-only).
  try {
    const guard = await requirePermission(req, "manage_permissions");
    if (!guard.ok) return guard.res;
    const csrf = await requireCsrf(req, guard.ctx);
    if (!csrf.ok) return csrf.res;

    const body = obj(await readJson(req));
    const username = str(body, "username", { min: 3, max: 20 }).toLowerCase();
    const role = str(body, "role", { max: 12 });
    if (!["player", "moderator", "admin"].includes(role)) {
      return NextResponse.json({ error: { code: "bad_request", message: "Invalid role" } }, { status: 400 });
    }
    const res = await q<{ id: string }>(`update users set role = $2, updated_at = now() where username = $1 returning id`, [
      username,
      role,
    ]);
    if (res.rows.length === 0) {
      return NextResponse.json({ error: { code: "not_found", message: "User not found" } }, { status: 404 });
    }
    await audit(guard.ctx, "permissions.set_role", username, { role });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
