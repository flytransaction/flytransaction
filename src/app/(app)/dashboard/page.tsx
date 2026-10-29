import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { Card, CardContent, Skeleton } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Money, Outstanding } from "@/components/money-display";
import { Pagination, withParams } from "@/components/pagination";
import { Input } from "@/components/ui/form";
import { PeopleTable } from "@/features/people/people-table";
import { PAGE_SIZE, getDashboardSummary, listPeople, recentTransactions } from "@/features/people/queries";
import { requireAccess } from "@/lib/security/guard";
import { formatDate } from "@/lib/utils";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

async function SummaryCards({ currency }: { currency: string }) {
  const s = await getDashboardSummary();
  const totals = s.totals.length ? s.totals : [{ currency, total_received: "0.00", total_given: "0.00", outstanding: "0.00" }];
  const Stack = ({ children }: { children: React.ReactNode }) => <div className="space-y-1 text-2xl font-semibold tracking-tight">{children}</div>;
  return (
    <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card><CardContent className="p-5"><p className="mb-2 text-sm text-muted-foreground">Total money received</p><Stack>{totals.map((t) => <Money key={t.currency} value={t.total_received} currency={t.currency} className="block text-received" />)}</Stack></CardContent></Card>
      <Card><CardContent className="p-5"><p className="mb-2 text-sm text-muted-foreground">Total money given / advances</p><Stack>{totals.map((t) => <Money key={t.currency} value={t.total_given} currency={t.currency} className="block text-given" />)}</Stack></CardContent></Card>
      <Card><CardContent className="p-5"><p className="mb-2 text-sm text-muted-foreground">Net outstanding</p><div className="space-y-2 text-xl">{totals.map((t) => <Outstanding key={t.currency} value={t.outstanding} currency={t.currency} />)}</div></CardContent></Card>
      <Card><CardContent className="p-5"><p className="mb-2 text-sm text-muted-foreground">People</p><p className="flex items-center gap-2 text-3xl font-semibold tracking-tight"><Users className="h-6 w-6 text-muted-foreground" aria-hidden />{s.people_count}</p></CardContent></Card>
    </section>
  );
}

async function Recent() {
  const rows = await recentTransactions(6);
  return (
    <section aria-labelledby="recent-h" className="mt-10">
      <div className="mb-3 flex items-center justify-between"><h2 id="recent-h" className="text-lg font-semibold">Recent transactions</h2><Link className="text-sm underline" href="/dashboard/transactions">View all</Link></div>
      {rows.length === 0 ? <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Nothing recorded yet.</p> : (
        <ul className="divide-y rounded-lg border bg-card">
          {rows.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0"><Link href={`/dashboard/people/${t.person_id}`} className="font-medium hover:underline">{t.person_name}</Link><p className="truncate text-xs text-muted-foreground">{formatDate(t.transaction_date)}{t.note ? ` · ${t.note}` : ""}</p></div>
              <Money value={t.amount} currency={t.currency} className={`font-medium ${t.status === "voided" ? "text-muted-foreground line-through" : t.transaction_type === "received" ? "text-received" : "text-given"}`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireAccess();
  const currency = ctx.profile.default_currency;
  const { rows, total, query } = await listPeople(sp, currency);
  const searching = Boolean(query.q);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <Link href="/dashboard/people/new" className={buttonVariants()}><Plus className="h-4 w-4" aria-hidden />Add New Person</Link>
      </div>

      <Suspense fallback={<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>}>
        <SummaryCards currency={currency} />
      </Suspense>

      <section aria-labelledby="people-h">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="people-h" className="text-lg font-semibold">People</h2>
          <form action="/dashboard" role="search" className="flex gap-2">
            <label htmlFor="people-q" className="sr-only">Search people</label>
            <Input id="people-q" name="q" type="search" defaultValue={query.q} placeholder="Search by name, phone or email" className="w-64" />
          </form>
        </div>
        {rows.length === 0 ? (
          <div className="rounded-lg border bg-card p-10 text-center">
            <p className="font-medium">{searching ? "No one matches that search." : "No people yet."}</p>
            <p className="mt-1 text-sm text-muted-foreground">{searching ? "Try a different name, phone or email." : "Add your first person to start recording payments and advances."}</p>
            {searching ? <Link className="mt-4 inline-block text-sm underline" href="/dashboard">Clear search</Link> : <Link className={buttonVariants({ className: "mt-4" })} href="/dashboard/people/new">Add New Person</Link>}
          </div>
        ) : (
          <>
            <PeopleTable rows={rows} sort={query.sort} dir={query.dir} query={sp} defaultCurrency={currency} />
            <Pagination page={query.page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => withParams("/dashboard", sp, { page: String(p) })} />
          </>
        )}
      </section>

      <Suspense fallback={<Skeleton className="h-48" />}><Recent /></Suspense>
    </div>
  );
}
