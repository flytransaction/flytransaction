import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { getAccess } from "@/lib/security/guard";

/** Everything under (app) needs a signed-in user. Subscription gating is added by /dashboard's own layout. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAccess();
  if (!ctx) redirect("/login");
  return (
    <>
      <AppHeader ctx={ctx} />
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </>
  );
}
