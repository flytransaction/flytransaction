import { describe, expect, it } from "vitest";
import cases from "../fixtures/access-cases.json";
import { evaluateAccess, redirectForReason, type SubscriptionSnapshot } from "@/features/billing/access-policy";

describe("evaluateAccess (shared case table, mirrored by public.has_app_access in SQL)", () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      const decision = evaluateAccess({
        emailConfirmed: c.emailConfirmed,
        suspended: c.suspended,
        deletionRequested: c.deletionRequested,
        subscription: c.subscription as SubscriptionSnapshot | null,
        now: new Date(cases.now),
        pastDueGraceDays: cases.graceDays,
      });
      expect(decision.allowed).toBe(c.allowed);
      expect(decision.reason).toBe(c.reason);
    });
  }

  it("honours a configured grace period", () => {
    const sub: SubscriptionSnapshot = {
      status: "past_due", current_period_end: "2026-10-01T00:00:00.000Z",
      past_due_since: "2026-10-24T12:00:00.000Z", cancel_at_period_end: false,
    };
    const base = { emailConfirmed: true, suspended: false, deletionRequested: false, subscription: sub, now: new Date(cases.now) };
    expect(evaluateAccess({ ...base, pastDueGraceDays: 3 }).allowed).toBe(false);
    expect(evaluateAccess({ ...base, pastDueGraceDays: 7 }).allowed).toBe(true);
  });

  it("routes ineligible users to the right page", () => {
    expect(redirectForReason("unverified")).toBe("/verify-email");
    expect(redirectForReason("no_subscription")).toBe("/pricing");
    expect(redirectForReason("period_ended")).toBe("/subscription-expired");
    expect(redirectForReason("past_due_grace_expired")).toBe("/subscription-expired");
    expect(redirectForReason("suspended")).toBe("/subscription-expired");
  });
});
