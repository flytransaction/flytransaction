import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/card";
import { Pagination, withParams } from "@/components/pagination";
import { ReprocessButton } from "@/features/admin/components";
import { adminBillingEvents } from "@/features/admin/queries";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing events" };
export const dynamic = "force-dynamic";

export default async function AdminBillingEvents({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total } = await adminBillingEvents(sp.status, page);
  const tab = (s: string | undefined, label: string) => (
    <Link href={withParams("/admin/billing-events", sp, { status: s, page: undefined })} aria-current={sp.status === s ? "page" : undefined} className={`rounded-md px-3 py-1.5 text-sm ${sp.status === s || (!sp.status && !s) ? "bg-muted font-medium" : "hover:bg-muted"}`}>{label}</Link>
  );
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Billing events</h1>
      <nav aria-label="Filter events" className="flex gap-1">{tab(undefined, "All")}{tab("failed", "Failed")}{tab("processed", "Processed")}{tab("ignored", "Ignored")}</nav>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="zebra w-full text-sm">
          <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground"><tr>
            <th scope="col" className="px-4 py-3 text-left font-medium">Received</th><th scope="col" className="px-4 py-3 text-left font-medium">Event</th>
            <th scope="col" className="px-4 py-3 text-left font-medium">Status</th><th scope="col" className="px-4 py-3 text-left font-medium">Attempts</th>
            <th scope="col" className="px-4 py-3 text-left font-medium">Error</th><th scope="col" className="px-4 py-3 text-right font-medium">Actions</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-b last:border-0">
                <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(e.received_at, "UTC")} UTC</td>
                <td className="px-4 py-3"><p className="font-medium">{e.event_type}</p><p className="text-xs text-muted-foreground">{e.provider_event_id}</p></td>
                <td className="px-4 py-3"><Badge tone={e.status === "processed" ? "received" : e.status === "failed" ? "danger" : "neutral"}>{e.status}</Badge></td>
                <td className="px-4 py-3">{e.attempts}</td>
                <td className="max-w-72 break-words px-4 py-3 text-xs text-destructive">{e.error}</td>
                <td className="px-4 py-3 text-right">{e.status === "failed" ? <ReprocessButton eventId={e.provider_event_id} /> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No events.</p> : null}
      <Pagination page={page} pageSize={30} total={total} hrefFor={(p) => withParams("/admin/billing-events", sp, { page: String(p) })} />
    </div>
  );
}
