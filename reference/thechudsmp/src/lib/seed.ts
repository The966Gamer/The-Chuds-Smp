/**
 * Idempotent seeding: migrations, admin upsert, seed marker.
 *
 * Everything is keyed on stable natural keys (username, meta key) so running
 * setup twice never duplicates data.
 */
import { randomBytes } from "node:crypto";
import { q, testDbConnection } from "./db";
import { runMigrations } from "./schema";
import { hashPassword } from "./auth";

export interface SetupPayload {
  falix: { apiBase: string; apiKey: string; serverId: string };
  minecraft: { host: string; port: string };
  supabase: { url: string; anonKey: string; serviceKey: string };
  rcon?: { port: string; password: string };
  integrationSecret?: string;
  admin: { username: string; password: string };
}

export const SEED_MARKER = "seed_v1_complete";

export async function seedDatabase(adminUsername: string, adminPassword: string): Promise<void> {
  // 1. Migrations (idempotent DDL).
  await runMigrations(async (sql) => {
    await q(sql);
  });

  // 2. Admin user — upsert by username; never overwrite an existing password.
  const uname = adminUsername.trim();
  const passwordHash = await hashPassword(adminPassword);
  await q(
    `insert into users (username, username_display, password_hash, role, mc_username)
     values ($1::citext, $1::text, $2, 'admin', $1::text)
     on conflict (username) do update set role = 'admin', updated_at = now()`,
    [uname, passwordHash],
  );

  // 3. Seed marker.
  await q(
    `insert into app_meta (key, value) values ('seed_marker', $1::jsonb)
     on conflict (key) do nothing`,
    [JSON.stringify({ marker: SEED_MARKER, at: new Date().toISOString() })],
  );

  // 4. Integration status row.
  await q(
    `insert into integration_status (key, status) values ('minecraft_mod', 'never_seen')
     on conflict (key) do nothing`,
  );
}

export async function isSeeded(): Promise<boolean> {
  try {
    const res = await q<{ key: string }>(`select key from app_meta where key = 'seed_marker'`);
    return res.rows.length > 0;
  } catch {
    return false;
  }
}

export async function checkDb(): Promise<{ ok: boolean; error?: string }> {
  const r = await testDbConnection();
  return { ok: r.ok, error: r.error };
}

export function generateSetupToken(): string {
  return randomBytes(24).toString("base64url");
}
