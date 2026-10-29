import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { SubmitButton } from "@/components/submit-button";
import { startCheckout } from "@/features/billing/actions";
import { getAccess } from "@/lib/security/guard";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import type { Plan } from "@/types/database";

export const metadata: Metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid_plan: "That plan is not available.",
  plan_not_configured: "This plan is not connected to billing yet. Please try again later.",
  checkout_failed: "We could not start checkout. Please try again.",
  rate_limited: "Too many attempts. Please wait a few minutes.",
};

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ error?: string; checkout?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("plans").select("*").eq("is_active", true).order("billing_interval");
  const plans = ((data ?? []) as Plan[]).sort((a, b) => (a.billing_interval === "monthly" ? -1 : 1) - (b.billing_interval === "monthly" ? -1 : 1));
  const ctx = await getAccess();
  const status = ctx?.subscription;

  return (
    <div>
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Simple pricing</h1>
        <p className="mt-3 text-muted-foreground">One plan, two ways to pay. Cancel any time; you keep access until the end of the paid period.</p>
      </div>

      <div className="mx-auto mt-6 max-w-2xl space-y-3">
        {sp.error ? <FormMessage tone="error">{ERRORS[sp.error] ?? "Something went wrong."}</FormMessage> : null}
        {sp.checkout === "cancelled" ? <FormMessage tone="info">Checkout was cancelled. You have not been charged.</FormMessage> : null}
        {ctx && !ctx.emailConfirmed ? <FormMessage tone="info">Verify your email before subscribing. <Link className="underline" href="/verify-email">Resend the link</Link>.</FormMessage> : null}
        {ctx && status ? (
          <FormMessage tone={ctx.access.allowed ? "success" : "info"}>
            Current subscription: <strong>{status.status.replace("_", " ")}</strong>
            {status.current_period_end ? <> · period ends {formatDate(status.current_period_end)}</> : null}
            {status.cancel_at_period_end ? " · will not renew" : ""}
          </FormMessage>
        ) : null}
      </div>

      {plans.length === 0 ? <p className="mt-10 text-center text-muted-foreground">Plans are not available right now.</p> : null}
      <div className="mx-auto mt-10 grid max-w-3xl gap-5 md:grid-cols-2">
        {plans.map((p) => {
          const yearly = p.billing_interval === "yearly";
          return (
            <Card key={p.id} className={yearly ? "border-primary/60" : ""}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{p.name}</CardTitle>
                  {yearly ? <Badge tone="received">Best value</Badge> : null}
                </div>
                <p className="pt-2 text-3xl font-semibold tracking-tight money">
                  {formatMoney(String(p.price), p.currency)}
                  <span className="text-sm font-normal text-muted-foreground"> / {yearly ? "year" : "month"}</span>
                </p>
              </CardHeader>
              <CardContent>
                <ul className="mb-6 space-y-2 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-received" aria-hidden />{f}</li>
                  ))}
                </ul>
                {ctx ? (
                  <form action={startCheckout}>
                    <input type="hidden" name="planId" value={p.id} />
                    <SubmitButton className="w-full" disabled={!ctx.emailConfirmed} pendingLabel="Redirecting to checkout…">
                      {status && ["active", "trialing", "past_due"].includes(status.status) ? "Manage subscription" : "Subscribe"}
                    </SubmitButton>
                  </form>
                ) : (
                  <Link className={buttonVariants({ className: "w-full" })} href="/signup">Create account to subscribe</Link>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
