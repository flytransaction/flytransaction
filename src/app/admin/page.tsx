import { Card, CardContent } from "@/components/ui/card";
import { adminSettings, adminStats } from "@/features/admin/queries";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CARDS: Array<[string, string]> = [
  ["users_total", "Registered users"], ["signups_30d", "Signups (30 days)"], ["users_suspended", "Suspended users"],
  ["subscriptions_active", "Active subscriptions"], ["subscriptions_past_due", "Past due"], ["subscriptions_scheduled_cancel", "Cancelling at period end"],
  ["people_total", "People records (all users)"], ["transactions_total", "Transactions (all users)"],
  ["billing_events_failed", "Failed billing events"], ["subscriptions_reconcile_errors", "Reconcile errors"],
];

export default async function AdminHome() {
  const [stats, settings] = await Promise.all([adminStats(), adminSettings()]);
  const run = settings.last_reconcile_run as { at?: string; checked?: number; changed?: number; recovered?: number; errors?: number } | undefined;
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">Aggregate numbers only. Customer names, notes and amounts are never shown here.</p>
      </div>
      <section aria-label="Statistics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {CARDS.map(([k, label]) => (
          <Card key={k}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold money">{stats[k] ?? 0}</p></CardContent></Card>
        ))}
      </section>
      <section aria-labelledby="rec-h">
        <h2 id="rec-h" className="mb-2 text-lg font-semibold">Subscription reconciliation</h2>
        <Card><CardContent className="p-4 text-sm">
          {run?.at ? <p>Last run {formatDateTime(run.at, "UTC")} UTC · checked {run.checked ?? 0} · changed {run.changed ?? 0} · recovered {run.recovered ?? 0} · errors {run.errors ?? 0}</p> : <p className="text-muted-foreground">The nightly job has not run yet.</p>}
        </CardContent></Card>
      </section>
    </div>
  );
}
