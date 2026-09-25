import { getConfig } from "./config";
import { q, testDbConnection, resetDbClients } from "./db";
import { runMigrations } from "./schema";
import { hashPassword } from "./auth";
import { SEED_MARKER } from "./seed";

/**
 * Production bootstrap: on serverless hosts (Netlify) there is no persistent
 * filesystem, so the setup wizard cannot be part of the flow — the database is
 * reached, migrated, and the admin account created automatically when
 * AUTO_SETUP=true and the required env vars are present. Idempotent.
 */

let ran: Promise<void> | null = null;

/**
 * Make sure the database is actually reachable before anything else. Without
 * this, every seeded/configured check silently fails on serverless (unknown
 * pooler region → query error) and the app wrongly falls back to /setup.
 */
async function ensureDb(): Promise<void> {
  try {
    await q("select 1");
    return;
  } catch {
    // First connection failed — discover the working pooler region (probes
    // all regions, persists the winner in memory when the FS is read-only),
    // then rebuild the singleton pool on the correct host.
    const check = await testDbConnection();
    if (!check.ok) throw new Error(check.error ?? "database unreachable");
    resetDbClients();
    await q("select 1");
  }
}

async function run(): Promise<void> {
  const c = getConfig();
  if (!c.SUPABASE_URL || !c.SUPABASE_SERVICE_ROLE_KEY) return;

  await ensureDb();

  // Always apply migrations at boot: the DDL is idempotent (IF NOT EXISTS +
  // a self-heal pass), so existing installs pick up new columns/tables on
  // restart without going through setup again.
  await runMigrations(async (sql) => {
    await q(sql);
  });

  const auto = process.env.AUTO_SETUP === "1" || process.env.AUTO_SETUP?.toLowerCase() === "true";
  if (!auto) return; // local installs seed the admin through the setup wizard

  // Fast guard: cheap query, skips DDL once seeding is done.
  const marker = await q<{ key: string }>(`select key from app_meta where key = 'seed_marker' limit 1`);
  if (marker.rows.length > 0) return;

  await runMigrations(async (sql) => {
    await q(sql);
  });

  const username = (process.env.PANEL_ADMIN_USERNAME || "").trim();
  const password = process.env.PANEL_ADMIN_PASSWORD || "";
  if (username && password) {
    const passwordHash = await hashPassword(password);
    await q(
      `insert into users (username, username_display, password_hash, role, mc_username)
       values ($1::citext, $1::text, $2, 'admin', $1::text)
       on conflict (username) do update set role = 'admin', updated_at = now()`,
      [username, passwordHash],
    );
  }

  await q(
    `insert into app_meta (key, value) values ('seed_marker', $1::jsonb)
     on conflict (key) do nothing`,
    [JSON.stringify({ marker: SEED_MARKER, at: new Date().toISOString() })],
  );

  await q(
    `insert into integration_status (key, status) values ('minecraft_mod', 'never_seen')
     on conflict (key) do nothing`,
  );

  console.log("[bootstrap] auto-setup complete: migrations applied, admin user ready");
}

/** Called from server entry points; runs at most once per instance. */
export function ensureBootstrap(): Promise<void> {
  if (!ran) {
    ran = run().catch((e) => {
      ran = null; // retry on the next call (e.g. project was paused)
      throw e;
    });
  }
  return ran;
}
