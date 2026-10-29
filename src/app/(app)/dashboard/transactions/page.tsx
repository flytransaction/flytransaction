import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/card";
import { Money } from "@/components/money-display";
import { Pagination, withParams } from "@/components/pagination";
import { TransactionFilters } from "@/components/filter-form";
import { LEDGER_PAGE_SIZE, getAllTransactions } from "@/features/transactions/queries";
import { requireAccess } from "@/lib/security/guard";
import { formatDate, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Transactions" };
export const dynamic = "force-dynamic";

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireAccess();
  const { rows, total, filters: f } = await getAllTransactions(sp);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">All transactions</h1>
        <Link className="text-sm underline" href="/dashboard/export">Export…</Link>
      </div>
      <TransactionFilters action="/dashboard/transactions" from={f.from} to={f.to} type={f.type} />
      {rows.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">No transactions match.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="zebra w-full text-sm">
            <caption className="sr-only">All transactions, newest first</caption>
            <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium">Date</th><th scope="col" className="px-4 py-3 text-left font-medium">Person</th>
                <th scope="col" className="px-4 py-3 text-left font-medium">Type</th><th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
                <th scope="col" className="px-4 py-3 text-left font-medium">Note</th><th scope="col" className="px-4 py-3 text-left font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={`border-b last:border-0 ${t.status === "voided" ? "text-muted-foreground" : ""}`}>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(t.transaction_date)}</td>
                  <td className="px-4 py-3"><Link className="font-medium hover:underline" href={`/dashboard/people/${t.person_id}`}>{t.person_name}</Link></td>
                  <td className="px-4 py-3"><Badge tone={t.transaction_type === "received" ? "received" : "given"}>{t.transaction_type === "received" ? "Received" : "Given"}</Badge>{t.status === "voided" ? <Badge tone="danger" className="ml-1.5">Voided</Badge> : null}</td>
                  <td className={`px-4 py-3 text-right ${t.status === "voided" ? "line-through" : ""}`}><Money value={t.amount} currency={t.currency} className={t.status === "voided" ? "" : t.transaction_type === "received" ? "text-received font-medium" : "text-given font-medium"} /></td>
                  <td className="max-w-64 break-words px-4 py-3">{t.note ?? "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(t.created_at, ctx.profile.time_zone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={f.page} pageSize={LEDGER_PAGE_SIZE} total={total} hrefFor={(p) => withParams("/dashboard/transactions", sp, { page: String(p) })} />
    </div>
  );
}
