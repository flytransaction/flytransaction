import type { Metadata } from "next";
import { Badge } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { Pagination, withParams } from "@/components/pagination";
import { SuspendButton } from "@/features/admin/components";
import { adminUsers } from "@/features/admin/queries";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";

export default async function AdminUsers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total } = await adminUsers(sp.q?.slice(0, 100), page);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <form role="search" action="/admin/users"><label htmlFor="uq" className="sr-only">Search users</label><Input id="uq" name="q" type="search" defaultValue={sp.q} placeholder="Search name or email" className="w-64" /></form>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="zebra w-full text-sm">
          <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground"><tr>
            <th scope="col" className="px-4 py-3 text-left font-medium">User</th><th scope="col" className="px-4 py-3 text-left font-medium">Email verified</th>
            <th scope="col" className="px-4 py-3 text-left font-medium">Subscription</th><th scope="col" className="px-4 py-3 text-left font-medium">Joined</th>
            <th scope="col" className="px-4 py-3 text-left font-medium">Status</th><th scope="col" className="px-4 py-3 text-right font-medium">Actions</th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-b last:border-0">
                <td className="px-4 py-3"><p className="font-medium">{u.full_name || "—"}</p><p className="text-xs text-muted-foreground">{u.email}</p></td>
                <td className="px-4 py-3">{u.email_confirmed_at ? "Yes" : "No"}</td>
                <td className="px-4 py-3">{u.subscription_status ? <>{u.subscription_status.replace("_", " ")}{u.current_period_end ? <span className="text-xs text-muted-foreground"> · to {formatDate(u.current_period_end)}</span> : null}{u.cancel_at_period_end ? <span className="text-xs text-muted-foreground"> · not renewing</span> : null}</> : <span className="text-muted-foreground">none</span>}</td>
                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDate(u.created_at)}</td>
                <td className="px-4 py-3">{u.role === "super_admin" ? <Badge>Admin</Badge> : u.suspended_at ? <Badge tone="danger">Suspended</Badge> : u.deletion_requested_at ? <Badge tone="warning">Deleting</Badge> : <Badge tone="received">Active</Badge>}</td>
                <td className="px-4 py-3 text-right">{u.role === "super_admin" ? null : <SuspendButton userId={u.id} email={u.email ?? "this user"} suspended={Boolean(u.suspended_at)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={25} total={total} hrefFor={(p) => withParams("/admin/users", sp, { page: String(p) })} />
    </div>
  );
}
