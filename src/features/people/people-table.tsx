import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { BalanceStack } from "@/components/money-display";
import { withParams } from "@/components/pagination";
import { formatDate } from "@/lib/utils";
import type { PeopleListRow } from "@/types/database";

type SortKey = "name" | "last_transaction" | "received" | "given" | "outstanding";

export function PeopleTable({
  rows, sort, dir, query, defaultCurrency,
}: { rows: PeopleListRow[]; sort: SortKey; dir: "asc" | "desc"; query: Record<string, string | string[] | undefined>; defaultCurrency: string }) {
  const head = (key: SortKey, label: string, align = "text-left") => {
    const active = sort === key;
    const nextDir = active && dir === "asc" ? "desc" : "asc";
    const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} className={`px-4 py-3 font-medium ${align}`}>
        <Link href={withParams("/dashboard", query, { sort: key, dir: nextDir, page: undefined })} className="inline-flex items-center gap-1 hover:underline">
          {label}<Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        </Link>
      </th>
    );
  };

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="zebra w-full text-sm">
        <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {head("name", "Person")}
            {head("received", "Total received")}
            {head("given", "Total given")}
            {head("outstanding", "Outstanding")}
            {head("last_transaction", "Last transaction")}
            <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="relative cursor-pointer border-b last:border-0">
              <td className="px-4 py-3">
                <Link href={`/dashboard/people/${p.id}`} className="font-medium hover:underline after:absolute after:inset-0 after:content-['']">{p.name}</Link>
                {p.phone || p.email ? <p className="text-xs text-muted-foreground">{p.phone ?? p.email}</p> : null}
              </td>
              <td className="px-4 py-3"><BalanceStack balances={p.balances} field="total_received" defaultCurrency={defaultCurrency} /></td>
              <td className="px-4 py-3"><BalanceStack balances={p.balances} field="total_given" defaultCurrency={defaultCurrency} /></td>
              <td className="px-4 py-3"><BalanceStack balances={p.balances} field="outstanding" defaultCurrency={defaultCurrency} /></td>
              <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDate(p.last_transaction_date)}</td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <Link href={`/dashboard/people/${p.id}`} className="relative z-10 text-sm underline-offset-2 hover:underline">Open</Link>
                <span className="px-1.5 text-muted-foreground" aria-hidden>·</span>
                <Link href={`/dashboard/people/${p.id}/edit`} className="relative z-10 text-sm underline-offset-2 hover:underline">Edit</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
