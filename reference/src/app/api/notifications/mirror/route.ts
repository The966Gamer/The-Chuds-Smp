import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireCsrf, readJson, handleRouteError, jsonError } from "@/lib/api";
import { obj, optionalStr, optionalInt, ValidationError } from "@/lib/validate";
import { createNotificationForType, queueDiscordEventQuiet } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mirror an already-shown client notification into the panel bell and the
 * Discord queue. Used by the grave-countdown watcher so its milestones reach
 * Discord (with an @mention) and the bell. The desktop toast itself stays
 * client-side — this route only persists the server-side copies.
 */
export async function POST(req: NextRequest) {
  try {
    const guard = await requireAuth(req);
    if (!guard.ok) return guard.res;
    const csrf = await requireCsrf(req, guard.ctx);
    if (!csrf.ok) return csrf.res;

    const body = obj(await readJson(req));
    const type = optionalStr(body, "type", { max: 40 });
    if (type !== "grave_expiring") {
      return jsonError(400, "bad_request", "Unsupported mirror type");
    }

    const playerName = optionalStr(body, "playerName", { max: 20 });
    const message = optionalStr(body, "message", { max: 500 }) ?? null;
    const minutesLeft = optionalInt(body, "minutesLeft", { min: 1, max: 10_080 }) ?? null;

    // The watcher only fires for the signed-in user's own graves — address the
    // bell row and the Discord ping to them specifically.
    const owner = playerName ?? guard.ctx.user.mcUsername ?? guard.ctx.user.usernameDisplay;
    const payload: Record<string, unknown> = {
      playerName: owner,
      message,
      ...(minutesLeft !== null ? { minutesLeft } : {}),
    };

    await createNotificationForType(type, payload);
    await queueDiscordEventQuiet(type, payload);

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ValidationError) {
      return jsonError(400, "bad_request", e.message, { field: e.field });
    }
    return handleRouteError(e);
  }
}
