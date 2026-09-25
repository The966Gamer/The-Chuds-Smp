# Falix Control Panel

A production-grade Minecraft server control panel for Falix-hosted servers:
real Falix v2 API integration, real Supabase/Postgres persistence, real
Minecraft-side events via a Fabric mod, and a polished widget dashboard.

## What is real here

- **Falix v2 API** — server status, power control, console log/commands,
  online players, live Minecraft query, Discord webhook settings. Adapter:
  `src/lib/falix.ts` (only documented endpoints; Bearer key; typed 401/403/404/409/429/502/503 mapping).
- **Supabase/Postgres** — users, sessions, players, graves, chat, events,
  statistics, layouts, notifications, audit logs, Discord queue. Direct
  Postgres DDL + parameterized queries (`src/lib/db.ts`, `src/lib/schema.ts`).
- **Auth** — argon2id hashes, httpOnly session cookies (hash-indexed rows),
  CSRF double-token, login throttling, in-memory rate limits, audit trail.
- **Minecraft integration** — a Fabric mod (source in `mc-integration/`)
  posts real events to `/api/integration/events` using
  `X-Integration-Key: $INTEGRATION_SECRET_KEY` and registers real `/panel`
  commands; graves are protected **in-game** by the mod.
- **No fake data** — empty states explain *why* data is missing instead of
  showing zeroes.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

Open the app: it lands on **First-run setup**.

1. **Falix** — create an API key in the Falix dashboard (keys look like
   `flx_live_...`), enter it with your numeric **server ID**.
2. **Minecraft** — the public host/port players use (live query via Falix).
3. **Supabase** — project URL, publishable key (`sb_publishable_…`, or legacy anon key) and secret key (`sb_secret_…`, or legacy service_role key).
   - For **hosted Supabase**, the panel connects over direct Postgres for
     migrations; set **`DATABASE_URL`** in `.env`:
     `postgresql://postgres.<project-ref>:<DB-PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres`
     (the DB password is from Supabase → Settings → Database, **not** the
     service-role key). Without it, setup reports exactly which connection
     methods were attempted and why they failed.
4. Optional **RCON** fallback and **integration secret** (`openssl rand -hex 32`).
5. **Admin account** — username (`SuperDuck220` suggested) + password ≥ 10 chars.

Setup validates Falix and the database **before** anything is written, then
runs idempotent migrations and seeds the admin (password only as an argon2id
hash). Re-running setup never duplicates users or data.

## Pages

Dashboard (draggable/resizable widgets, per-user persisted layout), Console
(live tail + commands), Players, Graves, Chat, Activity, Statistics, Discord,
Settings (incl. permissions + audit-relevant actions).

## Minecraft-side mod

Build with `./gradlew build` inside `mc-integration/` (Fabric, matching your
server's MC version), drop the jar in `mods/`, and configure:

```properties
panelUrl=https://your-panel-host
integrationSecret=<INTEGRATION_SECRET_KEY from the panel>
```

Events sent: `PLAYER_JOIN/LEAVE/DEATH`, `GRAVE_CREATED/REMOVED`,
`CHAT_MESSAGE`, `PLAYER_STATISTICS`, `SERVER_START/STOP/CRASH`.
Commands: `/panel`, `/panel help|status|graves|chat|notifications`,
`/panel server restart` (level-3+ gate). Grave protection (owner-only opening,
explosion/piston resistance) is enforced **in the game server** — the panel
only displays status.

## Scripts

```bash
npm run dev / build / start / typecheck
```

## Code structure (authoritative map)

Data flows one way: **browser → API route → service/adapter layer → Postgres/Supabase + Falix**. UI never touches Falix, RCON, or SQL directly.

Server-side:
- `src/lib/config.ts` — **sole owner** of configuration: env + `.panel-config.json` precedence, transient overrides for setup validation, `persistConfig()` (the only write path to the config file — setup credentials and the DB layer's discovered region both go through it), `maskSecret()`.
- `src/lib/db.ts` — Postgres connectivity only: candidate building, region sweep/discovery (persists via `persistConfig`), staged `testDbConnection()` diagnosis, the `q()` query executor, Supabase client.
- `src/lib/schema.ts` / `seed.ts` — idempotent DDL (self-healing: drops stale-shaped tables) and seeding.
- `src/lib/falix.ts` — the only module that speaks to Falix: typed `FalixError` (carries `actionUrl` when Falix demands out-of-band verification), rate-limit handling, endpoint wrappers.
- `src/lib/api.ts` — **sole constructor of the error envelope** (`jsonError`, incl. the optional `action_url` passthrough), auth/CSRF/rate-limit guards, `handleRouteError` (translation only).
- `src/lib/{rcon,heads,discord,events,audit,realtime,auth}.ts` — one adapter per integration; each is the only place its credentials are read.

Client-side:
- `src/lib/client/api.ts` — fetch wrapper; `ApiError` carries `actionUrl` through to UI.
- `src/lib/client/useServerPower.ts` — **single owner of power-action state**: busy signal, last error, and the Falix verification flow (challenge URL, retry, dismiss).
- `src/components/VerificationDialog.tsx` — presentation-only modal for the embedded Falix captcha.
- Page components own page-local state (layout drag/resize, filters) and compose the above; no business rules live in JSX.

Rule of thumb for future changes: new cross-cutting policy (error fields, config keys, security checks) gets exactly one home in the list above — never a copy in a route or page.

## Security notes

- Secrets live in `.panel-config.json` (chmod 600) and `.env`; both are
  gitignored; the browser only ever receives masked values.
- Every mutating API route re-checks **role + CSRF** server-side.
- Console/power routes additionally enforce Falix-side scopes; upstream 403s
  are surfaced with the missing-scope explanation.
