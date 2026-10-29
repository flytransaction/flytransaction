import { describe, expect, it } from "vitest";
import {
  processBillingEvent, shouldReplaceSubscription, subscriptionIdFromEvent,
  type BeginResult, type ProcessorDeps, type StripeEventLike, type StripeSubscriptionLike, type SubscriptionRecord,
} from "@/features/billing/webhook-processor";

const NOW = new Date("2026-10-28T12:00:00.000Z");
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** In-memory stand-in for the database + Stripe API. */
function makeWorld(initial: Partial<{ customers: Record<string, string>; subs: Record<string, StripeSubscriptionLike> }> = {}) {
  const events = new Map<string, { type: string; status: string; attempts: number; error?: string }>();
  const rows = new Map<string, SubscriptionRecord>();
  const stripeSubs: Record<string, StripeSubscriptionLike> = { ...(initial.subs ?? {}) };
  const customers: Record<string, string> = { cus_1: "user-1", ...(initial.customers ?? {}) };
  let stripeFetches = 0;

  const deps: ProcessorDeps = {
    now: () => NOW,
    async beginEvent(id, type): Promise<BeginResult> {
      const ex = events.get(id);
      if (!ex) { events.set(id, { type, status: "received", attempts: 1 }); return "new"; }
      if (ex.status === "processed" || ex.status === "ignored") return "duplicate";
      ex.attempts += 1;
      return "retry";
    },
    async finishEvent(id, status, info) {
      const ex = events.get(id)!;
      ex.status = status;
      ex.error = info?.error;
    },
    async fetchSubscription(id) {
      stripeFetches += 1;
      const s = stripeSubs[id];
      if (!s) throw new Error("No such subscription");
      return s;
    },
    async userIdForCustomer(c) { return customers[c] ?? null; },
    async planIdForPrice(p) { return p === "price_monthly" ? "plan-monthly" : p === "price_yearly" ? "plan-yearly" : null; },
    async existingPastDueSince(u) { return rows.get(u)?.pastDueSince ?? null; },
    async upsertSubscription(r) { rows.set(r.userId, r); },
  };
  return { deps, events, rows, stripeSubs, fetches: () => stripeFetches };
}

const sub = (over: Partial<StripeSubscriptionLike> = {}): StripeSubscriptionLike => ({
  id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: false, canceled_at: null,
  current_period_start: unix("2026-10-28T00:00:00Z"), current_period_end: unix("2026-11-28T00:00:00Z"),
  items: { data: [{ price: { id: "price_monthly" } }] }, ...over,
});

const ev = (id: string, type: string, object: Record<string, unknown>): StripeEventLike => ({ id, type, data: { object } });

describe("subscriptionIdFromEvent", () => {
  it("finds the subscription across event shapes", () => {
    expect(subscriptionIdFromEvent(ev("e", "customer.subscription.updated", { id: "sub_1" }))).toBe("sub_1");
    expect(subscriptionIdFromEvent(ev("e", "checkout.session.completed", { mode: "subscription", subscription: "sub_2" }))).toBe("sub_2");
    expect(subscriptionIdFromEvent(ev("e", "checkout.session.completed", { mode: "payment", subscription: "sub_2" }))).toBeNull();
    expect(subscriptionIdFromEvent(ev("e", "invoice.paid", { subscription: "sub_3" }))).toBe("sub_3");
    expect(subscriptionIdFromEvent(ev("e", "invoice.paid", { parent: { subscription_details: { subscription: "sub_4" } } }))).toBe("sub_4");
  });
});

describe("processBillingEvent", () => {
  it("activates a subscription after checkout (state comes from Stripe, not the payload)", async () => {
    const w = makeWorld({ subs: { sub_1: sub() } });
    const out = await processBillingEvent(ev("evt_1", "checkout.session.completed", { mode: "subscription", subscription: "sub_1", payment_status: "unpaid" }), w.deps);
    expect(out.outcome).toBe("processed");
    expect(w.rows.get("user-1")).toMatchObject({ status: "active", planId: "plan-monthly", cancelAtPeriodEnd: false, pastDueSince: null });
    expect(w.rows.get("user-1")?.currentPeriodEnd).toBe("2026-11-28T00:00:00.000Z");
  });

  it("a duplicate delivery changes nothing and does not call Stripe again", async () => {
    const w = makeWorld({ subs: { sub_1: sub() } });
    const event = ev("evt_1", "customer.subscription.created", { id: "sub_1" });
    expect((await processBillingEvent(event, w.deps)).outcome).toBe("processed");
    const fetchesAfterFirst = w.fetches();
    expect((await processBillingEvent(event, w.deps)).outcome).toBe("duplicate");
    expect(w.fetches()).toBe(fetchesAfterFirst);
    expect(w.events.get("evt_1")?.status).toBe("processed");
  });

  it("handles renewal by moving the period forward", async () => {
    const w = makeWorld({ subs: { sub_1: sub() } });
    await processBillingEvent(ev("evt_1", "customer.subscription.created", { id: "sub_1" }), w.deps);
    w.stripeSubs.sub_1 = sub({ current_period_start: unix("2026-11-28T00:00:00Z"), current_period_end: unix("2026-12-28T00:00:00Z") });
    await processBillingEvent(ev("evt_2", "invoice.paid", { subscription: "sub_1" }), w.deps);
    expect(w.rows.get("user-1")?.currentPeriodEnd).toBe("2026-12-28T00:00:00.000Z");
  });

  it("records cancellation scheduled at period end while still active", async () => {
    const w = makeWorld({ subs: { sub_1: sub({ cancel_at_period_end: true }) } });
    await processBillingEvent(ev("evt_1", "customer.subscription.updated", { id: "sub_1" }), w.deps);
    expect(w.rows.get("user-1")).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
  });

  it("records expiration (canceled) from the deleted event", async () => {
    const w = makeWorld({ subs: { sub_1: sub({ status: "canceled", canceled_at: unix("2026-11-28T00:00:00Z") }) } });
    await processBillingEvent(ev("evt_1", "customer.subscription.deleted", { id: "sub_1" }), w.deps);
    expect(w.rows.get("user-1")).toMatchObject({ status: "canceled", canceledAt: "2026-11-28T00:00:00.000Z" });
  });

  it("failed payment sets past_due and stamps past_due_since once; recovery clears it", async () => {
    const w = makeWorld({ subs: { sub_1: sub({ status: "past_due" }) } });
    await processBillingEvent(ev("evt_1", "invoice.payment_failed", { subscription: "sub_1" }), w.deps);
    expect(w.rows.get("user-1")).toMatchObject({ status: "past_due", pastDueSince: NOW.toISOString() });

    // a second failure later must NOT push the grace window forward
    const later = new Date("2026-10-30T12:00:00.000Z");
    w.deps.now = () => later;
    await processBillingEvent(ev("evt_2", "invoice.payment_failed", { subscription: "sub_1" }), w.deps);
    expect(w.rows.get("user-1")?.pastDueSince).toBe(NOW.toISOString());

    w.stripeSubs.sub_1 = sub({ status: "active" });
    await processBillingEvent(ev("evt_3", "invoice.paid", { subscription: "sub_1" }), w.deps);
    expect(w.rows.get("user-1")).toMatchObject({ status: "active", pastDueSince: null });
  });

  it("out-of-order delivery cannot regress state because Stripe is re-queried", async () => {
    const w = makeWorld({ subs: { sub_1: sub({ status: "active" }) } });
    // an OLD 'past_due' event arrives after the subscription has recovered
    await processBillingEvent(ev("evt_old", "customer.subscription.updated", { id: "sub_1", status: "past_due" }), w.deps);
    expect(w.rows.get("user-1")?.status).toBe("active");
  });

  it("ignores unrelated event types without touching state", async () => {
    const w = makeWorld();
    const out = await processBillingEvent(ev("evt_1", "customer.created", { id: "cus_9" }), w.deps);
    expect(out.outcome).toBe("ignored");
    expect(w.rows.size).toBe(0);
    expect(w.fetches()).toBe(0);
  });

  it("fails (so Stripe retries) for a customer this app did not create, then succeeds on retry", async () => {
    const w = makeWorld({ subs: { sub_1: sub() } });
    const mapping: Record<string, string> = {};
    w.deps.userIdForCustomer = async (c) => mapping[c] ?? null;

    const event = ev("evt_1", "customer.subscription.created", { id: "sub_1" });
    const first = await processBillingEvent(event, w.deps);
    expect(first.outcome).toBe("failed");
    expect(w.events.get("evt_1")?.status).toBe("failed");
    expect(w.rows.size).toBe(0);

    mapping["cus_1"] = "user-1"; // e.g. the customer row finished committing
    const retry = await processBillingEvent(event, w.deps);
    expect(retry.outcome).toBe("processed");
    expect(w.events.get("evt_1")?.attempts).toBe(2);
    expect(w.rows.get("user-1")?.status).toBe("active");
  });

  it("fails on Stripe API errors and on unexpected statuses without writing", async () => {
    const w = makeWorld({ subs: { sub_1: sub({ status: "mystery" }) } });
    expect((await processBillingEvent(ev("e1", "customer.subscription.updated", { id: "sub_1" }), w.deps)).outcome).toBe("failed");
    expect((await processBillingEvent(ev("e2", "customer.subscription.updated", { id: "sub_missing" }), w.deps)).outcome).toBe("failed");
    expect(w.rows.size).toBe(0);
  });

  it("reads period dates from subscription items on newer Stripe API versions", async () => {
    const w = makeWorld({
      subs: {
        sub_1: sub({
          current_period_start: undefined, current_period_end: undefined,
          items: { data: [{ price: { id: "price_yearly" }, current_period_start: unix("2026-10-28T00:00:00Z"), current_period_end: unix("2027-10-28T00:00:00Z") }] },
        }),
      },
    });
    await processBillingEvent(ev("evt_1", "customer.subscription.created", { id: "sub_1" }), w.deps);
    expect(w.rows.get("user-1")).toMatchObject({ planId: "plan-yearly", currentPeriodEnd: "2027-10-28T00:00:00.000Z" });
  });
});

describe("shouldReplaceSubscription", () => {
  it("lets a new subscription replace nothing, a dead one, or itself", () => {
    expect(shouldReplaceSubscription(null, { stripeSubscriptionId: "sub_new", status: "active" })).toBe(true);
    expect(shouldReplaceSubscription({ stripeSubscriptionId: "sub_old", status: "canceled" }, { stripeSubscriptionId: "sub_new", status: "active" })).toBe(true);
    expect(shouldReplaceSubscription({ stripeSubscriptionId: "sub_1", status: "active" }, { stripeSubscriptionId: "sub_1", status: "canceled" })).toBe(true);
  });
  it("a late 'canceled' for an OLD subscription cannot clobber the live current one", () => {
    expect(shouldReplaceSubscription({ stripeSubscriptionId: "sub_new", status: "active" }, { stripeSubscriptionId: "sub_old", status: "canceled" })).toBe(false);
    expect(shouldReplaceSubscription({ stripeSubscriptionId: "sub_new", status: "past_due" }, { stripeSubscriptionId: "sub_old", status: "unpaid" })).toBe(false);
  });
});
