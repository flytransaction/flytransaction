"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { stripe } from "@/lib/stripe/server";
import { getAccess, getSession } from "@/lib/security/guard";
import { rateLimit } from "@/lib/security/rate-limit";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANAGE_STATUSES = ["active", "trialing", "past_due", "unpaid", "paused"];

async function ensureCustomer(userId: string, email: string | null): Promise<string> {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("billing_customers").select("stripe_customer_id").eq("user_id", userId).maybeSingle();
  if (existing) return existing.stripe_customer_id as string;

  // The idempotency key makes concurrent first-time checkouts resolve to the same Stripe customer.
  const customer = await stripe().customers.create(
    { email: email ?? undefined, metadata: { user_id: userId } },
    { idempotencyKey: `fly-customer-${userId}` },
  );
  const { error } = await admin.from("billing_customers").insert({ user_id: userId, stripe_customer_id: customer.id });
  if (error) {
    const { data: again } = await admin.from("billing_customers").select("stripe_customer_id").eq("user_id", userId).maybeSingle();
    if (again) return again.stripe_customer_id as string;
    throw new Error("Could not store billing customer");
  }
  return customer.id;
}

/**
 * Starts Stripe Checkout. The plan id is looked up on the server; the price id is NEVER taken from the browser.
 * Access is granted only later, by the verified webhook.
 */
export async function startCheckout(formData: FormData): Promise<void> {
  const planId = String(formData.get("planId") ?? "");
  const ctx = await getAccess();
  if (!ctx) redirect("/login?next=/pricing");
  if (!ctx.emailConfirmed) redirect("/verify-email");
  if (!uuid.test(planId)) redirect("/pricing?error=invalid_plan");
  if (!(await rateLimit("checkout", ctx.userId, 10, 600))) redirect("/pricing?error=rate_limited");

  // Already subscribed (or fixable): manage in the portal instead of creating a duplicate subscription.
  if (ctx.subscription && MANAGE_STATUSES.includes(ctx.subscription.status)) redirect("/settings/subscription?manage=1");

  const supabase = await createClient();
  const { data: plan } = await supabase
    .from("plans").select("id, stripe_price_id, is_active").eq("id", planId).eq("is_active", true).maybeSingle();
  if (!plan) redirect("/pricing?error=invalid_plan");
  if (!plan.stripe_price_id) redirect("/pricing?error=plan_not_configured");

  let url: string | null = null;
  try {
    const customerId = await ensureCustomer(ctx.userId, ctx.email);
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: ctx.userId,
      line_items: [{ price: plan.stripe_price_id as string, quantity: 1 }],
      subscription_data: { metadata: { user_id: ctx.userId, plan_id: plan.id as string } },
      allow_promotion_codes: true,
      success_url: `${publicEnv.appUrl}/settings/subscription?checkout=success`,
      cancel_url: `${publicEnv.appUrl}/pricing?checkout=cancelled`,
    });
    url = session.url;
  } catch {
    redirect("/pricing?error=checkout_failed");
  }
  if (!url) redirect("/pricing?error=checkout_failed");
  redirect(url);
}

export async function openBillingPortal(): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const admin = createAdminClient();
  const { data: customer } = await admin.from("billing_customers").select("stripe_customer_id").eq("user_id", session.userId).maybeSingle();
  if (!customer) redirect("/pricing");

  let url: string | null = null;
  try {
    const portal = await stripe().billingPortal.sessions.create({
      customer: customer.stripe_customer_id as string,
      return_url: `${publicEnv.appUrl}/settings/subscription`,
    });
    url = portal.url;
  } catch {
    redirect("/settings/subscription?error=portal_unavailable");
  }
  if (!url) redirect("/settings/subscription?error=portal_unavailable");
  redirect(url);
}
