import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSessionFromCookieStore } from "@/lib/auth";
import { isConfigured } from "@/lib/config";
import { isSeeded } from "@/lib/seed";
import { ensureBootstrap } from "@/lib/bootstrap";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const configured = isConfigured();
  if (configured) {
    // Serverless (Netlify): reach the DB + seed from env before the check so a
    // fully env-configured deployment never bounces users to the setup wizard.
    await ensureBootstrap().catch(() => undefined);
  }
  const seeded = configured ? await isSeeded().catch(() => false) : false;

  if (!configured || !seeded) {
    redirect("/setup");
  }

  const store = await cookies();
  const session = await getSessionFromCookieStore(store);
  if (session) {
    redirect("/dashboard");
  }

  return <LoginForm />;
}
