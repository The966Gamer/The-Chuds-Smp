import React from "react";
import { api } from "@/lib/client/api";
import { useRealtime } from "@/lib/client/realtime";
import { Panel, EmptyState } from "@/components/ui";

interface Line {
  raw: string;
  time: string | null;
  text: string;
  level: "info" | "warn" | "error";
}

function parseLine(raw: string): Line {
  const m = raw.match(/\[(\d{1,2}:\d{2}:\d{2})\]\s*\[([^\]]+)\]:\s?(.*)$/);
  if (m) {
    const levelRaw = m[2].toLowerCase();
    const level: Line["level"] =
      /error|severe|fatal/.test(levelRaw) || /error|exception|failed/i.test(m[3])
        ? "error"
        : /warn|warning/.test(levelRaw)
          ? "warn"
          : "info";
    return { raw, time: m[1], text: m[3], level };
  }
  const level: Line["level"] = /error|exception|severe|fatal/i.test(raw)
    ? "error"
    : /warn/i.test(raw)
      ? "warn"
      : "info";
  return { raw, time: null, text: raw, level };
}

const COLORS: Record<Line["level"], string> = {
  info: "var(--text-dim)",
  warn: "var(--warn)",
  error: "#f08a85",
};

export default function ConsoleView() {
  const [lines, setLines] = React.useState<Line[]>([]);
  const [search, setSearch] = React.useState("");
  const [autoscroll, setAutoscroll] = React.useState(true);
  const [command, setCommand] = React.useState("");
  const [history, setHistory] = React.useState<string[]>([]);
  const [histIdx, setHistIdx] = React.useState(-1);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [source, setSource] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [connError, setConnError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api
      .get<{ lines: string[]; source: string | null }>("/api/console?lines=50")
      .then((r) => {
        setLines((r.lines || []).map(parseLine));
        setSource(r.source);
        setConnError(null);
      })
      .catch((e) => setConnError(e instanceof Error ? e.message : "Failed to load console"));
  }, []);

  useRealtime((type, payload) => {
    if (type !== "console") return;
    const p = payload as { lines?: string[]; error?: string; source?: string | null };
    if (p.error) {
      setConnError(p.error);
      return;
    }
    setConnError(null);
    if (Array.isArray(p.lines)) {
      setLines(p.lines.map(parseLine));
      setSource(p.source ?? null);
    }
  });

  React.useEffect(() => {
    if (autoscroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoscroll]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/console/command", { command: cmd });
      setHistory((h) => [cmd, ...h.filter((x) => x !== cmd)].slice(0, 30));
      setCommand("");
      setHistIdx(-1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Command failed");
    } finally {
      setBusy(false);
    }
  }

  const filtered = search
    ? lines.filter((l) => l.raw.toLowerCase().includes(search.toLowerCase()))
    : lines;

  return (
    <div>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 20 }}>Console</h1>
          <p className="dim" style={{ margin: 0, fontSize: 13 }}>
            Live server output{source ? <span className="faint"> · source: {source}</span> : null}
          </p>
        </div>
        <button className="btn sm" onClick={() => setAutoscroll((v) => !v)}>
          {autoscroll ? "⏸ Pause scroll" : "▶ Resume scroll"}
        </button>
      </div>

      {connError ? (
        <div
          className="panel"
          style={{
            padding: 14,
            marginBottom: 12,
            borderColor: "rgba(224, 168, 60, 0.4)",
            background: "var(--warn-dim)",
            fontSize: 13,
          }}
        >
          Console stream notice: {connError}
          <span className="faint"> — Retrying. Ensure the Minecraft server or Falix API is active.</span>
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 300px",
          gap: 14,
          alignItems: "start",
        }}
      >
        <Panel
          title="Output"
          actions={
            <input
              className="input"
              style={{ width: 200, padding: "5px 10px", fontSize: 12 }}
              placeholder="Search output…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          }
          bodyStyle={{ padding: 0 }}
        >
          <div
            ref={scrollRef}
            className="mono mc-dirt-bed"
            style={{
              height: "calc(100vh - 320px)",
              minHeight: 320,
              overflowY: "auto",
              padding: 14,
              fontSize: 12,
              lineHeight: 1.65,
              borderRadius: "0 0 var(--radius) var(--radius)",
            }}
            onWheel={() => setAutoscroll(false)}
          >
            {filtered.length === 0 ? (
              <EmptyState
                icon="console"
                title={search ? "No matching lines" : "No console output yet"}
                hint={
                  search
                    ? "Try a different search term."
                    : "Output appears when the server writes to its log. Start the server to begin."
                }
              />
            ) : (
              filtered.map((l, i) => (
                <div key={i} style={{ display: "flex", gap: 10 }}>
                  <span className="faint" style={{ flexShrink: 0 }}>
                    {l.time ?? "·····"}
                  </span>
                  <span style={{ color: COLORS[l.level], wordBreak: "break-word" }}>{l.text}</span>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel title="Command">
          <form onSubmit={send} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              className="input mono"
              placeholder="/say hello"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  const next = Math.min(histIdx + 1, history.length - 1);
                  if (next >= 0) {
                    setHistIdx(next);
                    setCommand(history[next]);
                  }
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  const next = histIdx - 1;
                  setHistIdx(next);
                  setCommand(next >= 0 ? history[next] : "");
                }
              }}
              spellCheck={false}
            />
            <button className="btn primary" disabled={busy || !command.trim()}>
              {busy ? <span className="spinner" /> : "Send Command"}
            </button>
            {error ? <div style={{ fontSize: 12, color: "var(--danger)" }}>{error}</div> : null}
            <div className="faint" style={{ fontSize: 11.5 }}>
              Commands execute directly on the server console (via Falix or RCON). Arrow keys ↑/↓ navigate history.
            </div>
            {history.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div className="panel-title" style={{ fontSize: 10.5 }}>
                  Recent
                </div>
                {history.slice(0, 6).map((h, i) => (
                  <button
                    key={i}
                    type="button"
                    className="btn sm ghost mono"
                    style={{ justifyContent: "flex-start", fontSize: 11.5 }}
                    onClick={() => setCommand(h)}
                  >
                    {h}
                  </button>
                ))}
              </div>
            ) : null}
          </form>
        </Panel>
      </div>
    </div>
  );
}
