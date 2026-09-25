"use client";

import { useEffect, useRef } from "react";

type Handler = (type: string, payload: unknown) => void;

/** Subscribe to the panel SSE stream with auto-reconnect. */
export function useRealtime(onMessage: Handler, enabled = true): void {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let stopped = false;
    let retryMs = 2000;

    const connect = () => {
      if (stopped) return;
      es = new EventSource("/api/realtime");
      const types = ["status", "console", "players", "event"];
      for (const t of types) {
        es.addEventListener(t, (ev) => {
          try {
            handlerRef.current(t, JSON.parse((ev as MessageEvent).data));
          } catch {
            // ignore malformed frames
          }
        });
      }
      es.onopen = () => {
        retryMs = 2000;
      };
      es.onerror = () => {
        es?.close();
        if (!stopped) {
          setTimeout(connect, retryMs);
          retryMs = Math.min(retryMs * 2, 30_000);
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }, [enabled]);
}

export function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

export function formatCountdown(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms <= 0) return "expired";
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
