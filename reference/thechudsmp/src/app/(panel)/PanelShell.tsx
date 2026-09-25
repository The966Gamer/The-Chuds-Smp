"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, setCsrfToken } from "@/lib/client/api";
import { useRealtime } from "@/lib/client/realtime";
import {
  checkGraveExpiry,
  desktopSupported,
  enabledByUser,
  getEventToggles,
  normalizeNotifEvent,
  notificationForEvent,
  permissionState,
  requestPermission,
  runningInElectron,
  setUserEnabled,
  showDesktopNotification,
} from "@/lib/client/desktopNotifications";
import { McHead } from "@/components/ui";
import { PixelIconView, PanelMark, type IconName } from "@/components/icons";

const NAV: { href: string; label: string; icon: IconName; roles?: string[] }[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/console", label: "Console", icon: "console", roles: ["admin", "moderator"] },
  { href: "/players", label: "Players", icon: "players" },
  { href: "/graves", label: "Graves", icon: "graves" },
  { href: "/chat", label: "Chat", icon: "chat" },
  { href: "/activity", label: "Activity", icon: "activity" },
  { href: "/statistics", label: "Statistics", icon: "statistics" },
  { href: "/discord", label: "Discord", icon: "discord", roles: ["admin"] },
  { href: "/settings", label: "Settings", icon: "settings" },
];

interface Me {
  user: {
    id: string;
    username: string;
    role: "player" | "moderator" | "admin";
    mcUsername: string | null;
    headUrl: string | null;
  };
  csrfToken: string;
  /** Panel sections the admin has enabled; absent = all enabled. */
  features?: string[];
  /** Per-user server power grant: full | start | none. */
  powerScope?: "full" | "start" | "none";
}

interface NotificationRow {
  id: number;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
}

export default function PanelShell({
  initialUser,
  children,
}: {
  initialUser: { username: string; role: "player" | "moderator" | "admin" };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = React.useState<Me | null>(null);
  const [navOpen, setNavOpen] = React.useState(false);
  const [notifOpen, setNotifOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<NotificationRow[]>([]);
  const [serverUp, setServerUp] = React.useState<boolean | null>(null);
  const [desktopState, setDesktopState] = React.useState<"unsupported" | NotificationPermission>("default");

  React.useEffect(() => {
    api
      .get<Me>("/api/auth/me")
      .then((m) => {
        setMe(m);
        setCsrfToken(m.csrfToken);
      })
      .catch(() => {
        router.replace("/login");
      });
    api
      .get<{ notifications: NotificationRow[] }>("/api/notifications")
      .then((r) => setNotifications(r.notifications))
      .catch(() => undefined);
  }, [router]);

  React.useEffect(() => {
    setDesktopState(desktopSupported() ? Notification.permission : "unsupported");
  }, []);

  // Grave-expiry watcher: warn when one of my graves has <10 min left.
  React.useEffect(() => {
    const myName = me?.user.mcUsername;
    if (!myName) return;
    const tick = () => checkGraveExpiry(myName);
    void tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [me?.user.mcUsername]);

  useRealtime((type, payload) => {
    if (type === "status") {
      const p = payload as { status?: string; error?: string };
      setServerUp(p && !p.error ? (p.status as string) === "running" : null);
    }
    if (type === "event") {
      // Native toast per the user's per-event settings (deaths, graves,
      // crashes, power, joins, chat). The SSE frame is `event` with the real
      // type inside the payload.
      const p = payload as { type?: string };
      const evt = p?.type ? normalizeNotifEvent(p.type, payload, me?.user.mcUsername ?? null) : null;
      if (evt && getEventToggles()[evt]) {
        const note = notificationForEvent(evt, payload);
        if (note) showDesktopNotification(note.title, note.body, `evt-${Date.now()}`, evt);
      }
      api
        .get<{ notifications: NotificationRow[] }>("/api/notifications")
        .then((r) => setNotifications(r.notifications))
        .catch(() => undefined);
    }
  });

  async function toggleDesktopNotifications() {
    if (!desktopSupported()) return;
    if (!enabledByUser() || Notification.permission === "default") {
      const res = await requestPermission();
      setDesktopState(res === "unsupported" ? "unsupported" : res);
      setUserEnabled(res === "granted");
    } else {
      setUserEnabled(!enabledByUser());
    }
  }

  async function logout() {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // session may already be gone
    }
    setCsrfToken(null);
    router.replace("/login");
  }

  const role = me?.user.role ?? initialUser.role;
  const enabled: string[] | null = me?.features ?? null;
  const nav = NAV.filter(
    (n) =>
      (!n.roles || n.roles.includes(role)) &&
      (!enabled || enabled.includes(n.href.slice(1)) || n.href === "/dashboard" || n.href === "/settings"),
  );
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        className={`sidebar ${navOpen ? "open" : ""}`}
        style={{
          width: 232,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          position: "sticky",
          top: 0,
          height: "100vh",
          zIndex: 40,
          background: "var(--bg-panel-solid)",
          borderRight: "1px solid var(--border)",
        }}
      >
        <div className="row" style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", gap: 10 }}>
          <PanelMark size={32} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Falix Panel</div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 1 }}>Minecraft control center</div>
          </div>
        </div>
        <div className="mc-grass-strip" aria-hidden="true" />
        <nav style={{ flex: 1, padding: 10, display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setNavOpen(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 8,
                  fontSize: 13.5,
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--text)" : "var(--text-dim)",
                  background: active ? "var(--accent-dim)" : "transparent",
                  border: active ? "1px solid rgba(85, 176, 104, 0.3)" : "1px solid transparent",
                  transition: "background 0.12s ease",
                }}
              >
                <PixelIconView name={item.icon} size={17} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <McHead username={me?.user.mcUsername ?? me?.user.username ?? "MHF_Steve"} headUrl={me?.user.headUrl} size={30} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="ellipsis" style={{ fontSize: 13, fontWeight: 600 }}>
                {me?.user.username ?? initialUser.username}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-faint)", textTransform: "capitalize" }}>{role}</div>
            </div>
          </div>
          <button className="btn sm ghost" style={{ width: "100%" }} onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          className="panel"
          style={{
            borderRadius: 0,
            borderLeft: "none",
            borderRight: "none",
            borderTop: "none",
            position: "sticky",
            top: 0,
            zIndex: 30,
            padding: "10px 18px",
          }}
        >
          <div className="spread">
            <div className="row">
              <button
                className="btn sm ghost nav-toggle"
                aria-label="Toggle navigation"
                onClick={() => setNavOpen((v) => !v)}
              >
                ☰
              </button>
              <span
                className="row"
                style={{ fontSize: 12, gap: 7, color: "var(--text-dim)" }}
                title={
                  serverUp === null
                    ? "Checking Minecraft server…"
                    : serverUp
                      ? "Minecraft server online"
                      : "Minecraft server offline"
                }
              >
                <span className={`dot ${serverUp === null ? "gray" : serverUp ? "green" : "red"}`} />
                Panel online · Minecraft {serverUp === null ? "checking…" : serverUp ? "online" : "offline"}
              </span>
            </div>
            <div className="row">
              {desktopState !== "unsupported" ? (
                <button
                  className="btn sm ghost"
                  aria-label="Toggle desktop notifications"
                  title={
                    desktopState === "granted"
                      ? enabledByUser()
                        ? "Desktop notifications are ON — click to mute"
                        : "Desktop notifications are muted — click to enable"
                      : "Enable desktop notifications"
                  }
                  onClick={toggleDesktopNotifications}
                >
                  <PixelIconView name="bell" size={16} style={{ opacity: desktopState === "granted" && enabledByUser() ? 1 : 0.4 }} />
                </button>
              ) : null}
              <div style={{ position: "relative" }}>
                <button className="btn sm ghost" aria-label="Notifications" onClick={() => setNotifOpen((v) => !v)}>
                  <PixelIconView name="bell" size={16} />
                  {unread > 0 ? (
                    <span className="badge red" style={{ padding: "1px 7px", marginLeft: 4 }}>
                      {unread}
                    </span>
                  ) : null}
                </button>
                {notifOpen ? (
                  <div
                    className="panel fade-in"
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 40,
                      width: 320,
                      maxHeight: 400,
                      overflowY: "auto",
                      zIndex: 50,
                      background: "var(--bg-panel-solid)",
                    }}
                  >
                    <div className="spread" style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                      <strong style={{ fontSize: 13 }}>Notifications</strong>
                      <button
                        className="btn sm ghost"
                        onClick={async () => {
                          await api.post("/api/notifications").catch(() => undefined);
                          setNotifications((rows) => rows.map((r) => ({ ...r, read: true })));
                        }}
                      >
                        Mark all read
                      </button>
                    </div>
                    {notifications.length === 0 ? (
                      <div className="empty-state" style={{ padding: 22 }}>
                        <div className="title" style={{ fontSize: 13 }}>No notifications yet</div>
                        <div className="hint">Deaths, graves and server events will appear here.</div>
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          style={{
                            padding: "10px 14px",
                            borderBottom: "1px solid var(--border)",
                            background: n.read ? "transparent" : "rgba(85, 176, 104, 0.05)",
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{n.title}</div>
                          {n.body ? <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{n.body}</div> : null}
                          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>
                            {new Date(n.created_at).toLocaleString()}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>
        <main style={{ padding: 20, flex: 1, minWidth: 0 }}>{children}</main>
      </div>

      <style jsx global>{`
        @media (max-width: 900px) {
          aside.sidebar {
            position: fixed !important;
            left: -240px;
            transition: left 0.2s ease;
            box-shadow: 0 0 40px rgba(0, 0, 0, 0.5);
          }
          aside.sidebar.open {
            left: 0;
          }
          .nav-toggle {
            display: inline-flex !important;
          }
        }
      `}</style>
    </div>
  );
}
