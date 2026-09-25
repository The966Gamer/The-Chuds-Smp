import React from "react";
import { api } from "@/lib/client/api";
import { useRealtime } from "@/lib/client/realtime";
import { McHead, Panel, EmptyState, SkeletonRows } from "@/components/ui";

interface Message {
  id: number;
  playerName: string;
  message: string;
  createdAt: string;
  headUrl: string | null;
}

export default function ChatView() {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [inputMsg, setInputMsg] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const stickBottom = React.useRef(true);

  const scrollToBottom = React.useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  React.useEffect(() => {
    api
      .get<{ messages: Message[]; hasMore: boolean }>("/api/chat?limit=50")
      .then((r) => {
        setMessages(r.messages || []);
        setHasMore(r.hasMore || false);
        setTimeout(() => scrollToBottom(false), 60);
      })
      .finally(() => setLoading(false));
  }, [scrollToBottom]);

  useRealtime((type, payload) => {
    if (type !== "event") return;
    const p = payload as { type?: string };
    if (p?.type === "chat_message") {
      api
        .get<{ messages: Message[] }>("/api/chat?limit=5")
        .then((r) => {
          setMessages((prev) => {
            const known = new Set(prev.map((m) => m.id));
            const fresh = (r.messages || []).filter((m) => !known.has(m.id));
            return [...prev, ...fresh].slice(-200);
          });
          if (stickBottom.current) setTimeout(() => scrollToBottom(), 40);
        })
        .catch(() => undefined);
    }
  });

  async function loadOlder() {
    if (messages.length === 0) return;
    setLoadingOlder(true);
    const oldest = messages[0]?.id;
    try {
      const r = await api.get<{ messages: Message[]; hasMore: boolean }>(
        `/api/chat?limit=50&before=${oldest}`,
      );
      setMessages((prev) => [...(r.messages || []), ...prev]);
      setHasMore(r.hasMore || false);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    const txt = inputMsg.trim();
    if (!txt || sending) return;
    setSending(true);
    try {
      await api.post("/api/chat", { message: txt });
      setInputMsg("");
      setTimeout(() => scrollToBottom(), 100);
    } catch {
      // non-fatal
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 20 }}>Chat</h1>
        <p className="dim" style={{ margin: 0, fontSize: 13 }}>
          Live Minecraft chat, relayed by the server integration.
        </p>
      </div>

      <Panel bodyStyle={{ padding: 0 }}>
        <div
          ref={scrollRef}
          style={{ height: "calc(100vh - 310px)", minHeight: 340, overflowY: "auto", padding: 16 }}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          }}
        >
          {loading ? (
            <SkeletonRows rows={6} />
          ) : messages.length === 0 ? (
            <EmptyState
              icon="chat"
              title="No chat yet"
              hint="Messages appear as players chat in-game. The integration streams CHAT_MESSAGE events to the panel."
            />
          ) : (
            <>
              {hasMore ? (
                <div style={{ textAlign: "center", marginBottom: 10 }}>
                  <button className="btn sm" onClick={loadOlder} disabled={loadingOlder}>
                    {loadingOlder ? "Loading…" : "Load older messages"}
                  </button>
                </div>
              ) : null}
              {messages.map((m) => (
                <div key={m.id} className="row" style={{ padding: "7px 0", alignItems: "flex-start" }}>
                  <McHead username={m.playerName} headUrl={m.headUrl} size={28} />
                  <div className="grow">
                    <span style={{ fontWeight: 600, fontSize: 13, marginRight: 8 }}>{m.playerName}</span>
                    <span style={{ fontSize: 13.5 }}>{m.message}</span>
                  </div>
                  <span className="faint" style={{ fontSize: 11, flexShrink: 0, marginTop: 3 }}>
                    {new Date(m.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        <form
          onSubmit={sendChat}
          style={{
            padding: "10px 14px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            gap: 10,
            background: "rgba(0,0,0,0.2)",
          }}
        >
          <input
            className="input"
            placeholder="Send message to Minecraft server (/say)..."
            value={inputMsg}
            onChange={(e) => setInputMsg(e.target.value)}
          />
          <button className="btn primary" disabled={sending || !inputMsg.trim()}>
            {sending ? <span className="spinner" /> : "Send"}
          </button>
        </form>
      </Panel>
    </div>
  );
}
