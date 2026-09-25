import { NextRequest, NextResponse } from "next/server";
import { requirePermission, handleRouteError, jsonError } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { getConfig } from "@/lib/config";
import { readConsoleLog } from "@/lib/falix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const guard = await requirePermission(req, "view_console");
    if (!guard.ok) return guard.res;
    if (!(await getSettings()).features.console) {
      return jsonError(404, "feature_disabled", "This section has been disabled by an administrator");
    }

    const lines = Number(req.nextUrl.searchParams.get("lines") ?? 40);
    const bounded = Math.min(Math.max(Number.isFinite(lines) ? lines : 40, 5), 40);
    const config = getConfig();
    const data = await readConsoleLog(config.FALIX_SERVER_ID, bounded);
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    return handleRouteError(e);
  }
}
