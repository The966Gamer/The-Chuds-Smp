import React from "react";
import { api, setCsrfToken, setAuthToken } from "@/lib/client/api";
import { PixelIconView } from "@/components/icons";

export default function LoginView({
  onLoginSuccess,
  onOpenSetup,
}: {
  onLoginSuccess: (user: { username: string; role: string }) => void;
  onOpenSetup?: () => void;
}) {
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<{ csrfToken: string; token?: string; user: { username: string; role: string } }>(
        "/api/auth/login",
        { username, password },
      );
      setCsrfToken(res.csrfToken);
      if (res.token) setAuthToken(res.token);
      onLoginSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div className="panel mc-hero-block fade-in" style={{ width: "min(400px, 100%)" }}>
        <div className="mc-hero-inner" style={{ padding: "10px 34px 34px" }}>
          <div style={{ textAlign: "center", marginBottom: 22 }}>
            <div style={{ display: "grid", placeItems: "center", marginBottom: 10 }}>
              <PixelIconView
                name="dashboard"
                size={56}
                className="bob glow"
                style={{ filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.5))" }}
              />
            </div>
            <h1 style={{ fontSize: 20 }}>Falix Control Panel</h1>
            <p className="dim" style={{ fontSize: 13 }}>
              The mines are waiting.
            </p>
          </div>

          {error ? (
            <div className="error-state" style={{ padding: 14, marginBottom: 14 }} role="alert">
              {error}
            </div>
          ) : null}

          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-dim)" }}>Username</span>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
                spellCheck={false}
                placeholder="SuperDuck220"
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-dim)" }}>Password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                placeholder="••••••••••••"
              />
            </label>
            <button className="btn primary" style={{ marginTop: 6, padding: "11px 18px" }} disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="faint" style={{ fontSize: 12, textAlign: "center", marginTop: 18 }}>
            Initial administrator: <span className="mono">SuperDuck220</span>
            <br />
            (password configured in setup or environment)
          </p>

          {onOpenSetup ? (
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button
                type="button"
                className="btn sm ghost"
                style={{ fontSize: 12, color: "var(--accent)" }}
                onClick={onOpenSetup}
              >
                ⚙ Run Setup Wizard
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
