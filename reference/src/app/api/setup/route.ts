import { NextRequest, NextResponse } from "next/server";
import { obj, str, optionalStr, int, ValidationError } from "@/lib/validate";
import { readJson, handleRouteError, jsonError } from "@/lib/api";
import { seedDatabase } from "@/lib/seed";
import { overrideConfig, clearOverride, isConfigured, persistConfig } from "@/lib/config";
import { isSeeded } from "@/lib/seed";
import { getServer } from "@/lib/falix";
import { testDbConnection } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const configured = isConfigured();
  const seeded = configured ? await isSeeded().catch(() => false) : false;
  return NextResponse.json({ configured, seeded, needsSetup: !configured || !seeded });
}

export async function POST(req: NextRequest) {
  try {
    const body = obj(await readJson(req));
    const falix = obj(body.falix);
    const minecraft = obj(body.minecraft);
    const supabase = obj(body.supabase);
    const admin = obj(body.admin);

    const apiBase = str(falix, "apiBase", { max: 300 }).replace(/\/+$/, "");
    const apiKey = str(falix, "apiKey", { max: 300 });
    const serverId = str(falix, "serverId", { max: 40 });
    const host = str(minecraft, "host", { max: 260 });
    const port = str(minecraft, "port", { max: 5, min: 1 });
    int({ port }, "port", { min: 1, max: 65535 });
    const sbUrl = str(supabase, "url", { max: 300 });
    const sbAnon = str(supabase, "anonKey", { max: 600 });
    const sbService = str(supabase, "serviceKey", { max: 600 });
    const sbDbPassword = optionalStr(supabase, "dbPassword", { max: 200 });
    const rconObj = body.rcon ? obj(body.rcon) : {};
    const rconPort = optionalStr(rconObj, "port", { max: 5 });
    const rconPassword = optionalStr(rconObj, "password", { max: 200 });
    const integrationSecret = optionalStr(body, "integrationSecret", { max: 300 });
    const discordWebhook = optionalStr(body, "discordWebhook", { max: 400 });
    if (discordWebhook && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(discordWebhook)) {
      throw new ValidationError(
        "Discord webhook must look like https://discord.com/api/webhooks/<id>/<token>",
        "discordWebhook",
      );
    }
    const adminUsername = str(admin, "username", { min: 3, max: 20 });
    if (!/^[A-Za-z0-9_]{3,20}$/.test(adminUsername)) {
      throw new ValidationError("Admin username may only contain letters, numbers and underscores", "username");
    }
    const adminPassword = str(admin, "password", { min: 10, max: 200 });

    if (!/^https?:\/\//.test(apiBase)) {
      throw new ValidationError("Falix API base must start with http(s)://", "falix.apiBase");
    }
    if (!/^https?:\/\/.+/.test(sbUrl)) {
      throw new ValidationError("Supabase URL must start with https://", "supabase.url");
    }

    // Validate BEFORE persisting: apply a transient override so providers see
    // the candidate values, and roll it back on failure.
    overrideConfig({
      FALIX_API_BASE: apiBase,
      FALIX_API_KEY: apiKey,
      FALIX_SERVER_ID: serverId,
      MINECRAFT_SERVER_HOST: host,
      MINECRAFT_SERVER_PORT: port,
      SUPABASE_URL: sbUrl,
      SUPABASE_ANON_KEY: sbAnon,
      SUPABASE_SERVICE_ROLE_KEY: sbService,
      SUPABASE_DB_PASSWORD: sbDbPassword ?? "",
      RCON_PORT: rconPort ?? "",
      RCON_PASSWORD: rconPassword ?? "",
      INTEGRATION_SECRET_KEY: integrationSecret ?? "",
      DISCORD_WEBHOOK_URL: discordWebhook ?? "",
    });

    // 1. Falix: key must be valid AND have access to the configured server.
    let serverName = "";
    try {
      const server = await getServer(serverId);
      serverName = server.name ?? "";
    } catch (e) {
      clearOverride();
      return jsonError(400, "validation_failed", `Falix connection failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 2. Supabase/Postgres direct connection.
    const dbCheck = await testDbConnection();
    if (!dbCheck.ok) {
      clearOverride();
      return jsonError(400, "validation_failed", `Database connection failed: ${dbCheck.error}`);
    }

    // 3. Persist config and seed. Both are idempotent.
    // persistConfig() merges over the file, persists, and invalidates the cache.
    persistConfig({
      FALIX_API_BASE: apiBase,
      FALIX_API_KEY: apiKey,
      FALIX_SERVER_ID: serverId,
      MINECRAFT_SERVER_HOST: host,
      MINECRAFT_SERVER_PORT: port,
      SUPABASE_URL: sbUrl,
      SUPABASE_ANON_KEY: sbAnon,
      SUPABASE_SERVICE_ROLE_KEY: sbService,
      ...(sbDbPassword ? { SUPABASE_DB_PASSWORD: sbDbPassword } : {}),
      ...(discordWebhook ? { DISCORD_WEBHOOK_URL: discordWebhook } : {}),
      ...(rconPort ? { RCON_PORT: rconPort } : {}),
      ...(rconPassword ? { RCON_PASSWORD: rconPassword } : {}),
      ...(integrationSecret ? { INTEGRATION_SECRET_KEY: integrationSecret } : {}),
    });
    clearOverride();

    await seedDatabase(adminUsername, adminPassword);

    return NextResponse.json({ ok: true, serverName, dbVia: dbCheck.via ?? null });
  } catch (e) {
    clearOverride();
    if (e instanceof ValidationError) {
      return jsonError(400, "validation_failed", e.message, { field: e.field });
    }
    return handleRouteError(e);
  }
}
