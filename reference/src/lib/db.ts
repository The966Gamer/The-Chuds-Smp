/**
 * Database layer.
 *
 * - `sb()` returns a Supabase client bound to the service-role key (server-only).
 * - Direct Postgres access (pooler/direct) is used for DDL + parameterized
 *   queries. Connection details come from DATABASE_URL when provided, or are
 *   derived from the Supabase project ref + the database password entered
 *   during setup. The Supabase region is NOT part of the project URL, so it is
 *   discovered by probing the regional poolers and reading their error
 *   signatures ("Tenant or user not found" = wrong region, "password
 *   authentication failed" = right region, wrong password).
 *
 * Never import this module from client components.
 */
import { Pool, Client, type QueryResult, type QueryResultRow } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig, persistConfig, readRawConfigKey } from "./config";

let sbClient: SupabaseClient | null = null;

export function sb(): SupabaseClient {
  if (sbClient) return sbClient;
  const c = getConfig();
  if (!c.SUPABASE_URL || !c.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase is not configured");
  }
  sbClient = createClient(c.SUPABASE_URL, c.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return sbClient;
}

let pgPool: Pool | null = null;

function databaseUrlFromAnySource(): string | null {
  const env = process.env.DATABASE_URL?.trim();
  if (env) return env;
  return readRawConfigKey("DATABASE_URL")?.trim() || null;
}

/** Supabase AWS regions where the session pooler is offered. */
const SUPABASE_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "eu-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "ap-south-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "sa-east-1",
];

export interface DbCandidate {
  host: string;
  port: number;
  user: string;
  database: string;
  password: string;
  ssl?: boolean;
  label: string;
}

/**
 * Build ordered connection candidates. DATABASE_URL always wins. Otherwise we
 * sweep the regional poolers (region discovered live during testDbConnection)
 * plus the IPv6 direct host.
 */
export function getDirectDbCandidates(regionOverride?: string): { ok: false; reason: string } | { ok: true; candidates: DbCandidate[] } {
  const direct = databaseUrlFromAnySource();
  if (direct) {
    try {
      const u = new URL(direct);
      return {
        ok: true,
        candidates: [
          {
            host: u.hostname,
            port: Number(u.port || 5432),
            user: decodeURIComponent(u.username || "postgres"),
            database: decodeURIComponent(u.pathname.replace(/^\//, "") || "postgres"),
            password: decodeURIComponent(u.password || ""),
            ssl: (u.searchParams.get("sslmode") ?? "require") !== "disable",
            label: `DATABASE_URL (${u.hostname})`,
          },
        ],
      };
    } catch {
      return { ok: false, reason: "DATABASE_URL is not a valid connection string" };
    }
  }

  const c = getConfig();
  if (!c.SUPABASE_URL) {
    return { ok: false, reason: "No Supabase credentials configured" };
  }
  let ref: string;
  try {
    const url = new URL(c.SUPABASE_URL);
    ref = url.hostname.split(".")[0];
  } catch {
    return { ok: false, reason: "SUPABASE_URL is not a valid URL" };
  }
  if (!ref || ref.length < 8 || /[^a-z0-9]/i.test(ref)) {
    return {
      ok: false,
      reason:
        "SUPABASE_URL does not look like a Supabase project URL (expected https://<project-ref>.supabase.co)",
    };
  }

  // The database password comes from setup or env. It is NOT the
  // service-role key; using that produces a clean, specific auth error which
  // the setup screen explains.
  const password =
    process.env.POSTGRES_PASSWORD?.trim() || c.SUPABASE_DB_PASSWORD?.trim() || c.SUPABASE_SERVICE_ROLE_KEY;

  const savedRegion = c.SUPABASE_DB_REGION?.trim();
  const regions = regionOverride ?? (savedRegion ? [savedRegion, ...SUPABASE_REGIONS.filter((r) => r !== savedRegion)] : SUPABASE_REGIONS);
  const candidates: DbCandidate[] = [];
  for (const region of regions) {
    candidates.push({
      host: `aws-0-${region}.pooler.supabase.com`,
      port: 5432,
      user: `postgres.${ref}`,
      database: "postgres",
      password,
      ssl: true,
      label: `pooler aws-0-${region}`,
    });
  }
  candidates.push({
    host: `db.${ref}.supabase.co`,
    port: 5432,
    user: "postgres",
    database: "postgres",
    password,
    ssl: true,
    label: `direct db.${ref.slice(0, 8)}…`,
  });
  return { ok: true, candidates };
}

/** How a single connection attempt failed. */
type Signal = "tenant_unknown" | "auth_failed" | "unresponsive" | "dns" | "overloaded" | "other";

/**
 * Map a Postgres/pooler error to a diagnostic signal. Order matters: the
 * pooler's tenant miss literally contains "ENOTFOUND", so it must be tested
 * before plain DNS failures.
 */
function classify(message: string): Signal {
  const m = message.toLowerCase();
  if (m.includes("tenant") && (m.includes("not found") || m.includes("enotfound"))) return "tenant_unknown";
  if (m.includes("password authentication failed") || m.includes("auth failed") || m.includes('role "postgres')) {
    return "auth_failed";
  }
  if (m.includes("too many connections") || m.includes("max_connections")) return "overloaded";
  if (
    m.includes("timeout") ||
    m.includes("expired") ||
    m.includes("etimedout") ||
    m.includes("econnreset") ||
    m.includes("econnrefused") ||
    m.includes("socket hang up") ||
    m.includes("connection terminated")
  ) {
    return "unresponsive";
  }
  if (m.includes("enotfound") || m.includes("eai_again")) return "dns";
  return "other";
}

interface Attempt {
  candidate: DbCandidate;
  ok: boolean;
  sig: Signal;
  error: string;
  version?: string;
}

function regionOf(host: string): string | null {
  return host.match(/^aws-\d+-(.+)\.pooler\.supabase\.com$/)?.[1] ?? null;
}

function persistRegion(region: string): void {
  try {
    persistConfig({ SUPABASE_DB_REGION: region });
  } catch {
    // non-fatal
  }
}

/** Probe several candidates concurrently; tryCandidate never throws. */
async function probeAll(list: DbCandidate[], timeoutMs: number): Promise<Attempt[]> {
  return Promise.all(
    list.map(async (candidate) => {
      const r = await tryCandidate(candidate, timeoutMs);
      return {
        candidate,
        ok: !r.error,
        sig: classify(r.error ?? ""),
        error: (r.error ?? "").slice(0, 160),
        version: r.version,
      };
    }),
  );
}

function passwordRejectedError(a: Attempt): string {
  const region = regionOf(a.candidate.host);
  return (
    `Your Supabase project was reached${region ? ` (region: ${region})` : ""}, but the database password was rejected. ` +
    "Enter the Database password from Supabase → Settings → Database (it is NOT the publishable/secret key), " +
    "or set DATABASE_URL=postgresql://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres."
  );
}

function pool(): Pool {
  if (pgPool) return pgPool;
  const info = getDirectDbCandidates();
  if (!info.ok) throw new Error(info.reason);
  const first = info.candidates[0];
  pgPool = new Pool({
    host: first.host,
    port: first.port,
    user: first.user,
    password: first.password,
    database: first.database,
    ssl: first.ssl ? { rejectUnauthorized: false } : undefined,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 12_000,
  });
  pgPool.on("error", () => {
    /* keep the process alive on idle-client errors */
  });
  return pgPool;
}

/** Run a parameterized query through the direct Postgres connection. */
export async function q<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return pool().query<T>(text, params as unknown[]);
}

async function tryCandidate(cand: DbCandidate, timeoutMs = 6000): Promise<{ version?: string; error?: string }> {
  const client = new Client({
    host: cand.host,
    port: cand.port,
    user: cand.user,
    password: cand.password,
    database: cand.database,
    ssl: cand.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: timeoutMs,
  });
  try {
    await client.connect();
    const res = await client.query<{ version: string }>("select version() as version");
    return { version: res.rows[0]?.version };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.split("\n")[0].slice(0, 160) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Probe connection candidates in staged passes and produce a precise,
 * actionable diagnosis:
 *
 *   Pass 1 — fast parallel sweep of every regional pooler (4s timeout).
 *   - any connects            → success (region persisted for the fast path)
 *   - "password auth failed"  → project alive, wrong password (unambiguous)
 *   - routed-but-unresponsive → pass 2 retry with a 10s timeout; if it still
 *     never answers, that is the paused-project signature
 *   - nothing routed us       → pass 3 tries the direct host, then reports a
 *     project-ref problem
 */
export async function testDbConnection(): Promise<{
  ok: boolean;
  error?: string;
  version?: string;
  via?: string;
}> {
  const info = getDirectDbCandidates();
  if (!info.ok) return { ok: false, error: info.reason };
  const poolers = info.candidates.filter((c) => c.host.endsWith(".pooler.supabase.com"));
  const others = info.candidates.filter((c) => !c.host.endsWith(".pooler.supabase.com"));

  const success = (a: Attempt) => {
    const region = regionOf(a.candidate.host);
    if (region) persistRegion(region);
    return { ok: true as const, version: a.version, via: a.candidate.label };
  };

  // Pass 1 — fast parallel sweep across every regional pooler.
  const pass1 = await probeAll(poolers, 4000);
  const connected = pass1.find((a) => a.ok);
  if (connected) return success(connected);

  // A pooler reporting "password authentication failed" reached the actual
  // Postgres instance: the project is alive, only the password is wrong.
  const authFail = pass1.find((a) => a.sig === "auth_failed");
  if (authFail) return { ok: false, error: passwordRejectedError(authFail) };

  // Regions that routed us but whose database never answered — the paused (or
  // still-waking) project signature. Retry with a generous timeout to rule out
  // a transient blip.
  const routed = pass1.filter((a) => a.sig === "unresponsive" || a.sig === "overloaded" || a.sig === "other");
  if (routed.length) {
    const retried = await probeAll(routed.map((a) => a.candidate), 10_000);
    const connected2 = retried.find((a) => a.ok);
    if (connected2) return success(connected2);
    const authFail2 = retried.find((a) => a.sig === "auth_failed");
    if (authFail2) return { ok: false, error: passwordRejectedError(authFail2) };
    const region = regionOf(retried[0].candidate.host);
    const saturated = retried.some((a) => a.sig === "overloaded");
    return {
      ok: false,
      error:
        `Your Supabase project was located${region ? ` (region: ${region})` : ""}, but its Postgres database did not respond — ` +
        "this is exactly what a PAUSED project looks like. Free-tier projects pause after ~1 week of inactivity: " +
        "open the project at supabase.com/dashboard and click Resume/Restore, wait 1–2 minutes after it shows Active, then run setup again. " +
        (saturated
          ? "The database also reported connection saturation, which points to heavy load rather than a password problem."
          : "If the project already shows Active it may still be waking up — wait a minute and retry; a wrong Database password can only be confirmed once the database answers."),
    };
  }

  // No pooler routed us at all — try the direct host as a last resort.
  if (others.length) {
    const direct = await probeAll(others, 6000);
    const connected2 = direct.find((a) => a.ok);
    if (connected2) return success(connected2);
    const authFail2 = direct.find((a) => a.sig === "auth_failed");
    if (authFail2) return { ok: false, error: passwordRejectedError(authFail2) };
  }

  const attempts = [...pass1];
  const tried = attempts.map((a) => `${a.candidate.label}: ${a.error}`).join(" | ");
  return {
    ok: false,
    error:
      `No Supabase region recognized this project (tried ${attempts.length} hosts — ${tried}). ` +
      "Check that the project ref in SUPABASE_URL matches Supabase → Settings → General → Reference ID, " +
      "and that the project still exists (projects paused for over 90 days may be deleted).",
  };
}

export function resetDbClients(): void {
  sbClient = null;
  if (pgPool) {
    void pgPool.end().catch(() => undefined);
    pgPool = null;
  }
}
