import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { SubmitButton } from "@/components/submit-button";
import { openBillingPortal } from "@/features/billing/actions";
import { AwaitSubscription } from "@/features/billing/refresh";
import { getAccess } from "@/lib/security/guard";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Subscription" };
export const dynamic = "force-dynamic";

export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ checkout?: string; manage?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await getAccess();
  if (!ctx) redirect("/login");
  const sub = ctx.subscription;
  let planLine: string | null = null;
  if (sub?.plan_id) {
    const supabase = await createClient();
    const { data: plan } = await supabase.from("plans").select("name, price, currency, billing_interval").eq("id", sub.plan_id).maybeSingle();
    if (plan) planLine = `${plan.name} · ${formatMoney(String(plan.price), plan.currency as string)} / ${plan.billing_interval === "yearly" ? "year" : "month"}`;
  }
  const tone = ctx.access.allowed ? (sub?.status === "past_due" ? "warning" : "received") : "danger";

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Subscription</h1>
      {sp.checkout === "success" ? <AwaitSubscription active={ctx.access.allowed} /> : null}
      {sp.manage ? <FormMessage tone="info">You already have a subscription. Use “Manage billing” to change plan, update your card or cancel.</FormMessage> : null}
      {sp.error ? <FormMessage tone="error">Billing portal is unavailable right now. Please try again shortly.</FormMessage> : null}

      <Card>
        <CardHeader><CardTitle>Status</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!sub ? (
            <>
              <p className="text-muted-foreground">You don’t have a subscription yet.</p>
              <Link href="/pricing" className={buttonVariants()}>Choose a plan</Link>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2"><Badge tone={tone}>{sub.status.replace("_", " ")}</Badge>{ctx.access.allowed ? "Access is active." : "Access is paused."}</p>
              {planLine ? <p><span className="text-muted-foreground">Plan:</span> {planLine}</p> : null}
              {sub.current_period_end ? <p><span className="text-muted-foreground">{sub.cancel_at_period_end ? "Access until:" : "Renews / period ends:"}</span> {formatDate(sub.current_period_end)}</p> : null}
              {sub.cancel_at_period_end ? <FormMessage tone="info">This subscription will not renew. You keep full access until {formatDate(sub.current_period_end)}.</FormMessage> : null}
              {sub.status === "past_due" ? <FormMessage tone="error">Your last payment failed. Update your payment method to avoid losing access{ctx.access.accessUntil ? ` after ${formatDate(ctx.access.accessUntil)}` : ""}.</FormMessage> : null}
              <div className="flex flex-wrap gap-3 pt-2">
                <form action={openBillingPortal}><SubmitButton pendingLabel="Opening…">Manage billing</SubmitButton></form>
                {!ctx.access.allowed ? <Link href="/pricing" className={buttonVariants({ variant: "outline" })}>Renew with a new plan</Link> : null}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
