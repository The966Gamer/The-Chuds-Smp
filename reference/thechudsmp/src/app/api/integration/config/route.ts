import { NextRequest, NextResponse } from "next/server";
import { handleRouteError, jsonError, clientIp, rateLimit, rateLimitResponse } from "@/lib/api";
import { getConfig, maskSecret } from "@/lib/config";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runtime configuration for the Minecraft mod, authenticated with the shared
 * integration secret. The mod polls this (GET) to pick up admin changes made
 * in the panel — currently the grave mod settings (despawn timer, protection).
 *
 * The panel URL is echoed back so the mod can verify/repair its target.
 */
export async function GET(req: NextRequest) {
  try {
    const rl = rateLimit(`integration-cfg:${clientIp(req)}`, 120, 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    const config = getConfig();
    if (!config.INTEGRATION_SECRET_KEY) {
      return jsonError(503, "integration_not_configured", "Integration secret is not configured");
    }
    const provided = req.headers.get("x-integration-key") ?? "";
    if (provided !== config.INTEGRATION_SECRET_KEY) {
      return jsonError(401, "unauthorized", "Invalid integration key");
    }

    const settings = await getSettings();
    return NextResponse.json({
      ok: true,
      grave: settings.graves,
      server: {
        panelUrl: new URL(req.url).origin,
        serverId: config.FALIX_SERVER_ID,
        integrationKeyPreview: maskSecret(config.INTEGRATION_SECRET_KEY),
      },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
