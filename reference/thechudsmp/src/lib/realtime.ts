/**
 * Realtime hub.
 *
 * An in-process pub/sub bus feeds SSE endpoints. Polling loops bridge the
 * Falix API (which has no websocket endpoint) into the bus at respectful,
 * per-subscriber-cached intervals so every connected browser shares one
 * upstream poll, not one per client.
 */
import { getConsoleStatus, readConsoleLog, getPlayersOnline } from "./falix";
import { getConfig } from "./config";

export interface RealtimeMessage {
  type: string;
  payload: unknown;
  at: number;
}

type Listener = (msg: RealtimeMessage) => void;

const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function publish(type: string, payload: unknown): void {
  const msg: RealtimeMessage = { type, payload, at: Date.now() };
  for (const fn of listeners) {
    try {
      fn(msg);
    } catch {
      listeners.delete(fn);
    }
  }
}

// ---------------------------------------------------------------------------
// Cached pollers — one loop per data kind, shared by all subscribers.
// ---------------------------------------------------------------------------

interface CacheEntry {
  at: number;
  value: unknown;
  error?: string;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

async function cached(key: string, ttlMs: number, fetcher: () => Promise<unknown>): Promise<CacheEntry> {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = (async () => {
    let entry: CacheEntry;
    try {
      const value = await fetcher();
      entry = { at: Date.now(), value };
    } catch (e) {
      entry = { at: Date.now(), value: null, error: e instanceof Error ? e.message : String(e) };
    }
    cache.set(key, entry);
    return entry;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

let loopsStarted = false;

export function ensurePollLoops(): void {
  if (loopsStarted) return;
  loopsStarted = true;
  const config = getConfig();
  const serverId = config.FALIX_SERVER_ID;
  if (!serverId) return;

  // Server status: every 10s.
  setInterval(() => {
    cached("status", 9000, () => getConsoleStatus(serverId)).then((entry) => {
      publish("status", entry.error ? { error: entry.error } : entry.value);
    });
  }, 10_000).unref();

  // Console tail: every 5s.
  setInterval(() => {
    cached("console", 4500, () => readConsoleLog(serverId, 40)).then((entry) => {
      publish("console", entry.error ? { error: entry.error } : entry.value);
    });
  }, 5_000).unref();

  // Players: every 10s.
  setInterval(() => {
    cached("players", 9000, () => getPlayersOnline(serverId)).then((entry) => {
      publish("players", entry.error ? { error: entry.error } : entry.value);
    });
  }, 10_000).unref();

  // Kick the loops immediately once.
  setImmediate(() => {
    cached("status", 0, () => getConsoleStatus(serverId)).then((e) =>
      publish("status", e.error ? { error: e.error } : e.value),
    );
    cached("console", 0, () => readConsoleLog(serverId, 40)).then((e) =>
      publish("console", e.error ? { error: e.error } : e.value),
    );
    cached("players", 0, () => getPlayersOnline(serverId)).then((e) =>
      publish("players", e.error ? { error: e.error } : e.value),
    );
  });
}
