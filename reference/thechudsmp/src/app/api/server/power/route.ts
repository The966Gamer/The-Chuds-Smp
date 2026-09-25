import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireCsrf, readJson, handleRouteError, clientIp, rateLimit, rateLimitResponse, jsonError } from "@/lib/api";
import { obj, enumOf } from "@/lib/validate";
import { getConfig } from "@/lib/config";
import { sendPowerSignal, type FalixPowerSignal } from "@/lib/falix";
import { audit } from "@/lib/audit";
import { insertEvent } from "@/lib/events";
import { effectivePowerScope, scopeAllows } from "@/lib/power";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // The per-user power scope (not the panel role) is the single authority
    // here: 'full' = all signals, 'start' = start only, 'none' = nothing.
    const guard = await requireAuth(req);
    if (!guard.ok) return guard.res;
    const csrf = await requireCsrf(req, guard.ctx);
    if (!csrf.ok) return csrf.res;

    const ip = clientIp(req);
    const rl = rateLimit(`power:${guard.ctx.user.id}`, 12, 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    const body = obj(await readJson(req));
    const signal = enumOf<FalixPowerSignal>(body, "signal", ["start", "stop", "restart", "kill"]);

    const scopeRes = await q<{ power_scope: string }>(
      `select power_scope from users where id = $1 limit 1`,
      [guard.ctx.user.id],
    );
    const scope = effectivePowerScope(guard.ctx.user.role, scopeRes.rows[0]?.power_scope);
    if (!scopeAllows(scope, signal)) {
      return jsonError(
        403,
        "power_forbidden",
        scope === "start" && signal !== "start"
          ? "Your account may start the server but not stop or restart it"
          : "Your account has no server power permissions",
      );
    }

    const config = getConfig();
    const result = await sendPowerSignal(config.FALIX_SERVER_ID, signal);

    await audit(guard.ctx, `server.${signal}`, config.FALIX_SERVER_ID, { state: result.state }, ip);
    await insertEvent({
      type:
        signal === "start"
          ? "server_start"
          : signal === "stop"
            ? "server_stop"
            : signal === "restart"
              ? "server_restart"
              : "server_event",
      message: `${signal} issued by ${guard.ctx.user.usernameDisplay} via panel (state: ${result.state})`,
      data: { via: "panel", signal, state: result.state },
    }).catch(() => undefined);

    return NextResponse.json({ ok: true, signal: result.signal, state: result.state });
  } catch (e) {
    return handleRouteError(e);
  }
}
