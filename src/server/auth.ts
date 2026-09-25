import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { getDbPool, q, memDb, isPostgresOnline } from "./db";
import { getConfig } from "./config";

export interface UserSession {
  user: {
    id: string;
    username: string;
    role: "player" | "moderator" | "admin";
    powerScope: "full" | "start" | "none";
    mcUsername: string | null;
    headUrl: string | null;
  };
  sessionId: string;
  csrfToken: string;
}

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  try {
    const [salt, expectedHash] = stored.split(":");
    if (!salt || !expectedHash) return false;
    const computedHash = crypto.scryptSync(plain, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(computedHash, "hex"), Buffer.from(expectedHash, "hex"));
  } catch {
    return false;
  }
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  userAgent?: string,
  ip?: string,
): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const csrfToken = generateToken().slice(0, 32);
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

  // Always store in memory session cache
  memDb.sessions.set(tokenHash, {
    id: sessionId,
    user_id: userId,
    token_hash: tokenHash,
    csrf_token: csrfToken,
    created_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
    user_agent: userAgent || null,
    ip: ip || null,
  });

  if (isPostgresOnline()) {
    try {
      await q(
        `insert into sessions (id, user_id, token_hash, csrf_token, expires_at, user_agent, ip)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [sessionId, userId, tokenHash, csrfToken, expiresAt.toISOString(), userAgent || null, ip || null],
      );
    } catch (err) {
      console.warn("[auth] Failed to persist session to DB:", err);
    }
  }

  return { token, csrfToken, expiresAt };
}

export async function validateSession(token: string): Promise<UserSession | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);

  // Check memory session first (instant & reliable)
  const s = memDb.sessions.get(tokenHash);
  if (s) {
    if (s.revoked_at || new Date(s.expires_at) < new Date()) return null;
    let user = null;
    for (const u of memDb.users.values()) {
      if (u.id === s.user_id) {
        user = u;
        break;
      }
    }
    if (user) {
      return {
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          powerScope: user.power_scope || "full",
          mcUsername: user.mc_username,
          headUrl: user.head_url,
        },
        sessionId: s.id,
        csrfToken: s.csrf_token,
      };
    }
  }

  if (isPostgresOnline()) {
    try {
      const res = await q(
        `select s.id as session_id, s.csrf_token, s.expires_at, s.revoked_at,
                u.id as user_id, u.username, u.role, u.power_scope, u.mc_username, u.head_url
         from sessions s
         join users u on u.id = s.user_id
         where s.token_hash = $1`,
        [tokenHash],
      );

      if (res.rows.length > 0) {
        const row = res.rows[0];
        if (row.revoked_at || new Date(row.expires_at) < new Date()) {
          return null;
        }
        return {
          user: {
            id: row.user_id,
            username: row.username,
            role: row.role,
            powerScope: row.power_scope || "full",
            mcUsername: row.mc_username,
            headUrl: row.head_url,
          },
          sessionId: row.session_id,
          csrfToken: row.csrf_token,
        };
      }
    } catch {
      // fallback
    }
  }

  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.chudsmp_session || req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const session = await validateSession(token);
  if (!session) {
    res.status(401).json({ error: "Session invalid or expired" });
    return;
  }

  // Validate CSRF token for mutating requests (POST, PUT, DELETE)
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && !req.path.startsWith("/api/mc/")) {
    const csrfHeader = req.headers["x-csrf-token"];
    if (!csrfHeader || csrfHeader !== session.csrfToken) {
      res.status(403).json({ error: "Invalid CSRF token" });
      return;
    }
  }

  (req as any).userSession = session;
  next();
}

export function requireRole(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const session = (req as any).userSession as UserSession | undefined;
    if (!session || !allowedRoles.includes(session.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
