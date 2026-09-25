import React from "react";
import { api, setCsrfToken } from "@/lib/client/api";
import { useRealtime } from "@/lib/client/realtime";
import { McHead } from "@/components/ui";
import { PixelIconView, PanelMark, type IconName } from "@/components/icons";

export type NavItem =
  | "dashboard"
  | "console"
  | "players"
  | "graves"
  | "chat"
  | "activity"
  | "statistics"
  | "discord"
  | "settings";

const NAV: { id: NavItem; label: string; icon: IconName; roles?: string[] }[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "console", label: "Console", icon: "console", roles: ["admin", "moderator"] },
  { id: "players", label: "Players", icon: "players" },
  { id: "graves", label: "Graves", icon: "graves" },
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "activity", label: "Activity", icon: "activity" },
  { id: "statistics", label: "Statistics", icon: "statistics" },
  { id: "discord", label: "Discord", icon: "discord", roles: ["admin"] },
  { id: "settings", label: "Settings", icon: "settings" },
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
  features?: string[];
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
  activeTab,
  onTabChange,
  onLogout,
  children,
}: {
  initialUser: { username: string; role: string };
  activeTab: NavItem;
  onTabChange: (tab: NavItem) => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [me, setMe] = React.useState<Me | null>(null);
  const [navOpen, setNavOpen] = React.useState(false);
  const [notifOpen, setNotifOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<NotificationRow[]>([]);
  const [serverUp, setServerUp] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    api
      .get<Me>("/api/auth/me")
      .then((m) => {
        setMe(m);
        setCsrfToken(m.csrfToken);
      })
      .catch((err) => {
        if (err?.status === 401) {
          onLogout();
        }
      });

    api
      .get<{ notifications: NotificationRow[] }>("/api/notifications")
      .then((r) => setNotifications(r.notifications || []))
      .catch(() => undefined);
  }, []);

  useRealtime((type, payload) => {
    if (type === "status") {
      const p = payload as { status?: string; error?: string; minecraft?: { online?: boolean } };
      if (p && !p.error) {
        setServerUp(p.status === "running" || p.minecraft?.online === true);
      } else {
        setServerUp(null);
      }
    }
    if (type === "event") {
      api
        .get<{ notifications: NotificationRow[] }>("/api/notifications")
        .then((r) => setNotifications(r.notifications || []))
        .catch(() => undefined);
    }
  });

  async function logout() {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // non-fatal
    }
    setCsrfToken(null);
    onLogout();
  }

  const role = me?.user.role || initialUser.role;
  const enabled: string[] | null = me?.features || null;
  const nav = NAV.filter(
    (n) =>
      (!n.roles || n.roles.includes(role)) &&
      (!enabled || enabled.includes(n.id) || n.id === "dashboard" || n.id === "settings"),
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
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onTabChange(item.id);
                  setNavOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 4,
                  fontSize: 13.5,
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--text)" : "var(--text-dim)",
                  background: active ? "var(--accent-dim)" : "transparent",
                  border: active ? "1px solid rgba(85, 176, 104, 0.3)" : "1px solid transparent",
                  transition: "background 0.12s ease",
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <PixelIconView name={item.icon} size={17} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <McHead
              username={me?.user.mcUsername || me?.user.username || initialUser.username}
              headUrl={me?.user.headUrl}
              size={30}
            />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="ellipsis" style={{ fontSize: 13, fontWeight: 600 }}>
                {me?.user.username || initialUser.username}
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
                style={{ display: "none" }}
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
              <div style={{ position: "relative" }}>
                <button
                  className="btn sm ghost"
                  aria-label="Notifications"
                  onClick={() => setNotifOpen((v) => !v)}
                >
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
                        <div className="title" style={{ fontSize: 13 }}>
                          No notifications yet
                        </div>
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
    </div>
  );
}
