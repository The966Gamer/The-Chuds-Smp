import { NextRequest, NextResponse } from "next/server";
import { requirePermission, requireCsrf, readJson, handleRouteError, jsonError } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { obj, str, optionalStr } from "@/lib/validate";
import {
  getWebhookUrl,
  setWebhookUrl,
  getEnabledEvents,
  setEnabledEvents,
  processDiscordQueue,
  DISCORD_EVENTS,
} from "@/lib/discord";
import { q } from "@/lib/db";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function maskWebhook(url: string): string {
  // Show the id, never the token.
  const m = url.match(/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/(\d+)\//);
  return m ? `${m[1]}/api/webhooks/${m[2]}/••••••` : "configured";
}

export async function GET(req: NextRequest) {
  try {
    const guard = await requirePermission(req, "manage_discord");
    if (!guard.ok) return guard.res;
    if (!(await getSettings()).features.discord) {
      return jsonError(404, "feature_disabled", "This section has been disabled by an administrator");
    }

    const url = await getWebhookUrl();
    const events = await getEnabledEvents();
    const recent = await q<{
      id: number;
      event_type: string;
      status: string;
      error: string | null;
      created_at: Date;
      sent_at: Date | null;
    }>(
      `select id, event_type, status, error, created_at, sent_at from discord_events
       order by id desc limit 20`,
    );
    return NextResponse.json({
      ok: true,
      configured: Boolean(url),
      maskedUrl: url ? maskWebhook(url) : null,
      enabledEvents: events,
      supportedEvents: DISCORD_EVENTS,
      recent: recent.rows,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const guard = await requirePermission(req, "manage_discord");
    if (!guard.ok) return guard.res;
    const csrf = await requireCsrf(req, guard.ctx);
    if (!csrf.ok) return csrf.res;

    const body = obj(await readJson(req));
    const webhookUrl = optionalStr(body, "webhookUrl", { max: 400 });
    const events = Array.isArray(body.events) ? (body.events as unknown[]).filter((x): x is string => typeof x === "string") : null;

    if (webhookUrl !== undefined) {
      try {
        await setWebhookUrl(webhookUrl || null);
      } catch (e) {
        return NextResponse.json(
          { error: { code: "bad_request", message: e instanceof Error ? e.message : "Invalid webhook URL" } },
          { status: 400 },
        );
      }
    }
    if (events) {
      await setEnabledEvents(events);
    }
    await audit(guard.ctx, "discord.update", "discord", { events: events ?? undefined, webhookSet: webhookUrl !== undefined });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = await requirePermission(req, "manage_discord");
    if (!guard.ok) return guard.res;
    const csrf = await requireCsrf(req, guard.ctx);
    if (!csrf.ok) return csrf.res;

    // Process the queue now (sends pending events + honors toggles).
    const result = await processDiscordQueue(25);
    await audit(guard.ctx, "discord.test", "discord", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return handleRouteError(e);
  }
}
