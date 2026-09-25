import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { cookies } from "next/headers";
import { q } from "./db";
import { getConfig } from "./config";

export type Role = "player" | "moderator" | "admin";

export const SESSION_COOKIE = "panel_session";
export const CSRF_COOKIE = "panel_csrf";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const HASH_ID = "argon2id";

export interface SessionUser {
  id: string;
  username: string;
  usernameDisplay: string;
  role: Role;
  mcUsername: string | null;
  headUrl: string | null;
}

export interface AuthContext {
  user: SessionUser;
  sessionId: string;
  csrfToken: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

async function hash(password: string): Promise<string> {
  const argon2 = await import("argon2");
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  });
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  const argon2 = await import("argon2");
  return argon2.verify(hashValue, password);
}

export function newSessionToken(): { token: string; tokenHash: string; csrf: string } {
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256(token), csrf };
}

export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<{ token: string; csrf: string; expiresAt: Date }> {
  const { token, tokenHash, csrf } = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await q(
    `insert into sessions (id, user_id, token_hash, csrf_token, expires_at, user_agent, ip)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      sessionId(tokenHash),
      userId,
      tokenHash,
      csrf,
      expiresAt,
      meta.userAgent ?? null,
      meta.ip ?? null,
    ],
  );
  return { token, csrf, expiresAt };
}

function sessionId(tokenHash: string): string {
  return tokenHash.slice(0, 32);
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  const secure = process.env.NODE_ENV === "production" || process.env.FORCE_SECURE_COOKIES === "1";
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export async function getSessionFromCookieStore(store: Awaited<ReturnType<typeof cookies>>): Promise<AuthContext | null> {
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionByToken(token);
}

export async function getSessionByToken(token: string): Promise<AuthContext | null> {
  const tokenHash = sha256(token);
  const res = await q<{
    session_id: string;
    csrf_token: string;
    user_id: string;
    username: string;
    username_display: string;
    role: Role;
    mc_username: string | null;
    head_url: string | null;
  }>(
    `select s.id as session_id, s.csrf_token, u.id as user_id, u.username, u.username_display,
            u.role, u.mc_username, u.head_url
     from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()
     limit 1`,
    [tokenHash],
  );
  const row = res.rows[0];
  if (!row) return null;
  // touch last_seen (fire and forget)
  void q(`update sessions set last_seen_at = now() where id = $1`, [row.session_id]).catch(
    () => undefined,
  );
  return {
    sessionId: row.session_id,
    csrfToken: row.csrf_token,
    user: {
      id: row.user_id,
      username: row.username.toLowerCase(),
      usernameDisplay: row.username_display,
      role: row.role,
      mcUsername: row.mc_username,
      headUrl: row.head_url,
    },
  };
}

export async function revokeSession(token: string): Promise<void> {
  await q(`update sessions set revoked_at = now() where token_hash = $1`, [sha256(token)]);
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await q(`update sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [userId]);
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function can(role: Role, action: PermissionAction): boolean {
  return hasPermission(role, action);
}

export type PermissionAction =
  | "view_dashboard"
  | "view_console"
  | "send_command"
  | "power_control"
  | "view_players"
  | "view_graves"
  | "view_chat"
  | "view_activity"
  | "view_statistics"
  | "view_statistics_self"
  | "view_statistics_others"
  | "manage_discord"
  | "manage_permissions"
  | "manage_settings"
  | "view_audit";

export function hasPermission(role: Role, action: PermissionAction): boolean {
  switch (action) {
    case "view_dashboard":
    case "view_players":
    case "view_graves":
    case "view_chat":
    case "view_activity":
    case "view_statistics":
    case "view_statistics_self":
      return true;
    case "send_command":
      return role === "admin" || role === "moderator";
    case "power_control":
    case "manage_discord":
    case "manage_settings":
      return role === "admin";
    case "view_console":
    case "view_statistics_others":
      return role === "admin" || role === "moderator";
    case "manage_permissions":
    case "view_audit":
      return role === "admin";
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Login throttling
// ---------------------------------------------------------------------------

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

export async function recentFailures(username: string, ip: string): Promise<number> {
  const res = await q<{ count: string }>(
    `select count(*)::text as count from login_attempts
     where success = false
       and created_at > now() - interval '15 minutes'
       and (username = $1 or ip = $2)`,
    [username.toLowerCase(), ip],
  );
  return Number(res.rows[0]?.count ?? 0);
}

export async function recordLoginAttempt(
  username: string,
  ip: string,
  success: boolean,
): Promise<void> {
  await q(
    `insert into login_attempts (username, ip, success) values ($1, $2, $3)`,
    [username.toLowerCase(), ip || null, success],
  );
}
