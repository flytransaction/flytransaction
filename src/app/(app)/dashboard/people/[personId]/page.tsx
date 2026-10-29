import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Money, Outstanding } from "@/components/money-display";
import { Pagination, withParams } from "@/components/pagination";
import { TransactionFilters } from "@/components/filter-form";
import { getPerson } from "@/features/people/queries";
import { LEDGER_PAGE_SIZE, getLedger, getPersonTotals } from "@/features/transactions/queries";
import { AddTransactionButton } from "@/features/transactions/components";
import { LedgerTable } from "@/features/transactions/ledger-table";
import { requireAccess } from "@/lib/security/guard";
import { createClient } from "@/lib/supabase/server";
import { todayInTimeZone } from "@/lib/money";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export default async function PersonPage({ params, searchParams }: { params: Promise<{ personId: string }>; searchParams: Promise<SP> }) {
  const [{ personId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireAccess();
  const person = await getPerson(personId); // RLS: another user's id => null => 404
  if (!person) notFound();

  const supabase = await createClient();
  const [totals, ledger, { data: cur }] = await Promise.all([
    getPersonTotals(person.id),
    getLedger(person.id, sp),
    supabase.from("app_settings").select("value").eq("key", "supported_currencies").maybeSingle(),
  ]);
  const currencies = Array.isArray(cur?.value) ? (cur.value as string[]) : [ctx.profile.default_currency];
  const shown = totals.length ? totals : [{ currency: ctx.profile.default_currency, total_received: "0.00", total_given: "0.00", outstanding: "0.00" }];
  const today = todayInTimeZone(ctx.profile.time_zone);
  const f = ledger.filters;
  const exportQs = new URLSearchParams({ personId: person.id, ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}), ...(f.type ? { type: f.type } : {}) }).toString();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard" className="text-sm text-muted-foreground underline">← All people</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{person.name}</h1>
          <p className="text-sm text-muted-foreground">{[person.phone, person.email].filter(Boolean).join(" · ")}</p>
          {person.notes ? <p className="mt-1 max-w-prose text-sm text-muted-foreground">{person.notes}</p> : null}
        </div>
        <Link href={`/dashboard/people/${person.id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>Edit details</Link>
      </div>

      <section aria-label="Account summary" className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-5"><p className="mb-2 text-sm text-muted-foreground">Total received</p><div className="space-y-1 text-2xl font-semibold">{shown.map((t) => <Money key={t.currency} value={t.total_received} currency={t.currency} className="block text-received" />)}</div></CardContent></Card>
        <Card><CardContent className="p-5"><p className="mb-2 text-sm text-muted-foreground">Total given</p><div className="space-y-1 text-2xl font-semibold">{shown.map((t) => <Money key={t.currency} value={t.total_given} currency={t.currency} className="block text-given" />)}</div></CardContent></Card>
        <Card><CardContent className="p-5"><p className="mb-2 text-sm text-muted-foreground">Outstanding balance</p><div className="space-y-2 text-xl">{shown.map((t) => <Outstanding key={t.currency} value={t.outstanding} currency={t.currency} />)}</div></CardContent></Card>
      </section>

      <div className="flex flex-wrap gap-3">
        <AddTransactionButton personId={person.id} type="received" defaultCurrency={ctx.profile.default_currency} currencies={currencies} today={today} />
        <AddTransactionButton personId={person.id} type="given" defaultCurrency={ctx.profile.default_currency} currencies={currencies} today={today} />
        <details className="relative">
          <summary className={`${buttonVariants({ variant: "outline" })} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}><Download className="h-4 w-4" aria-hidden />Export account</summary>
          <div className="absolute z-20 mt-2 w-48 rounded-lg border bg-card p-1.5 text-sm shadow-lg">
            <a className="block rounded-md px-3 py-2 hover:bg-muted" href={`/api/export/ledger?format=pdf&${exportQs}`}>PDF statement</a>
            <a className="block rounded-md px-3 py-2 hover:bg-muted" href={`/api/export/ledger?format=xlsx&${exportQs}`}>Excel (.xlsx)</a>
            <a className="block rounded-md px-3 py-2 hover:bg-muted" href={`/api/export/ledger?format=csv&${exportQs}`}>CSV</a>
          </div>
        </details>
      </div>

      <section aria-labelledby="ledger-h" className="space-y-4">
        <h2 id="ledger-h" className="text-lg font-semibold">Transactions</h2>
        <TransactionFilters action={`/dashboard/people/${person.id}`} from={f.from} to={f.to} type={f.type} />
        {ledger.rows.length === 0 ? (
          <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
            {f.from || f.to || f.type ? "No transactions match these filters." : "No transactions yet. Record a received amount or an advance to get started."}
          </div>
        ) : (
          <>
            <LedgerTable rows={ledger.rows} timeZone={ctx.profile.time_zone} currencies={currencies} />
            <Pagination page={f.page} pageSize={LEDGER_PAGE_SIZE} total={ledger.total} hrefFor={(p) => withParams(`/dashboard/people/${person.id}`, sp, { page: String(p) })} />
          </>
        )}
      </section>
    </div>
  );
}
