"use client";

import { api } from "./api";

/**
 * Desktop notifications — work in a normal browser tab AND natively inside
 * the Electron desktop app (Electron renders web Notifications as real OS
 * toasts on Windows/macOS/Linux).
 *
 * Gating (all client-side, per user):
 *   1. Browser permission (granted via the toggle in Settings or the bell)
 *   2. Master toggle (localStorage, "panel_desktop_notifications")
 *   3. Per-event toggles (localStorage, "panel_notif_events") — configured
 *      in Settings → Desktop notifications
 */

const STORAGE_KEY = "panel_desktop_notifications";
const TOGGLES_KEY = "panel_notif_events";

const FOCUSABLE_WINDOW = window as unknown as {
  electronAPI?: { focusWindow?: () => void };
};

/** Fire-and-forget POST to an authenticated panel API route. */
async function postApi(path: string, body: unknown): Promise<void> {
  try {
    await api.post(path, body);
  } catch {
    // Auth hiccup or network error — skip this attempt; the next milestone retries
  }
}

export const NOTIFICATION_EVENTS = [
  "server_start",
  "server_stop",
  "server_crash",
  "player_join",
  "player_leave",
  "you_died",
  "other_death",
  "grave_created",
  "grave_expiring",
  "player_message",
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const NOTIF_LABELS: Record<NotificationEvent, string> = {
  server_start: "Server started",
  server_stop: "Server stopped",
  server_crash: "Server crashed",
  player_join: "Player joined",
  player_leave: "Player left",
  you_died: "You died (your own death)",
  other_death: "Other player died",
  grave_created: "Grave created",
  grave_expiring: "Your grave countdown (reminders until it despawns)",
  player_message: "Player chat message",
};

export function desktopSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function runningInElectron(): boolean {
  return typeof window !== "undefined" && /Electron/i.test(navigator.userAgent);
}

export function permissionState(): NotificationPermission | "unsupported" {
  if (!desktopSupported()) return "unsupported";
  return Notification.permission;
}

export function enabledByUser(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setUserEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // private mode — toggle just won't persist
  }
}

/** Per-event notification switches; missing entries default to ON. */
export function getEventToggles(): Record<NotificationEvent, boolean> {
  const defaults = Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, true])) as Record<
    NotificationEvent,
    boolean
  >;
  try {
    const raw = localStorage.getItem(TOGGLES_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const e of NOTIFICATION_EVENTS) {
      if (typeof parsed[e] === "boolean") defaults[e] = parsed[e];
    }
  } catch {
    // corrupt storage — defaults
  }
  return defaults;
}

export function setEventEnabled(type: NotificationEvent, on: boolean): void {
  const toggles = getEventToggles();
  toggles[type] = on;
  try {
    localStorage.setItem(TOGGLES_KEY, JSON.stringify(toggles));
  } catch {
    // private mode — toggle just won't persist
  }
}

// ---------------------------------------------------------------------------
// Grave expiry watcher — countdown reminders for your graves.
// While the panel is open, polls the graves list every minute:
//   • First reminder announces the total retrieval time ("3 hours left")
//   • Reminder every 30 min as time runs down (2.5h, 2h, 1.5h, 1h, 30m)
//   • Final 30 min: repeated urgent warnings at 30/20/10/5 min marks
// ---------------------------------------------------------------------------

const GRAVE_WATCH_KEY = "panel_notif_graves_notified";

/** Milestones (ms of remaining time) at which a reminder fires. */
const GRAVE_REMINDER_MARKS_MS = [
  3 * 3_600_000,
  2.5 * 3_600_000,
  2 * 3_600_000,
  1.5 * 3_600_000,
  1 * 3_600_000,
  30 * 60_000,
  25 * 60_000,
  20 * 60_000,
  15 * 60_000,
  10 * 60_000,
  5 * 60_000,
];

/** Storage of which milestone (index) was already fired, per grave id. */
function readNotifiedGraves(): Record<string, number> {
  try {
    const raw = localStorage.getItem(GRAVE_WATCH_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // prune day-old entries
    for (const k of Object.keys(parsed)) if (parsed[k] < cutoff) delete parsed[k];
    return parsed;
  } catch {
    return {};
  }
}

/** Human string for a remaining duration: "3 hours", "45 minutes", "2 minutes". */
function humanRemaining(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins >= 120) return `${Math.round(mins / 60)} hours`;
  if (mins >= 90) return "1.5 hours";
  if (mins >= 60) return "1 hour";
  return `${mins} minute${mins === 1 ? "" : "s"}`;
}

/**
 * Check the signed-in player's active graves and fire countdown reminders.
 * A reminder fires when remaining time crosses the next milestone below the
 * last one notified: first contact announces total time, then every 30 min,
 * with the final 30 minutes tightening to 30/25/20/15/10/5-minute warnings.
 * Call this on an interval from the app shell.
 */
export async function checkGraveExpiry(myMcName: string | null): Promise<void> {
  if (!myMcName || !desktopSupported()) return;
  if (Notification.permission !== "granted" || !enabledByUser()) return;
  if (!getEventToggles().grave_expiring) return;
  try {
    const res = await fetch("/api/graves?status=active&pageSize=50", { credentials: "same-origin" });
    if (!res.ok) return;
    const data = (await res.json()) as {
      graves?: { id: number; playerName: string; status: string; remainingMs: number | null }[];
    };
    const notified = readNotifiedGraves();
    let changed = false;
    for (const g of data.graves ?? []) {
      if (g.playerName?.toLowerCase() !== myMcName.trim().toLowerCase()) continue;
      if (g.status !== "active" || g.remainingMs == null) continue;
      if (g.remainingMs <= 0) continue;

      const key = String(g.id);
      // Highest milestone at or below the remaining time (or "first contact").
      let dueIndex = -1;
      for (let i = 0; i < GRAVE_REMINDER_MARKS_MS.length; i++) {
        if (g.remainingMs <= GRAVE_REMINDER_MARKS_MS[i]) dueIndex = i;
        else break;
      }
      const last = notified[key];
      // Never notified → announce total time. Otherwise fire when we've
      // crossed into a strictly more urgent milestone than the last one.
      if (last !== undefined && dueIndex <= last) continue;
      notified[key] = dueIndex;
      changed = true;

      const urgent = g.remainingMs <= 30 * 60_000;
      showDesktopNotification(
        urgent ? "⚠ Grave despawning soon" : "Grave countdown",
        urgent
          ? `Only ${humanRemaining(g.remainingMs)} left to recover your grave — go now!`
          : `You have ${humanRemaining(g.remainingMs)} to retrieve your grave.`,
        `grave-expiry-${key}`,
        "grave_expiring",
      );
      // Mirror the countdown into the panel bell and the Discord queue so the
      // same milestones reach Discord (with an @mention) and the bell when the
      // panel is open — milestone state is tracked per grave, so no doubles.
      const minutesLeft = Math.max(1, Math.round(g.remainingMs / 60_000));
      const body =
        g.remainingMs <= 30 * 60_000
          ? `Only ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"} left to recover it — go now!`
          : `You have ${humanRemaining(g.remainingMs)} to retrieve it.`;
      void postApi("/api/notifications/mirror", {
        type: "grave_expiring",
        playerName: g.playerName,
        message: body,
        minutesLeft,
      });
    }
    if (changed) {
      try {
        localStorage.setItem(GRAVE_WATCH_KEY, JSON.stringify(notified));
      } catch {
        // private mode — the toast still fired; it may repeat next tick
      }
    }
  } catch {
    // graves endpoint unavailable (feature disabled etc.) — retry next tick
  }
}

export async function requestPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!desktopSupported()) return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/**
 * Fire a native toast. Silently no-ops when unsupported, not permitted,
 * toggled off, or muted for this event type. Clicking the toast focuses the
 * window (works in Electron too).
 */
export function showDesktopNotification(
  title: string,
  body: string,
  tag?: string,
  eventType?: string,
): void {
  if (!desktopSupported()) return;
  if (Notification.permission !== "granted" || !enabledByUser()) return;
  if (eventType) {
    const toggles = getEventToggles();
    if (toggles[eventType as NotificationEvent] === false) return;
  }
  try {
    const n = new Notification(title, { body, tag, silent: false });
    n.onclick = () => {
      window.focus();
      FOCUSABLE_WINDOW.electronAPI?.focusWindow?.();
      n.close();
    };
  } catch {
    // Page-triggered notifications don't need a ServiceWorker, but stay
    // non-fatal for exotic browsers regardless.
  }
}

/**
 * Map a raw realtime/SSE event type to a notification-catalog key.
 * - In-game chat arrives as `chat_message`; the user-facing toggle is
 *   "Player chat message" = `player_message`.
 * - Deaths arrive as `player_death`; split into "You died" vs "Other player
 *   died" by comparing the victim to the signed-in user's MC username.
 * Unknown types return null (not notable).
 */
export function normalizeNotifEvent(
  type: string,
  payload?: unknown,
  myMcName?: string | null,
): NotificationEvent | null {
  if (type === "chat_message") return "player_message";
  if (type === "player_death") {
    const who = ((payload as { playerName?: string | null } | null)?.playerName ?? "").trim().toLowerCase();
    if (myMcName && who && who === myMcName.trim().toLowerCase()) return "you_died";
    return "other_death";
  }
  return (NOTIFICATION_EVENTS as readonly string[]).includes(type) ? (type as NotificationEvent) : null;
}

/** Build a notification for a realtime event payload; null = not notable. */
export function notificationForEvent(type: string, payload: unknown): { title: string; body: string } | null {
  const p = (payload ?? {}) as { playerName?: string | null; message?: string | null };
  const who = p.playerName ?? "";
  const msg = p.message ?? "";
  switch (type) {
    case "server_start":
      return { title: "Server started", body: msg || "The Minecraft server is now online." };
    case "server_stop":
      return { title: "Server stopped", body: msg || "The Minecraft server went offline." };
    case "server_crash":
      return { title: "Server crashed", body: msg || "The Minecraft server process crashed. Check the console." };
    case "player_join":
      return { title: who ? `${who} joined` : "Player joined", body: "Joined the server." };
    case "player_leave":
      return { title: who ? `${who} left` : "Player left", body: "Left the server." };
    case "you_died":
      return { title: "You died", body: msg || "Your items are in a grave — recover them soon." };
    case "other_death":
      return { title: who ? `${who} died` : "A player died", body: msg || "Better luck next time." };
    case "grave_created":
      return { title: who ? `Grave created — ${who}` : "Grave created", body: msg || "Their items are waiting at the grave." };
    case "grave_expiring":
      return { title: "Your grave is expiring", body: msg || "Your grave is about to despawn — recover it in game." };
    case "player_message":
      return { title: who || "Chat", body: msg };
    default:
      return null;
  }
}
