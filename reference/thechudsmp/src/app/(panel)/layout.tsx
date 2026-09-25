import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSessionFromCookieStore } from "@/lib/auth";
import PanelShell from "./PanelShell";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const session = await getSessionFromCookieStore(store).catch(() => null);
  if (!session) {
    redirect("/login");
  }
  return (
    <PanelShell initialUser={{ username: session.user.usernameDisplay, role: session.user.role }}>
      {children}
    </PanelShell>
  );
}
