import React from "react";

type RealtimeCallback = (type: string, payload: unknown) => void;

const listeners = new Set<RealtimeCallback>();
let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connect() {
  if (typeof window === "undefined" || eventSource) return;

  try {
    eventSource = new EventSource("/api/realtime");

    eventSource.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        if (parsed && typeof parsed === "object" && "type" in parsed) {
          for (const listener of listeners) {
            listener(parsed.type, parsed.payload);
          }
        }
      } catch {
        // non-fatal
      }
    };

    eventSource.onerror = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, 5000);
      }
    };
  } catch {
    // fallback
  }
}

export function useRealtime(callback: RealtimeCallback) {
  React.useEffect(() => {
    listeners.add(callback);
    connect();
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0 && eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
  }, [callback]);
}

export function formatRelative(dateStr: string | null | undefined): string {
  if (!dateStr) return "never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDays = Math.floor(diffHour / 24);
  return `${diffDays}d ago`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatCountdown(remainingMs: number | null | undefined): string {
  if (remainingMs === null || remainingMs === undefined || remainingMs <= 0) return "Expired";
  const totalSec = Math.floor(remainingMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s < 10 ? "0" : ""}${s}s remaining`;
}
