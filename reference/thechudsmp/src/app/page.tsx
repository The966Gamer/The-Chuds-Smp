import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/config";
import { isSeeded } from "@/lib/seed";
import { ensureBootstrap } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

/**
 * Server-side first-run gate: fresh installs land on /setup, configured but
 * unseeded installs also complete setup, everything else goes to /login.
 *
 * On serverless hosts (Netlify) bootstrap runs first: it reaches the database
 * (region discovery) and, with AUTO_SETUP=true, migrates + seeds from env —
 * so a fully-env-configured deployment goes straight to /login and the setup
 * wizard never appears.
 */
export default async function Home() {
  if (isConfigured()) {
    await ensureBootstrap().catch(() => undefined);
    if (await isSeeded().catch(() => false)) redirect("/login");
    redirect("/setup");
  }
  redirect("/setup");
}
