import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
import {
  recordFromStripe, shouldReplaceSubscription,
  type BeginResult, type ProcessorDeps, type StripeSubscriptionLike, type SubscriptionRecord,
} from "./webhook-processor";
import type { SubscriptionStatus } from "./access-policy";

/** Wires the pure webhook processor to Postgres (service role) and the Stripe API. */
export function makeProcessorDeps(): ProcessorDeps {
  const admin = createAdminClient();

  return {
    async beginEvent(id, type): Promise<BeginResult> {
      const { error } = await admin.from("billing_events").insert({ provider: "stripe", provider_event_id: id, event_type: type });
      if (!error) return "new";
      if (error.code !== "23505") throw new Error(`billing_events insert failed: ${error.message}`);

      const { data: existing, error: readError } = await admin
        .from("billing_events").select("status, attempts").eq("provider", "stripe").eq("provider_event_id", id).single();
      if (readError || !existing) throw new Error("billing_events read failed");
      if (existing.status === "processed" || existing.status === "ignored") return "duplicate";
      await admin.from("billing_events")
        .update({ attempts: (existing.attempts as number) + 1, status: "received", error: null })
        .eq("provider", "stripe").eq("provider_event_id", id);
      return "retry";
    },

    async finishEvent(id, status, info) {
      await admin.from("billing_events")
        .update({ status, error: info?.error ?? null, summary: info?.summary ?? {}, processed_at: new Date().toISOString() })
        .eq("provider", "stripe").eq("provider_event_id", id);
    },

    async fetchSubscription(subscriptionId) {
      const sub = await stripe().subscriptions.retrieve(subscriptionId);
      return sub as unknown as StripeSubscriptionLike;
    },

    async userIdForCustomer(customerId) {
      const { data } = await admin.from("billing_customers").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
      return (data?.user_id as string | undefined) ?? null;
    },

    async planIdForPrice(priceId) {
      const { data } = await admin.from("plans").select("id").eq("stripe_price_id", priceId).maybeSingle();
      return (data?.id as string | undefined) ?? null;
    },

    async existingPastDueSince(userId) {
      const { data } = await admin.from("subscriptions").select("past_due_since").eq("user_id", userId).maybeSingle();
      return (data?.past_due_since as string | null | undefined) ?? null;
    },

    async upsertSubscription(r: SubscriptionRecord) {
      const { data: existing } = await admin
        .from("subscriptions").select("stripe_subscription_id, status").eq("user_id", r.userId).maybeSingle();
      const replace = shouldReplaceSubscription(
        existing ? { stripeSubscriptionId: existing.stripe_subscription_id as string | null, status: existing.status as SubscriptionStatus } : null,
        { stripeSubscriptionId: r.stripeSubscriptionId, status: r.status },
      );
      if (!replace) return;
      const { error } = await admin.from("subscriptions").upsert(
        {
          user_id: r.userId, plan_id: r.planId, stripe_customer_id: r.stripeCustomerId,
          stripe_subscription_id: r.stripeSubscriptionId, status: r.status,
          current_period_start: r.currentPeriodStart, current_period_end: r.currentPeriodEnd,
          cancel_at_period_end: r.cancelAtPeriodEnd, canceled_at: r.canceledAt, past_due_since: r.pastDueSince,
          last_reconciled_at: new Date().toISOString(), reconcile_error: null,
        },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(`subscriptions upsert failed: ${error.message}`);
    },
  };
}

export interface ReconcileSummary {
  checked: number;
  changed: number;
  recovered: number;
  errors: number;
}

/**
 * Compares local subscription rows with Stripe (the source of truth) and repairs drift, e.g. after a missed webhook.
 * Also recovers customers who paid but never got a local row.
 */
export async function reconcileSubscriptions(opts: { limit?: number; userId?: string } = {}): Promise<ReconcileSummary> {
  const admin = createAdminClient();
  const deps = makeProcessorDeps();
  const summary: ReconcileSummary = { checked: 0, changed: 0, recovered: 0, errors: 0 };

  let query = admin
    .from("subscriptions")
    .select("user_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end")
    .not("stripe_subscription_id", "is", null)
    .not("status", "in", "(canceled,incomplete_expired)")
    .order("last_reconciled_at", { ascending: true, nullsFirst: true })
    .limit(opts.limit ?? 100);
  if (opts.userId) query = query.eq("user_id", opts.userId);
  const { data: rows } = await query;

  for (const row of rows ?? []) {
    summary.checked += 1;
    try {
      const fresh = await deps.fetchSubscription(row.stripe_subscription_id as string);
      const record = await recordFromStripe(fresh, deps);
      const drifted =
        record.status !== row.status ||
        record.cancelAtPeriodEnd !== row.cancel_at_period_end ||
        (record.currentPeriodEnd ? Date.parse(record.currentPeriodEnd) : null) !==
          (row.current_period_end ? Date.parse(row.current_period_end as string) : null);
      await deps.upsertSubscription(record);
      if (drifted) summary.changed += 1;
    } catch (err) {
      summary.errors += 1;
      const message = (err instanceof Error ? err.message : "unknown error").slice(0, 300);
      await admin.from("subscriptions")
        .update({ reconcile_error: message, last_reconciled_at: new Date().toISOString() })
        .eq("user_id", row.user_id as string);
    }
  }

  if (!opts.userId) {
    // Customers who started checkout but have no local subscription row (webhook never arrived).
    const [{ data: customers }, { data: have }] = await Promise.all([
      admin.from("billing_customers").select("user_id, stripe_customer_id").order("created_at", { ascending: false }).limit(200),
      admin.from("subscriptions").select("user_id"),
    ]);
    const haveSet = new Set((have ?? []).map((r) => r.user_id as string));
    for (const c of (customers ?? []).filter((c) => !haveSet.has(c.user_id as string)).slice(0, 25)) {
      try {
        const list = await stripe().subscriptions.list({ customer: c.stripe_customer_id as string, status: "all", limit: 1 });
        const found = list.data[0];
        if (!found) continue;
        summary.checked += 1;
        const record = await recordFromStripe(found as unknown as StripeSubscriptionLike, deps);
        await deps.upsertSubscription(record);
        summary.recovered += 1;
      } catch {
        summary.errors += 1;
      }
    }
  }

  if (!opts.userId) {
    await admin.from("app_settings").upsert(
      { key: "last_reconcile_run", value: { at: new Date().toISOString(), ...summary } },
      { onConflict: "key" },
    );
  }
  return summary;
}
