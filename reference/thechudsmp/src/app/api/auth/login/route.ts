import { NextRequest, NextResponse } from "next/server";
import { obj, str } from "@/lib/validate";
import { readJson, handleRouteError, jsonError, clientIp, rateLimit, rateLimitResponse } from "@/lib/api";
import { q } from "@/lib/db";
import {
  verifyPassword,
  createSession,
  SESSION_COOKIE,
  sessionCookieOptions,
  recentFailures,
  recordLoginAttempt,
} from "@/lib/auth";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // Pre-setup guard: the users/login_attempts tables do not exist yet.
    const { isSeeded } = await import("@/lib/seed");
    if (!(await isSeeded().catch(() => false))) {
      return jsonError(503, "not_seeded", "Panel setup has not been completed yet");
    }
    const ip = clientIp(req);
    const rl = rateLimit(`login:${ip}`, 10, 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    const body = obj(await readJson(req));
    const username = str(body, "username", { min: 3, max: 20 }).toLowerCase();
    const password = str(body, "password", { min: 1, max: 200 });

    const failures = await recentFailures(username, ip);
    if (failures >= 10) {
      return jsonError(429, "rate_limited", "Too many failed attempts. Try again in 15 minutes.");
    }

    const res = await q<{ id: string; password_hash: string }>(
      `select id, password_hash from users where username = $1 limit 1`,
      [username],
    );
    const user = res.rows[0];
    const valid = user ? await verifyPassword(user.password_hash, password) : false;

    if (!user || !valid) {
      await recordLoginAttempt(username, ip, false);
      // Uniform error: do not reveal whether the account exists.
      return jsonError(401, "invalid_credentials", "Invalid username or password");
    }

    await recordLoginAttempt(username, ip, true);
    const store = await cookies();
    const { token, csrf, expiresAt } = await createSession(user.id, {
      ip,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    store.set(SESSION_COOKIE, token, sessionCookieOptions(maxAge));
    store.set("panel_csrf", csrf, {
      ...sessionCookieOptions(maxAge),
      httpOnly: true,
    });
    return NextResponse.json({ ok: true, csrfToken: csrf });
  } catch (e) {
    return handleRouteError(e);
  }
}
