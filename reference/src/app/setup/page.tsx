import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/config";
import { isSeeded } from "@/lib/seed";
import { ensureBootstrap } from "@/lib/bootstrap";
import SetupWizard from "./SetupWizard";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const configured = isConfigured();
  if (configured) {
    // On serverless (Netlify) a configured deployment must never show the
    // wizard: bootstrap first (region discovery + optional AUTO_SETUP seed).
    await ensureBootstrap().catch(() => undefined);
    if (await isSeeded().catch(() => false)) redirect("/login");
  }
  return <SetupWizard />;
}
