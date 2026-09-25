import { NextRequest, NextResponse } from "next/server";
import { requirePermission, requireCsrf, readJson, handleRouteError, jsonError } from "@/lib/api";
import { obj, bool, int } from "@/lib/validate";
import { getSettings, saveFeatures, saveGraveSettings, FEATURES, type FeatureId, type GraveSettings } from "@/lib/settings";
import { getDiscordNameMapping, saveDiscordNameMapping } from "@/lib/discord";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: read current feature toggles + grave mod settings. */
export async function GET(req: NextRequest) {
  try {
    const guard = await requirePermission(req, "manage_settings");
    if (!guard.ok) return guard.res;
    const settings = await getSettings();
    const discordNames = await getDiscordNameMapping();
    return NextResponse.json({ ok: true, features: settings.features, grave: settings.graves, discordNames });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** Admin: save feature toggles, grave mod settings and/or Discord name pings. */
export async function POST(req: NextRequest) {
  try {
    const guard = await requirePermission(req, "manage_settings");
    if (!guard.ok) return guard.res;
    const csrf = await requireCsrf(req, guard.ctx);
    if (!csrf.ok) return csrf.res;

    const body = obj(await readJson(req));
    let featuresTouched = false;
    let gravesTouched = false;
    let namesTouched = false;

    if (body.discordNames !== undefined) {
      const raw = obj(body.discordNames);
      const patch: Record<string, string> = {};
      for (const [mcName, mention] of Object.entries(raw)) {
        if (typeof mention !== "string") continue;
        // Accept <@id>/<@!id> mentions, raw numeric Discord user IDs, or an
        // empty string to delete the mapping.
        if (/^(<@!?[0-9]{5,25}>|[0-9]{5,25})?$/.test(mention.trim())) {
          patch[mcName] = mention.trim();
        }
      }
      await saveDiscordNameMapping(patch);
      namesTouched = true;
    }

    if (body.features !== undefined) {
      const raw = obj(body.features);
      const clean: Partial<Record<FeatureId, boolean>> = {};
      for (const id of FEATURES) {
        if (raw[id] !== undefined) clean[id] = bool(raw, id, false);
      }
      await saveFeatures(clean);
      featuresTouched = true;
    }

    if (body.grave !== undefined) {
      const g = obj(body.grave);
      const patch: Partial<GraveSettings> = {};
      if (g.despawnMinutes !== undefined) patch.despawnMinutes = int(g, "despawnMinutes", { min: 5, max: 10_080 });
      if (g.protection !== undefined) patch.protection = bool(g, "protection");
      await saveGraveSettings(patch);
      gravesTouched = true;
    }

    if (!featuresTouched && !gravesTouched && !namesTouched) {
      return jsonError(400, "bad_request", "Nothing to save — send 'features', 'grave' and/or 'discordNames'");
    }

    await audit(guard.ctx, "settings.save", guard.ctx.user.usernameDisplay, { featuresTouched, gravesTouched, namesTouched });
    const settings = await getSettings();
    const discordNames = await getDiscordNameMapping();
    return NextResponse.json({ ok: true, features: settings.features, grave: settings.graves, discordNames });
  } catch (e) {
    return handleRouteError(e);
  }
}
