import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/money-display";
import { getAuditTrail } from "@/features/transactions/queries";
import { requireAccess } from "@/lib/security/guard";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Transaction history" };
export const dynamic = "force-dynamic";

const ACTION: Record<string, string> = { created: "Created", voided: "Voided", replaced: "Replaced by a correction" };

export default async function TransactionHistoryPage({ params }: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = await params;
  const ctx = await requireAccess();
  if (!/^[0-9a-f-]{36}$/i.test(transactionId)) notFound();
  const supabase = await createClient();
  const { data: tx } = await supabase
    .from("transactions")
    .select("id, person_id, transaction_type, amount:amount::text, currency, transaction_date, note, reference_number, status, void_reason, replaces_transaction_id")
    .eq("id", transactionId).maybeSingle();
  if (!tx) notFound(); // RLS hides other users' rows
  const trail = await getAuditTrail(transactionId);
  const t = tx as unknown as { person_id: string; transaction_type: string; amount: string; currency: string; transaction_date: string; note: string | null; reference_number: string | null; status: string; void_reason: string | null; replaces_transaction_id: string | null };

  return (
    <div className="max-w-2xl space-y-6">
      <Link className="text-sm text-muted-foreground underline" href={`/dashboard/people/${t.person_id}`}>← Back to account</Link>
      <h1 className="text-2xl font-semibold tracking-tight">Transaction history</h1>
      <Card><CardContent className="space-y-1 p-5 text-sm">
        <p><span className="text-muted-foreground">Type:</span> {t.transaction_type === "received" ? "Received" : "Given"} · <span className="text-muted-foreground">Status:</span> {t.status === "valid" ? "Valid" : "Voided"}</p>
        <p><span className="text-muted-foreground">Amount:</span> <Money value={t.amount} currency={t.currency} className="font-medium" /> · <span className="text-muted-foreground">Date:</span> {formatDate(t.transaction_date)}</p>
        {t.note ? <p><span className="text-muted-foreground">Note:</span> {t.note}</p> : null}
        {t.reference_number ? <p><span className="text-muted-foreground">Reference:</span> {t.reference_number}</p> : null}
        {t.void_reason ? <p><span className="text-muted-foreground">Void reason:</span> {t.void_reason}</p> : null}
      </CardContent></Card>
      <Card>
        <CardHeader><CardTitle>Audit trail</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-4">
            {trail.map((a) => {
              const before = a.before_snapshot as { amount?: string; currency?: string; transaction_date?: string; note?: string | null } | null;
              const after = a.after_snapshot as { amount?: string; currency?: string; transaction_date?: string; note?: string | null } | null;
              return (
                <li key={a.id} className="border-l-2 pl-3 text-sm">
                  <p className="font-medium">{ACTION[a.action] ?? a.action}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(a.created_at, ctx.profile.time_zone)} · by you</p>
                  {a.reason ? <p className="mt-1">Reason: {a.reason}</p> : null}
                  {before?.amount ? <p className="mt-1 text-xs text-muted-foreground">Before: {before.currency} {before.amount} on {before.transaction_date}{before.note ? ` — ${before.note}` : ""}</p> : null}
                  {after?.amount && a.action !== "voided" ? <p className="text-xs text-muted-foreground">After: {after.currency} {after.amount} on {after.transaction_date}{after.note ? ` — ${after.note}` : ""}</p> : null}
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
