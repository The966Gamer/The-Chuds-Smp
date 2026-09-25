import { NextRequest } from "next/server";
import { auth } from "@/lib/api";
import { subscribe, ensurePollLoops, type RealtimeMessage } from "@/lib/realtime";
import { ensureDiscordWorker } from "@/lib/discord";
import { getConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await auth(req);
  if (!ctx) {
    return new Response("unauthorized", { status: 401 });
  }
  const config = getConfig();
  if (!config.FALIX_SERVER_ID) {
    return new Response("not configured", { status: 503 });
  }
  ensurePollLoops();
  ensureDiscordWorker();

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (msg: RealtimeMessage) => {
        try {
          controller.enqueue(encoder.encode(`event: ${msg.type}\ndata: ${JSON.stringify(msg.payload)}\n\n`));
        } catch {
          // stream closed
        }
      };
      unsubscribe = subscribe(send);
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          // stream closed
        }
      }, 25_000);
      req.signal.addEventListener("abort", () => {
        unsubscribe?.();
        if (keepAlive) clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      unsubscribe?.();
      if (keepAlive) clearInterval(keepAlive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
