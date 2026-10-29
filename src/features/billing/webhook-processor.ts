import type { SubscriptionStatus } from "./access-policy";

/**
 * Idempotent, order-tolerant Stripe event processing.
 * The event payload is only used to learn WHICH subscription changed; the authoritative state is re-fetched
 * from Stripe (deps.fetchSubscription), so late or out-of-order deliveries cannot regress local state.
 */

export interface StripeEventLike {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface StripeSubscriptionLike {
  id: string;
  customer: string | { id: string };
  status: string;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  current_period_start?: number;
  current_period_end?: number;
  items?: { data: Array<{ price?: { id?: string }; current_period_start?: number; current_period_end?: number }> };
}

export interface SubscriptionRecord {
  userId: string;
  planId: string | null;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  pastDueSince: string | null;
}

export type BeginResult = "new" | "retry" | "duplicate";

export interface ProcessorDeps {
  beginEvent(id: string, type: string): Promise<BeginResult>;
  finishEvent(
    id: string,
    status: "processed" | "ignored" | "failed",
    info?: { error?: string; summary?: Record<string, unknown> },
  ): Promise<void>;
  fetchSubscription(subscriptionId: string): Promise<StripeSubscriptionLike>;
  userIdForCustomer(customerId: string): Promise<string | null>;
  planIdForPrice(priceId: string): Promise<string | null>;
  existingPastDueSince(userId: string): Promise<string | null>;
  upsertSubscription(record: SubscriptionRecord): Promise<void>;
  now?: () => Date;
}

export type ProcessOutcome =
  | { outcome: "processed" | "duplicate" | "ignored" }
  | { outcome: "failed"; error: string };

const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
]);

const VALID_STATUSES = new Set<string>([
  "incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused",
]);

const idOf = (v: unknown): string | null =>
  typeof v === "string"
    ? v
    : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string"
      ? (v as { id: string }).id
      : null;

/** Find the subscription id referenced by an event (handles old and 2025+ invoice shapes). */
export function subscriptionIdFromEvent(event: StripeEventLike): string | null {
  const obj = event.data.object;
  if (event.type.startsWith("customer.subscription.")) return idOf(obj.id);
  if (event.type === "checkout.session.completed") {
    return obj.mode === "subscription" ? idOf(obj.subscription) : null;
  }
  if (event.type.startsWith("invoice.")) {
    const direct = idOf(obj.subscription);
    if (direct) return direct;
    const parent = obj.parent as { subscription_details?: { subscription?: unknown } } | undefined;
    return idOf(parent?.subscription_details?.subscription);
  }
  return null;
}

const toIso = (unix: number | undefined | null): string | null =>
  typeof unix === "number" ? new Date(unix * 1000).toISOString() : null;

export function periodFrom(sub: StripeSubscriptionLike): { start: string | null; end: string | null } {
  // Newer Stripe API versions moved period fields onto subscription items.
  const item = sub.items?.data?.[0];
  return {
    start: toIso(sub.current_period_start ?? item?.current_period_start),
    end: toIso(sub.current_period_end ?? item?.current_period_end),
  };
}

/** Turn a fresh Stripe subscription into our row shape (shared with the reconcile job). */
export async function recordFromStripe(
  sub: StripeSubscriptionLike,
  deps: Pick<ProcessorDeps, "userIdForCustomer" | "planIdForPrice" | "existingPastDueSince" | "now">,
): Promise<SubscriptionRecord> {
  const customerId = idOf(sub.customer);
  if (!customerId) throw new Error("Subscription has no customer");
  const userId = await deps.userIdForCustomer(customerId);
  if (!userId) throw new Error("Unknown Stripe customer (not created by this app)");
  if (!VALID_STATUSES.has(sub.status)) throw new Error(`Unexpected subscription status: ${sub.status}`);

  const status = sub.status as SubscriptionStatus;
  const priceId = sub.items?.data?.[0]?.price?.id;
  const planId = priceId ? await deps.planIdForPrice(priceId) : null;
  const { start, end } = periodFrom(sub);
  const nowIso = (deps.now?.() ?? new Date()).toISOString();
  const previousPastDue = await deps.existingPastDueSince(userId);

  return {
    userId,
    planId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    status,
    currentPeriodStart: start,
    currentPeriodEnd: end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    canceledAt: toIso(sub.canceled_at),
    pastDueSince: status === "past_due" ? (previousPastDue ?? nowIso) : null,
  };
}

const LIVE: ReadonlySet<SubscriptionStatus> = new Set(["active", "trialing", "past_due"]);
const DEAD: ReadonlySet<SubscriptionStatus> = new Set(["canceled", "incomplete_expired", "unpaid"]);

/**
 * One row per user represents their CURRENT subscription. A late event about an OLD subscription (e.g. the
 * cancellation of the plan they replaced) must not overwrite a live current subscription.
 */
export function shouldReplaceSubscription(
  existing: { stripeSubscriptionId: string | null; status: SubscriptionStatus } | null,
  incoming: { stripeSubscriptionId: string; status: SubscriptionStatus },
): boolean {
  if (!existing || !existing.stripeSubscriptionId) return true;
  if (existing.stripeSubscriptionId === incoming.stripeSubscriptionId) return true;
  if (LIVE.has(existing.status) && DEAD.has(incoming.status)) return false;
  return true;
}

export async function processBillingEvent(event: StripeEventLike, deps: ProcessorDeps): Promise<ProcessOutcome> {
  const begin = await deps.beginEvent(event.id, event.type);
  if (begin === "duplicate") return { outcome: "duplicate" };

  try {
    if (!HANDLED.has(event.type)) {
      await deps.finishEvent(event.id, "ignored", { summary: { reason: "unhandled_type" } });
      return { outcome: "ignored" };
    }
    const subscriptionId = subscriptionIdFromEvent(event);
    if (!subscriptionId) {
      await deps.finishEvent(event.id, "ignored", { summary: { reason: "no_subscription_reference" } });
      return { outcome: "ignored" };
    }

    const sub = await deps.fetchSubscription(subscriptionId); // authoritative, current state
    const record = await recordFromStripe(sub, deps);
    await deps.upsertSubscription(record);
    await deps.finishEvent(event.id, "processed", { summary: { subscription: sub.id, status: record.status } });
    return { outcome: "processed" };
  } catch (err) {
    const message = (err instanceof Error ? err.message : "Unknown error").slice(0, 300);
    await deps.finishEvent(event.id, "failed", { error: message });
    return { outcome: "failed", error: message };
  }
}
