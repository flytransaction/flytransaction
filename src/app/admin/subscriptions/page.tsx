import type { Metadata } from "next";
import { Badge } from "@/components/ui/card";
import { Pagination, withParams } from "@/components/pagination";
import { ReconcileButton } from "@/features/admin/components";
import { adminSubscriptions } from "@/features/admin/queries";
import { formatDate, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Subscriptions" };
export const dynamic = "force-dynamic";

export default async function AdminSubscriptions({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total } = await adminSubscriptions(page);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Subscriptions</h1>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="zebra w-full text-sm">
          <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground"><tr>
            <th scope="col" className="px-4 py-3 text-left font-medium">User</th><th scope="col" className="px-4 py-3 text-left font-medium">Plan</th>
            <th scope="col" className="px-4 py-3 text-left font-medium">Status</th><th scope="col" className="px-4 py-3 text-left font-medium">Period end</th>
            <th scope="col" className="px-4 py-3 text-left font-medium">Last reconciled</th><th scope="col" className="px-4 py-3 text-right font-medium">Actions</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="px-4 py-3"><p className="font-medium">{s.profiles?.full_name || "—"}</p><p className="text-xs text-muted-foreground">{s.profiles?.email}</p></td>
                <td className="px-4 py-3">{s.plans?.name ?? <span className="text-muted-foreground">unknown</span>}</td>
                <td className="px-4 py-3"><Badge tone={s.status === "active" || s.status === "trialing" ? "received" : s.status === "past_due" ? "warning" : "danger"}>{s.status.replace("_", " ")}</Badge>{s.cancel_at_period_end ? <span className="ml-1.5 text-xs text-muted-foreground">not renewing</span> : null}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDate(s.current_period_end)}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{s.last_reconciled_at ? formatDateTime(s.last_reconciled_at, "UTC") + " UTC" : "never"}{s.reconcile_error ? <p className="text-destructive">Error: {s.reconcile_error}</p> : null}</td>
                <td className="px-4 py-3 text-right"><ReconcileButton userId={s.user_id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No subscriptions yet.</p> : null}
      <Pagination page={page} pageSize={25} total={total} hrefFor={(p) => withParams("/admin/subscriptions", sp, { page: String(p) })} />
    </div>
  );
}
