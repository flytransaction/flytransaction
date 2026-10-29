import type { Metadata } from "next";
import { Pagination, withParams } from "@/components/pagination";
import { adminAuditLogs } from "@/features/admin/queries";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit logs" };
export const dynamic = "force-dynamic";

export default async function AdminAudit({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total } = await adminAuditLogs(page);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Admin audit log</h1>
      <p className="text-sm text-muted-foreground">Append-only record of privileged actions. Contains identifiers and reasons, never customer ledger data.</p>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="zebra w-full text-sm">
          <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground"><tr>
            <th scope="col" className="px-4 py-3 text-left font-medium">When (UTC)</th><th scope="col" className="px-4 py-3 text-left font-medium">Action</th>
            <th scope="col" className="px-4 py-3 text-left font-medium">Target</th><th scope="col" className="px-4 py-3 text-left font-medium">Details</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 align-top">
                <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(r.created_at, "UTC")}</td>
                <td className="px-4 py-3 font-medium">{r.action}</td>
                <td className="px-4 py-3 text-xs">{r.target_type}{r.target_id ? <span className="block break-all text-muted-foreground">{r.target_id}</span> : null}</td>
                <td className="max-w-md break-words px-4 py-3 text-xs text-muted-foreground">{JSON.stringify(r.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No admin actions yet.</p> : null}
      <Pagination page={page} pageSize={40} total={total} hrefFor={(p) => withParams("/admin/audit-logs", sp, { page: String(p) })} />
    </div>
  );
}
