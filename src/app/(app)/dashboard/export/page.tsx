import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { requireAccess } from "@/lib/security/guard";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Export data" };
export const dynamic = "force-dynamic";

export default async function ExportPage() {
  const ctx = await requireAccess();
  const supabase = await createClient();
  const { data: people } = await supabase.from("people").select("id, name").is("archived_at", null).order("name").limit(500);
  const link = "inline-flex h-10 items-center rounded-md border border-input bg-card px-4 text-sm font-medium hover:bg-muted";

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Export your data</h1>
        <p className="mt-1 text-sm text-muted-foreground">Dates and timestamps use your reporting time zone: <strong>{ctx.profile.time_zone}</strong>. Change it in profile settings.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>People list</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link className={link} href="/api/export/people?format=csv">CSV</Link>
          <Link className={link} href="/api/export/people?format=xlsx">Excel</Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Transactions</CardTitle><p className="text-sm text-muted-foreground">All transactions, or only a date range / type.</p></CardHeader>
        <CardContent>
          <form action="/api/export/transactions" method="get" className="flex flex-wrap items-end gap-3">
            <div><label htmlFor="t-from" className="mb-1 block text-xs font-medium">From</label><Input id="t-from" type="date" name="from" className="w-40" /></div>
            <div><label htmlFor="t-to" className="mb-1 block text-xs font-medium">To</label><Input id="t-to" type="date" name="to" className="w-40" /></div>
            <div><label htmlFor="t-type" className="mb-1 block text-xs font-medium">Type</label><Select id="t-type" name="type" className="w-36"><option value="">All</option><option value="received">Received</option><option value="given">Given</option></Select></div>
            <div><label htmlFor="t-format" className="mb-1 block text-xs font-medium">Format</label><Select id="t-format" name="format" className="w-32"><option value="csv">CSV</option><option value="xlsx">Excel</option></Select></div>
            <Button type="submit">Download</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Person statement</CardTitle><p className="text-sm text-muted-foreground">A complete ledger for one person, as PDF, Excel or CSV.</p></CardHeader>
        <CardContent>
          <form action="/api/export/ledger" method="get" className="flex flex-wrap items-end gap-3">
            <div><label htmlFor="l-person" className="mb-1 block text-xs font-medium">Person</label>
              <Select id="l-person" name="personId" required className="w-56"><option value="">Choose…</option>{(people ?? []).map((p) => <option key={p.id as string} value={p.id as string}>{p.name as string}</option>)}</Select></div>
            <div><label htmlFor="l-from" className="mb-1 block text-xs font-medium">From</label><Input id="l-from" type="date" name="from" className="w-40" /></div>
            <div><label htmlFor="l-to" className="mb-1 block text-xs font-medium">To</label><Input id="l-to" type="date" name="to" className="w-40" /></div>
            <div><label htmlFor="l-format" className="mb-1 block text-xs font-medium">Format</label><Select id="l-format" name="format" className="w-32"><option value="pdf">PDF</option><option value="xlsx">Excel</option><option value="csv">CSV</option></Select></div>
            <Button type="submit">Download</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Complete account data</CardTitle><p className="text-sm text-muted-foreground">Everything we hold in your ledger (people, transactions including voided, and audit history) as JSON.</p></CardHeader>
        <CardContent><Link className={link} href="/api/export/account-data?format=json">Download JSON</Link></CardContent>
      </Card>
    </div>
  );
}
