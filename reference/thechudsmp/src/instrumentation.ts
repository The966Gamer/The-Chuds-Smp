import { ensureBootstrap } from "@/lib/bootstrap";
import { ensureDiscordWorker } from "@/lib/discord";
import { ensureDiscordBot } from "@/lib/discordBot";

/**
 * Next.js instrumentation hook — runs once when the server process boots.
 *
 * 1. Bootstraps the database on serverless hosts (Netlify): discovers the
 *    Supabase pooler region (which cannot be cached on a read-only filesystem)
 *    and, with AUTO_SETUP=true, applies migrations and creates the admin
 *    account from env (PANEL_ADMIN_USERNAME / PANEL_ADMIN_PASSWORD). This is
 *    what lets a Netlify deployment skip the setup wizard entirely — the app
 *    is configured+seeded purely from environment variables.
 * 2. Starts the Discord queue worker at startup so queued notifications
 *    (deaths, graves, server events) are delivered even when no browser is
 *    open. Previously the worker only started when someone loaded the panel's
 *    realtime stream, which silently dropped notifications otherwise.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await ensureBootstrap().catch((e) => {
    console.warn("[instrumentation] auto-setup skipped:", e instanceof Error ? e.message : e);
  });
  ensureDiscordWorker();
  // Discord bot (slash-command server control over RCON) when a token is set.
  ensureDiscordBot();
}
