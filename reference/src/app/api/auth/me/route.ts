import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/api";
import { getSettings, FEATURES } from "@/lib/settings";
import { q } from "@/lib/db";
import { effectivePowerScope } from "@/lib/power";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await auth(req);
  if (!ctx) return NextResponse.json({ user: null }, { status: 401 });
  let features: string[] = [...FEATURES, "settings"];
  try {
    features = Object.entries((await getSettings()).features)
      .filter(([, on]) => on)
      .map(([id]) => id);
    features.push("settings"); // settings is not a toggleable feature
  } catch {
    // settings table unavailable — all features stay visible
  }
  let powerScope: string = "full";
  try {
    const r = await q<{ power_scope: string }>(
      `select power_scope from users where id = $1 limit 1`,
      [ctx.user.id],
    );
    powerScope = effectivePowerScope(ctx.user.role, r.rows[0]?.power_scope);
  } catch {
    // column missing (pre-migration boot) — fall back to role behavior
  }
  return NextResponse.json({
    user: {
      id: ctx.user.id,
      username: ctx.user.usernameDisplay,
      role: ctx.user.role,
      mcUsername: ctx.user.mcUsername,
      headUrl: ctx.user.headUrl,
    },
    csrfToken: ctx.csrfToken,
    features,
    powerScope,
  });
}
