import type { Role } from "./auth";

/**
 * Per-user server power scope. Independent of the panel role: a moderator can
 * be limited to start-only, a player can be granted full power, etc.
 *  - "full": start / stop / restart (the console is a separate permission)
 *  - "start": may start the server, never stop or restart
 *  - "none": no power actions at all
 */
export type PowerScope = "full" | "start" | "none";

export const POWER_SCOPES: readonly PowerScope[] = ["full", "start", "none"] as const;

export function isPowerScope(v: unknown): v is PowerScope {
  return v === "full" || v === "start" || v === "none";
}

/**
 * Effective scope. Admins always hold 'full'. Rows saved before the
 * power_scope column existed get their legacy role behavior: moderators could
 * use power actions (power_control), players could not — so moderator→full,
 * player→none. New grants are set explicitly in Settings.
 */
export function effectivePowerScope(role: Role, stored: string | null | undefined): PowerScope {
  if (role === "admin") return "full";
  if (isPowerScope(stored)) return stored;
  return role === "moderator" ? "full" : "none";
}

/** Whether `scope` allows this specific power signal. */
export function scopeAllows(scope: PowerScope, signal: "start" | "stop" | "restart" | "kill"): boolean {
  switch (scope) {
    case "full":
      return signal === "start" || signal === "stop" || signal === "restart";
    case "start":
      return signal === "start";
    case "none":
      return false;
  }
}
