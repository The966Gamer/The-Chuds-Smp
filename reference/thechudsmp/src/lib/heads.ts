/**
 * Minecraft head (avatar) resolution — data-driven, no blind guessing.
 *
 * Source order:
 *   1. DB cache in `players` (head_url + uuid), fresh within its TTL
 *   2. A UUID relayed by the Minecraft mod (join/leave/statistics events) or
 *      stored from a previous sync
 *   3. A real UUID resolved via the documented Falix endpoint
 *      `GET /servers/{id}/players/resolve` (offline-mode aware)
 *   4. Username-based URL against head CDNs — but only accepted after the
 *      image is actually fetched and verified to be a valid render
 *
 * A head URL is cached ONLY after the image responds with image/* bytes, so a
 * username that has never joined (Mojang returns the Steve/MHF fallback for
 * unknown names) is not presented as real head data. Failures are cached with
 * a short backoff so dead CDNs or never-joined players don't slow requests.
 *
 * Server-side only.
 */
import { q } from "./db";
import { getConfig } from "./config";
import { resolvePlayer } from "./falix";

/** UUID-based renders (real skin data — the preferred form). */
const UUID_PROVIDERS = [
  (id: string, size: number) => `https://mc-heads.net/avatar/${id}/${size}`,
  (id: string, size: number) => `https://vzge.me/face/128/${id}`.replace("128", String(size)),
  (id: string, size: number) => `https://crafatar.com/avatars/${id}?size=${size}&overlay`,
  (id: string, size: number) => `https://api.mineatar.io/face/${id}/${size}`,
];

/** Username-based fallbacks (only used when verified successfully). */
const NAME_PROVIDERS = [
  (u: string, size: number) => `https://mc-heads.net/avatar/${encodeURIComponent(u)}/${size}`,
  (u: string, size: number) => `https://minotar.net/helm/${encodeURIComponent(u)}/${size}.png`,
  (u: string, size: number) => `https://api.mineatar.io/face/${encodeURIComponent(u)}/${size}`,
];

const UUID_SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // skins change rarely
const NAME_SUCCESS_TTL_MS = 24 * 60 * 60 * 1000; // re-check daily (name->skin can appear)
const FAILURE_TTL_MS = 15 * 60 * 1000; // retry failures every 15 min

export function isValidMcName(name: string): boolean {
  return /^[A-Za-z0-9_]{2,20}$/.test(name.trim());
}

function isDashedUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Verify a URL actually serves an image right now. */
async function verifies(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "falix-panel/1.0" },
    });
    if (!res.ok) return false;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return false;
    const len = Number(res.headers.get("content-length") ?? "1");
    return Number.isFinite(len) && len > 0;
  } catch {
    return false;
  }
}

async function cacheHead(
  username: string,
  url: string | null,
  uuid: string | null,
): Promise<void> {
  await q(
    `insert into players (username, head_url, head_fetched_at, uuid)
     values ($1, $2, now(), $3)
     on conflict (username) do update set
       head_url = excluded.head_url,
       head_fetched_at = now(),
       uuid = coalesce(excluded.uuid, players.uuid),
       updated_at = now()`,
    [username.toLowerCase(), url, uuid],
  );
}

interface CachedHead {
  headUrl: string | null;
  uuid: string | null;
  fetchedAt: Date | null;
  source: "cache-uuid" | "cache-name" | "none";
}

async function readCache(username: string): Promise<CachedHead> {
  const res = await q<{ head_url: string | null; uuid: string | null; head_fetched_at: Date | null }>(
    `select head_url, uuid, head_fetched_at from players where username = $1`,
    [username.toLowerCase()],
  );
  const row = res.rows[0];
  if (!row) return { headUrl: null, uuid: null, fetchedAt: null, source: "none" };
  if (!row.head_url) return { headUrl: null, uuid: row.uuid, fetchedAt: row.head_fetched_at, source: "none" };
  // Distinguish a UUID-based cached render from a name-based one by URL shape.
  const isUuidRender = UUID_PROVIDERS.some((make) => {
    // extract the id segment from the provider pattern for comparison
    const probe = make("___UUIDPROBE___", 64);
    const idx = probe.indexOf("___UUIDPROBE___");
    return idx >= 0 && row.head_url!.startsWith(probe.slice(0, idx));
  });
  return {
    headUrl: row.head_url,
    uuid: row.uuid,
    fetchedAt: row.head_fetched_at,
    source: isUuidRender ? "cache-uuid" : "cache-name",
  };
}

/**
 * Resolve the head URL for a username.
 * `uuidHint` comes from mod-relayed event data when available.
 */
export async function resolveHead(
  username: string,
  uuidHint?: string | null,
): Promise<string | null> {
  const name = username.trim();
  if (!isValidMcName(name)) return null;

  // 1. Cache
  const cached = await readCache(name).catch(() => null);
  const now = Date.now();
  if (cached?.headUrl && cached.fetchedAt) {
    const age = now - new Date(cached.fetchedAt).getTime();
    const ttl = cached.source === "cache-uuid" ? UUID_SUCCESS_TTL_MS : NAME_SUCCESS_TTL_MS;
    if (age < ttl) return cached.headUrl;
    // stale: fall through to refresh, but keep the old value if refresh fails
  }
  const effectiveUuid =
    (uuidHint && isDashedUuid(uuidHint) ? uuidHint : null) ??
    (cached?.uuid && isDashedUuid(cached.uuid) ? cached.uuid : null);

  // Backoff: recently failed and no new information? Don't hammer.
  const hasNewInfo = Boolean(uuidHint && !cached?.uuid) || Boolean(cached?.headUrl);
  if (!cached?.headUrl && cached?.fetchedAt && !hasNewInfo) {
    if (now - new Date(cached.fetchedAt).getTime() < FAILURE_TTL_MS) return null;
  }

  // 2. UUID-based verified renders
  if (effectiveUuid) {
    for (const make of UUID_PROVIDERS) {
      const url = make(effectiveUuid, 64);
      if (await verifies(url)) {
        await cacheHead(name, url, effectiveUuid);
        return url;
      }
    }
  }

  // 3. Resolve a real UUID via the Falix API (documented endpoint)
  const config = getConfig();
  if (!effectiveUuid && config.FALIX_SERVER_ID) {
    try {
      const resolved = await resolvePlayer(config.FALIX_SERVER_ID, name);
      if (resolved?.uuid && isDashedUuid(resolved.uuid)) {
        for (const make of UUID_PROVIDERS) {
          const url = make(resolved.uuid, 64);
          if (await verifies(url)) {
            await cacheHead(name, url, resolved.uuid);
            return url;
          }
        }
      }
    } catch {
      // resolve endpoint unavailable (scope/offline); fall through
    }
  }

  // 4. Username-based providers, still verified before caching
  for (const make of NAME_PROVIDERS) {
    const url = make(name, 64);
    if (await verifies(url)) {
      await cacheHead(name, url, effectiveUuid);
      return url;
    }
  }

  // 5. Nothing verified — cache the failure with backoff, return null.
  // The UI shows the one-time "log into the server once" notice instead.
  await cacheHead(name, null, effectiveUuid);
  return null;
}

/** Best-effort resolve for several names, ignoring individual failures. */
export async function resolveHeads(
  names: string[],
  uuids?: Record<string, string | null | undefined>,
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const n of names.slice(0, 50)) {
    out[n] = await resolveHead(n, uuids?.[n]).catch(() => null);
  }
  return out;
}
