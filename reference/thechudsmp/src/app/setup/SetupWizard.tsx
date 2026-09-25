"use client";

import React from "react";
import { api } from "@/lib/client/api";

type Phase = "form" | "seeding" | "done";

const SEED_STEPS = [
  "Connecting to Falix...",
  "Connecting to database...",
  "Checking Minecraft server...",
  "Loading server information...",
  "Creating database tables...",
  "Seeding admin account...",
  "Importing initial server data...",
  "Finalizing setup...",
];

interface FormState {
  falixApiBase: string;
  falixApiKey: string;
  falixServerId: string;
  mcHost: string;
  mcPort: string;
  sbUrl: string;
  sbPublishableKey: string;
  sbSecretKey: string;
  sbDbPassword: string;
  rconPort: string;
  rconPassword: string;
  integrationSecret: string;
  discordWebhook: string;
  adminUsername: string;
  adminPassword: string;
  adminPassword2: string;
}

const INITIAL: FormState = {
  falixApiBase: "https://client.falixnodes.net/api/v2",
  falixApiKey: "",
  falixServerId: "",
  mcHost: "",
  mcPort: "25565",
  sbUrl: "",
  sbPublishableKey: "",
  sbSecretKey: "",
  sbDbPassword: "",
  rconPort: "",
  rconPassword: "",
  integrationSecret: "",
  discordWebhook: "",
  adminUsername: "SuperDuck220",
  adminPassword: "",
  adminPassword2: "",
};

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <h2 style={{ fontSize: 15 }}>{title}</h2>
        {subtitle ? <div className="dim" style={{ fontSize: 12.5 }}>{subtitle}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  required,
  autoComplete,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-dim)" }}>
        {label} {required ? <span style={{ color: "var(--danger)" }}>*</span> : null}
      </span>
      <input
        className="input"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        spellCheck={false}
      />
    </label>
  );
}

export default function SetupWizard() {
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [phase, setPhase] = React.useState<Phase>("form");
  const [stepIndex, setStepIndex] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  React.useEffect(() => {
    if (phase !== "seeding") return;
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      if (i < SEED_STEPS.length) setStepIndex(i);
    }, 650);
    return () => clearInterval(t);
  }, [phase]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.adminPassword !== form.adminPassword2) {
      setError("The admin passwords do not match.");
      return;
    }
    setBusy(true);
    setPhase("seeding");
    setStepIndex(0);
    try {
      await api.post("/api/setup", {
        falix: {
          apiBase: form.falixApiBase,
          apiKey: form.falixApiKey,
          serverId: form.falixServerId,
        },
        minecraft: { host: form.mcHost, port: form.mcPort },          supabase: {
            url: form.sbUrl,
            anonKey: form.sbPublishableKey,
            serviceKey: form.sbSecretKey,
            dbPassword: form.sbDbPassword || undefined,
          },
          rcon: form.rconPort || form.rconPassword ? { port: form.rconPort, password: form.rconPassword } : undefined,
          integrationSecret: form.integrationSecret || undefined,
          discordWebhook: form.discordWebhook || undefined,
        admin: {
          username: form.adminUsername,
          password: form.adminPassword,
        },
      });
      setStepIndex(SEED_STEPS.length - 1);
      setTimeout(() => setPhase("done"), 800);
    } catch (err) {
      setPhase("form");
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  if (phase === "done") {
    return (
      <main style={wrap}>
        <div className="panel fade-in" style={{ padding: 40, textAlign: "center", maxWidth: 440 }}>
          <div style={{ fontSize: 44, marginBottom: 8 }}>✅</div>
          <h1 style={{ fontSize: 22, marginBottom: 6 }}>Setup complete</h1>
          <p className="dim" style={{ marginBottom: 22 }}>
            The panel is configured and seeded. Redirecting you to the login screen...
          </p>
          <div className="spinner" style={{ margin: "0 auto" }} />
          <meta httpEquiv="refresh" content="2;url=/login" />
        </div>
      </main>
    );
  }

  if (phase === "seeding") {
    return (
      <main style={wrap}>
        <div className="panel fade-in" style={{ padding: 30, width: "min(480px, 100%)" }}>
          <h1 style={{ fontSize: 18, marginBottom: 16 }}>Running setup…</h1>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {SEED_STEPS.map((s, i) => (
              <div key={s} className="row" style={{ opacity: i <= stepIndex ? 1 : 0.35 }}>
                {i < stepIndex ? (
                  <span style={{ color: "var(--accent-strong)" }}>✔</span>
                ) : i === stepIndex ? (
                  <div className="spinner" />
                ) : (
                  <span className="faint">○</span>
                )}
                <span style={{ fontSize: 13.5 }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <div style={{ width: "min(760px, 100%)", display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="mc-grass-strip" aria-hidden="true" style={{ borderRadius: 4 }} />
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <h1 style={{ fontSize: 24 }}>Welcome to your Control Panel</h1>
          <p className="dim">First-run setup — connect the panel to Falix, Minecraft and Supabase.</p>
        </div>

        {error ? (
          <div className="error-state" role="alert">
            <div style={{ fontWeight: 600 }}>Setup could not continue</div>
            <div style={{ fontSize: 13 }}>{error}</div>
          </div>
        ) : null}

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Section title="Falix" subtitle="API credentials for the Falix v2 API. Create a key in your Falix dashboard under API → Manage keys.">
            <Field label="Falix API URL" value={form.falixApiBase} onChange={set("falixApiBase")} required />
            <Field label="Falix API key" type="password" value={form.falixApiKey} onChange={set("falixApiKey")} placeholder="falix_..." required autoComplete="off" />
            <Field label="Falix server ID" value={form.falixServerId} onChange={set("falixServerId")} placeholder="12345" required autoComplete="off" />
          </Section>

          <Section title="Minecraft" subtitle="The public address players use to join. Used for live status queries.">
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
              <Field label="Server host" value={form.mcHost} onChange={set("mcHost")} placeholder="play.example.com" required />
              <Field label="Server port" value={form.mcPort} onChange={set("mcPort")} required />
            </div>
          </Section>

          <Section
            title="Supabase"
            subtitle="Database for users, sessions, events and more. New projects use Publishable + Secret keys; older projects still use anon + service_role — both work."
          >
            <Field label="Supabase URL" value={form.sbUrl} onChange={set("sbUrl")} placeholder="https://xxxx.supabase.co" required />
            <Field
              label="Publishable key (or legacy anon key)"
              value={form.sbPublishableKey}
              onChange={set("sbPublishableKey")}
              placeholder="sb_publishable_…"
              required
            />
            <Field
              label="Secret key (or legacy service_role key)"
              type="password"
              value={form.sbSecretKey}
              onChange={set("sbSecretKey")}
              placeholder="sb_secret_…"
              required
              autoComplete="off"
            />
            <Field
              label="Database password (recommended)"
              type="password"
              value={form.sbDbPassword}
              onChange={set("sbDbPassword")}
              autoComplete="off"
            />
            <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
              The <strong>database password</strong> from Supabase → Settings → Database — NOT the service-role key.
              The panel discovers your project's region automatically. Alternatively set
              <code className="mono"> DATABASE_URL </code> in .env.
            </div>
          </Section>

          <Section title="Optional integration" subtitle="RCON fallback and the panel ↔ Minecraft-mod shared secret.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
              <Field label="RCON port" value={form.rconPort} onChange={set("rconPort")} placeholder="25575" />
              <Field label="RCON password" type="password" value={form.rconPassword} onChange={set("rconPassword")} autoComplete="off" />
            </div>
            <Field
              label="Integration secret key"
              type="password"
              value={form.integrationSecret}
              onChange={set("integrationSecret")}
              placeholder="openssl rand -hex 32"
              autoComplete="off"
            />
            <Field
              label="Discord webhook URL (optional)"
              value={form.discordWebhook}
              onChange={set("discordWebhook")}
              placeholder="https://discord.com/api/webhooks/…"
              autoComplete="off"
            />
            <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
              Server alerts (joins, deaths, graves, crashes) are posted to this channel. You can change it later in the Discord tab.
            </div>
          </Section>

          <Section title="Admin account" subtitle="This creates the first administrator for the panel.">
            <Field label="Username" value={form.adminUsername} onChange={set("adminUsername")} required />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Password" type="password" value={form.adminPassword} onChange={set("adminPassword")} required autoComplete="new-password" />
              <Field label="Confirm password" type="password" value={form.adminPassword2} onChange={set("adminPassword2")} required autoComplete="new-password" />
            </div>
            <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
              Minimum 10 characters. Stored only as an argon2id hash — never in plaintext.
            </div>
          </Section>

          <button className="btn primary" style={{ padding: "12px 20px", fontSize: 14 }} disabled={busy}>
            {busy ? "Validating connections…" : "Validate & finish setup"}
          </button>
        </form>
      </div>
    </main>
  );
}

const wrap: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "40px 16px",
};
