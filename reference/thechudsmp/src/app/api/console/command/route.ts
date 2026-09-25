import { NextRequest, NextResponse } from "next/server";
import { requirePermission, requireCsrf, readJson, handleRouteError, clientIp, rateLimit, rateLimitResponse } from "@/lib/api";
import { obj, str } from "@/lib/validate";
import { getConfig } from "@/lib/config";
import { sendCommand } from "@/lib/falix";
import { isRconConfigured, rconSendCommand } from "@/lib/rconService";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DANGEROUS = /^(stop|end|shutdown)$/i;

export async function POST(req: NextRequest) {
  try {
    const guard = await requirePermission(req, "send_command");
    if (!guard.ok) return guard.res;
    const csrf = await requireCsrf(req, guard.ctx);
    if (!csrf.ok) return csrf.res;

    const ip = clientIp(req);
    const rl = rateLimit(`cmd:${guard.ctx.user.id}`, 20, 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    const body = obj(await readJson(req));
    const command = str(body, "command", { min: 1, max: 256 });
    // Single-line guard: newlines would allow stacking commands.
    if (/[\r\n\u0000]/.test(command)) {
      return NextResponse.json(
        { error: { code: "bad_request", message: "Command must be a single line" } },
        { status: 400 },
      );
    }

    // Panel-side stop guard: stopping the server from console is a power action.
    if (DANGEROUS.test(command.trim()) && guard.ctx.user.role !== "admin") {
      return NextResponse.json(
        { error: { code: "forbidden", message: "Stopping the server requires an admin" } },
        { status: 403 },
      );
    }

    const config = getConfig();

    // Transport: RCON when configured (direct to the server, full output),
    // Falix console API as fallback.
    if (isRconConfigured()) {
      const rcon = await rconSendCommand(command);
      if (rcon.ok) {
        await audit(guard.ctx, "console.command", command.slice(0, 120), { transport: "rcon" }, ip);
        return NextResponse.json({ ok: true, accepted: true, transport: "rcon", response: rcon.response.slice(0, 1500) });
      }
      // RCON failed (server offline or wrong port) — fall through to Falix.
      await audit(guard.ctx, "console.command.fallback", command.slice(0, 120), { reason: rcon.error }, ip).catch(() => undefined);
    }

    const result = await sendCommand(config.FALIX_SERVER_ID, command);
    await audit(guard.ctx, "console.command", command.slice(0, 120), { transport: "falix", accepted: result.accepted }, ip);
    return NextResponse.json({ ok: true, accepted: result.accepted, transport: "falix" });
  } catch (e) {
    return handleRouteError(e);
  }
}
