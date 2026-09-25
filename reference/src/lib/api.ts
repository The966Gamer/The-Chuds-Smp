import { NextRequest, NextResponse } from "next/server";
import { ValidationError } from "./validate";
import {
  getSessionFromCookieStore,
  hasPermission,
  safeEqual,
  type AuthContext,
  type PermissionAction,
} from "./auth";
import { cookies } from "next/headers";

export interface ApiErrorShape {
  error: {
    code: string;
    message: string;
    field?: string;
    request_id?: string;
    /** Falix free-plan verification link, present only when Falix demands an out-of-band user action. */
    action_url?: string;
  };
}

/**
 * Single constructor for the panel's error envelope. Every API error —
 * validation, auth, upstream mapping — leaves through here so the client can
 * rely on one shape (and one place to add fields like action_url).
 */
export function jsonError(
  status: number,
  code: string,
  message: string,
  extra: { field?: string; actionUrl?: string } = {},
): NextResponse<ApiErrorShape> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(extra.field ? { field: extra.field } : {}),
        // Only https URLs from the Falix adapter are forwarded to the browser.
        ...(extra.actionUrl && extra.actionUrl.startsWith("https://") ? { action_url: extra.actionUrl } : {}),
        request_id: requestId(),
      },
    },
    { status },
  );
}

function requestId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "127.0.0.1";
}

/**
 * Resolve the authenticated context for a request.
 * Returns null when unauthenticated.
 */
export async function auth(req: NextRequest): Promise<AuthContext | null> {
  void req;
  const store = await cookies();
  return getSessionFromCookieStore(store);
}

/**
 * Require a session; throws a Response-ready error via returned union.
 */
export async function requireAuth(
  req: NextRequest,
): Promise<{ ok: true; ctx: AuthContext } | { ok: false; res: NextResponse }> {
  const ctx = await auth(req);
  if (!ctx) return { ok: false, res: jsonError(401, "unauthorized", "Sign in required") };
  return { ok: true, ctx };
}

export async function requirePermission(
  req: NextRequest,
  action: PermissionAction,
): Promise<{ ok: true; ctx: AuthContext } | { ok: false; res: NextResponse }> {
  const base = await requireAuth(req);
  if (!base.ok) return base;
  if (!hasPermission(base.ctx.user.role, action)) {
    return {
      ok: false,
      res: jsonError(403, "forbidden", `Your role (${base.ctx.user.role}) cannot perform this action`),
    };
  }
  return base;
}

/** CSRF check for state-changing requests (double-submit + session-bound). */
export async function requireCsrf(
  req: NextRequest,
  ctx: AuthContext,
): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const header = req.headers.get("x-csrf-token") ?? "";
  if (!header || !safeEqual(header, ctx.csrfToken)) {
    return { ok: false, res: jsonError(403, "csrf", "Missing or invalid CSRF token") };
  }
  // SameSite=Lax cookies + this session-bound header token constitute CSRF defense.
  const store = await cookies();
  const cookieToken = store.get("panel_csrf")?.value;
  if (cookieToken && !safeEqual(cookieToken, ctx.csrfToken)) {
    return { ok: false, res: jsonError(403, "csrf", "CSRF cookie mismatch") };
  }
  return { ok: true };
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}

/**
 * Standard error mapping for route handlers: typed errors → the shared
 * envelope. Anything with a numeric `status` (FalixError, ApiError) keeps its
 * status/code; everything else is a 500.
 */
export function handleRouteError(e: unknown): NextResponse {
  if (e instanceof ValidationError) {
    return jsonError(400, "bad_request", e.message, { field: e.field });
  }
  const anyErr = e as { status?: number; code?: string; message?: string; actionUrl?: string };
  if (anyErr && typeof anyErr.status === "number") {
    return jsonError(anyErr.status, anyErr.code ?? "error", anyErr.message ?? "Upstream error", {
      actionUrl: anyErr.actionUrl,
    });
  }
  console.error("[api] unhandled error:", e);
  return jsonError(500, "internal", "Internal server error");
}

// ---------------------------------------------------------------------------
// In-memory rate limiter (per instance). Good for a single-node panel.
// ---------------------------------------------------------------------------

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }
  if (b.count >= limit) {
    return { ok: false, remaining: 0, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count += 1;
  return { ok: true, remaining: limit - b.count, retryAfter: 0 };
}

export function rateLimitResponse(retryAfter: number): NextResponse {
  return jsonError(429, "rate_limited", `Too many requests. Retry in ${retryAfter}s`);
}

// Sweep old buckets occasionally to avoid unbounded growth.
let lastSweep = Date.now();
export function sweepBuckets(): void {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}
