import { q } from "./db";
import type { AuthContext } from "./auth";

export async function audit(
  ctx: AuthContext | null,
  action: string,
  target?: string,
  meta: Record<string, unknown> = {},
  ip?: string,
): Promise<void> {
  try {
    await q(
      `insert into audit_logs (user_id, username, action, target, ip, metadata)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        ctx?.user.id ?? null,
        ctx?.user.usernameDisplay ?? null,
        action.slice(0, 80),
        target?.slice(0, 200) ?? null,
        ip ?? null,
        JSON.stringify(meta),
      ],
    );
  } catch (e) {
    console.error("[audit] failed to write entry:", e);
  }
}
