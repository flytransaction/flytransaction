import Link from "next/link";
import { Bell, Search, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme";
import { Badge } from "@/components/ui/card";
import { logOut } from "@/features/auth/actions";
import type { AccessContext } from "@/lib/security/guard";
import { formatDate } from "@/lib/utils";

function subscriptionBadge(ctx: AccessContext) {
  const sub = ctx.subscription;
  if (!ctx.access.allowed) return <Link href="/subscription-expired"><Badge tone="danger">Subscription inactive</Badge></Link>;
  if (sub?.status === "past_due") return <Link href="/settings/subscription"><Badge tone="warning">Payment failed</Badge></Link>;
  if (sub?.cancel_at_period_end) return <Link href="/settings/subscription"><Badge tone="warning">Ends {formatDate(sub.current_period_end)}</Badge></Link>;
  return <Link href="/settings/subscription"><Badge tone="received">Active</Badge></Link>;
}

export function AppHeader({ ctx, defaultQuery }: { ctx: AccessContext; defaultQuery?: string }) {
  const initials = (ctx.profile.full_name || ctx.email || "?").trim().slice(0, 1).toUpperCase();
  return (
    <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
        <Logo href="/dashboard" />
        <form action="/dashboard" role="search" className="relative ml-2 hidden flex-1 md:block md:max-w-sm">
          <label htmlFor="global-search" className="sr-only">Search people</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            id="global-search" name="q" type="search" defaultValue={defaultQuery} placeholder="Search people by name, phone or email"
            className="h-10 w-full rounded-md border border-input bg-card pl-9 pr-3 text-sm placeholder:text-muted-foreground"
          />
        </form>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="hidden items-center gap-1.5 sm:flex"><Bell className="h-4 w-4 text-muted-foreground" aria-hidden /><span className="sr-only">Subscription status:</span>{subscriptionBadge(ctx)}</span>
          <ThemeToggle />
          <details className="relative">
            <summary
              aria-label="Account menu"
              className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border bg-card text-sm font-semibold [&::-webkit-details-marker]:hidden"
            >{initials}</summary>
            <div className="absolute right-0 mt-2 w-60 rounded-lg border bg-card p-1.5 text-sm shadow-lg">
              <div className="px-3 py-2">
                <p className="truncate font-medium">{ctx.profile.full_name || "Your account"}</p>
                <p className="truncate text-xs text-muted-foreground">{ctx.email}</p>
              </div>
              <hr className="my-1" />
              <Link className="block rounded-md px-3 py-2 hover:bg-muted" href="/settings/profile">Profile</Link>
              <Link className="block rounded-md px-3 py-2 hover:bg-muted" href="/settings/security">Security</Link>
              <Link className="block rounded-md px-3 py-2 hover:bg-muted" href="/settings/subscription">Subscription</Link>
              <Link className="block rounded-md px-3 py-2 hover:bg-muted" href="/dashboard/export">Export data</Link>
              {ctx.profile.role === "super_admin" ? (
                <Link className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-muted" href="/admin"><ShieldCheck className="h-4 w-4" aria-hidden />Admin</Link>
              ) : null}
              <hr className="my-1" />
              <form action={logOut}><button type="submit" className="w-full rounded-md px-3 py-2 text-left hover:bg-muted">Log out</button></form>
            </div>
          </details>
        </div>
      </div>
      <nav aria-label="Primary" className="mx-auto flex max-w-6xl gap-1 px-4 pb-2 text-sm">
        <Link className="rounded-md px-3 py-1.5 hover:bg-muted" href="/dashboard">People</Link>
        <Link className="rounded-md px-3 py-1.5 hover:bg-muted" href="/dashboard/transactions">Transactions</Link>
        <Link className="rounded-md px-3 py-1.5 hover:bg-muted" href="/dashboard/export">Export</Link>
      </nav>
    </header>
  );
}
