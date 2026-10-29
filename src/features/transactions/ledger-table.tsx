import Link from "next/link";
import { Badge } from "@/components/ui/card";
import { Money } from "@/components/money-display";
import { formatDate, formatDateTime } from "@/lib/utils";
import { TransactionRowActions } from "./components";
import type { LedgerRow } from "@/types/database";

export function LedgerTable({ rows, timeZone, currencies }: { rows: LedgerRow[]; timeZone: string; currencies: string[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="zebra w-full text-sm">
        <caption className="sr-only">Transactions, newest first. Running balance is received minus given.</caption>
        <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 text-left font-medium">Date</th>
            <th scope="col" className="px-4 py-3 text-left font-medium">Type</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Received</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Given</th>
            <th scope="col" className="px-4 py-3 text-left font-medium">Note</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Running balance</th>
            <th scope="col" className="px-4 py-3 text-left font-medium">Created</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const voided = r.status === "voided";
            return (
              <tr key={r.id} className={`border-b last:border-0 ${voided ? "text-muted-foreground" : ""}`}>
                <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.transaction_date)}</td>
                <td className="px-4 py-3">
                  <Badge tone={r.transaction_type === "received" ? "received" : "given"}>{r.transaction_type === "received" ? "Received" : "Given"}</Badge>
                  {voided ? <Badge tone="danger" className="ml-1.5">Voided</Badge> : null}
                </td>
                <td className={`px-4 py-3 text-right ${voided ? "line-through" : ""}`}>{r.transaction_type === "received" ? <Money value={r.amount} currency={r.currency} className={voided ? "" : "text-received font-medium"} /> : ""}</td>
                <td className={`px-4 py-3 text-right ${voided ? "line-through" : ""}`}>{r.transaction_type === "given" ? <Money value={r.amount} currency={r.currency} className={voided ? "" : "text-given font-medium"} /> : ""}</td>
                <td className="max-w-64 px-4 py-3">
                  <p className="break-words">{r.note ?? <span className="text-muted-foreground">—</span>}</p>
                  {r.reference_number ? <p className="text-xs text-muted-foreground">Ref {r.reference_number}</p> : null}
                  {voided && r.void_reason ? <p className="text-xs">Void reason: {r.void_reason}</p> : null}
                  {r.replaces_transaction_id ? <p className="text-xs text-muted-foreground">Corrects an earlier entry</p> : null}
                </td>
                <td className="px-4 py-3 text-right">{r.running_balance !== null ? <Money value={r.running_balance} currency={r.currency} /> : <span aria-label="Not counted">—</span>}</td>
                <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(r.created_at, timeZone)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1.5">
                    {!voided ? <TransactionRowActions currencies={currencies} tx={{ id: r.id, amount: r.amount, currency: r.currency, transaction_date: r.transaction_date, note: r.note, reference_number: r.reference_number }} /> : null}
                    <Link className="inline-flex h-8 items-center px-2 text-xs underline-offset-2 hover:underline" href={`/dashboard/transactions/${r.id}`}>History</Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
