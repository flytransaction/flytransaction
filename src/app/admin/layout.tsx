import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme";
import { requireAdmin } from "@/lib/security/guard";
import { logOut } from "@/features/auth/actions";

const links = [
  ["/admin", "Overview"], ["/admin/users", "Users"], ["/admin/plans", "Plans"], ["/admin/subscriptions", "Subscriptions"],
  ["/admin/billing-events", "Billing events"], ["/admin/audit-logs", "Audit logs"], ["/admin/settings", "Settings"],
] as const;

export const metadata = { title: { default: "Admin", template: "%s · Admin · Fly-Transaction" }, robots: { index: false } };

/** Server-side Super Admin gate for every /admin page (role comes from the database, not the client). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  return (
    <div className="min-h-screen">
      <header className="border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Logo href="/admin" /><span className="rounded-sm bg-muted px-2 py-0.5 text-xs font-medium">Admin</span>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="hidden text-muted-foreground sm:inline">{session.email}</span>
            <Link className="rounded-md px-3 py-1.5 hover:bg-muted" href="/dashboard">My ledger</Link>
            <ThemeToggle />
            <form action={logOut}><button className="rounded-md px-3 py-1.5 hover:bg-muted" type="submit">Log out</button></form>
          </div>
        </div>
        <nav aria-label="Admin" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2 text-sm">
          {links.map(([href, label]) => <Link key={href} className="whitespace-nowrap rounded-md px-3 py-1.5 hover:bg-muted" href={href}>{label}</Link>)}
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
