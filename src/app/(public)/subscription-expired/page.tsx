import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { openBillingPortal } from "@/features/billing/actions";
import { getAccess } from "@/lib/security/guard";
import { redirectForReason, type AccessReason } from "@/features/billing/access-policy";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Subscription inactive" };
export const dynamic = "force-dynamic";

const COPY: Partial<Record<AccessReason, string>> = {
  period_ended: "Your paid period has ended.",
  past_due_grace_expired: "Your last payment did not go through and the grace period has ended.",
  subscription_inactive: "Your subscription is no longer active.",
  suspended: "Your account is suspended. Contact support if you think this is a mistake.",
  deletion_pending: "Your account is scheduled for deletion. You can cancel the deletion from your profile settings.",
};

export default async function SubscriptionExpiredPage() {
  const ctx = await getAccess();
  if (!ctx) redirect("/login?next=/subscription-expired");
  if (ctx.access.allowed) redirect("/dashboard");
  const target = redirectForReason(ctx.access.reason);
  if (target !== "/subscription-expired") redirect(target);

  const canRenew = ctx.access.reason !== "suspended" && ctx.access.reason !== "deletion_pending";
  return (
    <div className="mx-auto max-w-lg text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Access is paused</h1>
      <p className="mt-3 text-muted-foreground">{COPY[ctx.access.reason] ?? "Your subscription is not active."}</p>
      {canRenew ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Your records are safe and have not been deleted. Renew to restore access straight away
          {ctx.subscription?.current_period_end ? <> (last paid period ended {formatDate(ctx.subscription.current_period_end)})</> : null}.
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {canRenew ? <Link className={buttonVariants()} href="/pricing">Renew subscription</Link> : null}
        {canRenew && ctx.subscription ? <form action={openBillingPortal}><SubmitButton variant="outline" pendingLabel="Opening…">Update payment method</SubmitButton></form> : null}
        <Link className={buttonVariants({ variant: "ghost" })} href="/settings/profile">Account settings</Link>
      </div>
    </div>
  );
}
