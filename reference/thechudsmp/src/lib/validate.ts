/**
 * Minimal validation helpers (server-side input validation).
 * Zero-dependency so behavior is fully under our control.
 */

export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export type Body = Record<string, unknown>;

export function obj(input: unknown): Body {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Body;
  throw new ValidationError("Expected a JSON object body");
}

export function str(body: Body, key: string, opts: { min?: number; max?: number } = {}): string {
  const v = body[key];
  if (typeof v !== "string") throw new ValidationError(`"${key}" must be a string`, key);
  const trimmed = v.trim();
  const min = opts.min ?? 1;
  const max = opts.max ?? 4096;
  if (trimmed.length < min) throw new ValidationError(`"${key}" is too short`, key);
  if (trimmed.length > max) throw new ValidationError(`"${key}" is too long`, key);
  return trimmed;
}

export function optionalStr(
  body: Body,
  key: string,
  opts: { max?: number } = {},
): string | undefined {
  const v = body[key];
  if (v === undefined || v === null || v === "") return undefined;
  return str(body, key, opts);
}

export function int(body: Body, key: string, opts: { min?: number; max?: number } = {}): number {
  const v = body[key];
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^-?\d+$/.test(v.trim())) n = Number(v.trim());
  else throw new ValidationError(`"${key}" must be an integer`, key);
  if (!Number.isSafeInteger(n)) throw new ValidationError(`"${key}" is not a safe integer`, key);
  if (opts.min !== undefined && n < opts.min) throw new ValidationError(`"${key}" is too small`, key);
  if (opts.max !== undefined && n > opts.max) throw new ValidationError(`"${key}" is too large`, key);
  return n;
}

export function optionalInt(
  body: Body,
  key: string,
  opts: { min?: number; max?: number } = {},
): number | undefined {
  const v = body[key];
  if (v === undefined || v === null || v === "") return undefined;
  return int(body, key, opts);
}

export function bool(body: Body, key: string, fallback = false): boolean {
  const v = body[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new ValidationError(`"${key}" must be a boolean`, key);
}

export function enumOf<T extends string>(body: Body, key: string, allowed: readonly T[]): T {
  const v = str(body, key, { max: 64 });
  if (!(allowed as readonly string[]).includes(v)) {
    throw new ValidationError(`"${key}" must be one of: ${allowed.join(", ")}`, key);
  }
  return v as T;
}

/** Validate a Minecraft username (offline-mode tolerant). */
export function mcUsername(value: string): string {
  if (!/^[A-Za-z0-9_]{2,20}$/.test(value)) {
    throw new ValidationError("Invalid Minecraft username", "username");
  }
  return value;
}

/** Escape a string for safe embedding in a LIKE pattern. */
export function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}
