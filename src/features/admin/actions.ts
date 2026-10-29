"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/server";
import { getAdminActionContext } from "@/lib/security/guard";
import { fail, friendlyDbError, ok, type ActionResult } from "@/lib/security/action-result";
import { isValidTimeZone } from "@/lib/money";
import { makeProcessorDeps, reconcileSubscriptions } from "@/features/billing/service";
import { processBillingEvent, type StripeEventLike } from "@/features/billing/webhook-processor";

const uuid = z.string().uuid();

export async function setUserSuspended(input: { userId: string; suspended: boolean; reason: string }): Promise<ActionResult> {
  const guard = await getAdminActionContext();
  if (!guard.ok) return fail(guard.error);
  const parsed = z.object({ userId: uuid, suspended: z.boolean(), reason: z.string().trim().min(3).max(500) }).safeParse(input);
  if (!parsed.success) return fail("Add a short reason (at least 3 characters).");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_suspended", { p_user: parsed.data.userId, p_suspended: parsed.data.suspended, p_reason: parsed.data.reason });
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath("/admin/users");
  return ok();
}

const planSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1).max(80),
  interval: z.enum(["monthly", "yearly"]),
  price: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter a price like 499 or 499.00"),
  currency: z.string().regex(/^[A-Z]{3}$/),
  features: z.string().max(1000).transform((s) => s.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12)),
  isActive: z.boolean(),
});

/**
 * Saves a plan. When the price/currency/interval changed (or there is no Stripe price yet) a NEW Stripe Price is
 * created, because Stripe prices are immutable. Existing subscribers keep their current price until they change
 * plans; new checkouts use the new price.
 */
export async function savePlan(input: z.input<typeof planSchema>, opts: { syncStripe: boolean }): Promise<ActionResult> {
  const guard = await getAdminActionContext();
  if (!guard.ok) return fail(guard.error);
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const p = parsed.data;
  const supabase = await createClient();

  let productId: string | null = null;
  let priceId: string | null = null;
  type ExistingPlan = { price: string | number; currency: string; billing_interval: string; stripe_product_id: string | null; stripe_price_id: string | null };
  let existing: ExistingPlan | null = null;
  if (p.id) {
    const { data } = await supabase.from("plans").select("price, currency, billing_interval, stripe_product_id, stripe_price_id").eq("id", p.id).maybeSingle();
    existing = data as ExistingPlan | null;
    productId = existing?.stripe_product_id ?? null;
    priceId = existing?.stripe_price_id ?? null;
  }

  const priceChanged = !existing || Number(existing.price) !== Number(p.price) || existing.currency !== p.currency || existing.billing_interval !== p.interval;
  if (opts.syncStripe && (priceChanged || !priceId)) {
    try {
      if (!productId) productId = (await stripe().products.create({ name: `Fly-Transaction ${p.name}` })).id;
      const minor = Math.round(Number(p.price) * 100); // two-decimal currencies only (INR, USD, EUR, GBP)
      priceId = (await stripe().prices.create({
        product: productId, unit_amount: minor, currency: p.currency.toLowerCase(),
        recurring: { interval: p.interval === "monthly" ? "month" : "year" },
      })).id;
    } catch {
      return fail("Stripe rejected the request. Check STRIPE_SECRET_KEY and the price values.");
    }
  }

  const { error } = await supabase.rpc("admin_save_plan", {
    p_id: p.id ?? null, p_name: p.name, p_interval: p.interval, p_price: p.price, p_currency: p.currency,
    p_stripe_product_id: productId, p_stripe_price_id: priceId, p_features: p.features, p_is_active: p.isActive,
  });
  if (error) {
    if (error.code === "23505") return fail("Another plan is already active for this interval. Deactivate it first.");
    return fail(friendlyDbError(error.message));
  }
  revalidatePath("/admin/plans");
  revalidatePath("/pricing");
  return ok();
}

export async function saveSetting(key: string, value: unknown): Promise<ActionResult> {
  const guard = await getAdminActionContext();
  if (!guard.ok) return fail(guard.error);
  let v: unknown;
  switch (key) {
    case "supported_currencies": {
      const r = z.array(z.string().regex(/^[A-Z]{3}$/)).min(1).max(20).safeParse(value);
      if (!r.success) return fail("Enter 1 to 20 three-letter currency codes.");
      v = [...new Set(r.data)];
      break;
    }
    case "past_due_grace_days": {
      const r = z.number().int().min(0).max(30).safeParse(value);
      if (!r.success) return fail("Grace period must be 0 to 30 days.");
      v = r.data; break;
    }
    case "account_retention_days": {
      const r = z.number().int().min(1).max(365).safeParse(value);
      if (!r.success) return fail("Retention must be 1 to 365 days.");
      v = r.data; break;
    }
    case "default_time_zone": {
      if (typeof value !== "string" || !isValidTimeZone(value)) return fail("Choose a valid time zone.");
      v = value; break;
    }
    default: return fail("Unknown setting.");
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_setting", { p_key: key, p_value: v });
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath("/admin/settings");
  return ok();
}

export async function reconcileUser(userId: string): Promise<ActionResult<{ changed: number }>> {
  const guard = await getAdminActionContext();
  if (!guard.ok) return fail(guard.error);
  if (!uuid.safeParse(userId).success) return fail("Invalid user.");
  const summary = await reconcileSubscriptions({ userId, limit: 1 });
  const supabase = await createClient();
  await supabase.rpc("admin_record_action", { p_action: "subscription_reconciled", p_target_type: "user", p_target_id: userId, p_details: summary }).then(() => undefined, () => undefined);
  revalidatePath("/admin/subscriptions");
  return ok({ changed: summary.changed });
}

/** Re-runs a FAILED webhook event by fetching it from Stripe again (payloads are not stored locally). */
export async function reprocessBillingEvent(eventId: string): Promise<ActionResult> {
  const guard = await getAdminActionContext();
  if (!guard.ok) return fail(guard.error);
  if (!/^evt_[A-Za-z0-9]+$/.test(eventId)) return fail("Invalid event id.");
  const supabase = await createClient();
  const { data: row } = await supabase.from("billing_events").select("status").eq("provider_event_id", eventId).maybeSingle();
  if (!row) return fail("Event not found.");
  if (row.status !== "failed") return fail("Only failed events can be reprocessed.");
  try {
    const event = (await stripe().events.retrieve(eventId)) as unknown as StripeEventLike;
    const result = await processBillingEvent(event, makeProcessorDeps());
    if (result.outcome === "failed") return fail("Processing failed again. See the error on the event.");
  } catch {
    return fail("Could not fetch the event from Stripe (events are retained for 30 days).");
  }
  revalidatePath("/admin/billing-events");
  return ok();
}
