import { NextRequest, NextResponse } from "next/server";
import { requirePermission, requireCsrf, readJson, handleRouteError, jsonError } from "@/lib/api";
import { obj, str } from "@/lib/validate";
import { getBotToken, setBotToken } from "@/lib/rconService";
import { isDiscordBotRunning, ensureDiscordBot } from "@/lib/discordBot";
import { audit } from "@/lib/audit";
import { maskSecret } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: bot status + masked token. */
export async function GET(req: NextRequest) {
  try {
    const guard = await requirePermission(req, "manage_discord");
    if (!guard.ok) return guard.res;
    const token = await getBotToken();
    return NextResponse.json({
      ok: true,
      configured: Boolean(token),
      maskedToken: token ? maskSecret(token) : null,
      botRunning: isDiscordBotRunning(),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** Admin: save or remove the bot token (removal disconnects at next boot). */
export async function POST(req: NextRequest) {
  try {
    const guard = await requirePermission(req, "manage_discord");
    if (!guard.ok) return guard.res;
    const csrf = await requireCsrf(req, guard.ctx);
    if (!csrf.ok) return csrf.res;

    const body = obj(await readJson(req));
    if (body.token === "" || body.token === null) {
      await setBotToken(null);
      await audit(guard.ctx, "discord.bot.remove", "bot_token");
      return NextResponse.json({ ok: true, removed: true, botRunning: isDiscordBotRunning() });
    }
    const token = str(body, "token", { min: 20, max: 200 });
    await setBotToken(token);
    await audit(guard.ctx, "discord.bot.save", "bot_token");
    ensureDiscordBot(); // connect immediately without a server restart
    return NextResponse.json({ ok: true, configured: true, botRunning: isDiscordBotRunning() });
  } catch (e) {
    if (e instanceof Error && /bot token/i.test(e.message)) {
      return jsonError(400, "bad_request", e.message);
    }
    return handleRouteError(e);
  }
}
