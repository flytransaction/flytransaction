/**
 * THE subscription access policy (single source of truth in TypeScript).
 * The SQL function public.has_app_access() mirrors it for RLS; both are exercised by the shared case table in
 * tests/fixtures/access-cases.json.
 *
 * Stripe is authoritative. The browser success redirect never grants access.
 *
 * | status                                         | access                                                          |
 * |------------------------------------------------|-----------------------------------------------------------------|
 * | active, trialing                               | until current_period_end (+ 6h webhook-latency buffer)          |
 * |   ...with cancel_at_period_end = true          | same: paid-through date is honoured                             |
 * | past_due                                       | grace of N days from past_due_since (default 3)                 |
 * | canceled                                       | NO (terminal at Stripe: ended now or at period end)             |
 * | unpaid, incomplete, incomplete_expired, paused | NO                                                              |
 * | no subscription                                | NO                                                              |
 */

export type SubscriptionStatus =
  | "incomplete" | "incomplete_expired" | "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "paused";

export interface SubscriptionSnapshot {
  status: SubscriptionStatus;
  current_period_end: string | null; // ISO
  past_due_since: string | null; // ISO
  cancel_at_period_end: boolean;
}

export interface AccessInput {
  emailConfirmed: boolean;
  suspended: boolean;
  deletionRequested: boolean;
  subscription: SubscriptionSnapshot | null;
  now?: Date;
  pastDueGraceDays?: number;
}

export type AccessReason =
  | "ok"
  | "unverified"
  | "suspended"
  | "deletion_pending"
  | "no_subscription"
  | "subscription_inactive"
  | "period_ended"
  | "past_due_grace_expired";

export interface AccessDecision {
  allowed: boolean;
  reason: AccessReason;
  /** Paid-through date (or grace end for past_due) when known. */
  accessUntil: string | null;
}

export const RENEWAL_BUFFER_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_PAST_DUE_GRACE_DAYS = 3;

export function evaluateAccess(input: AccessInput): AccessDecision {
  const now = (input.now ?? new Date()).getTime();
  const deny = (reason: AccessReason, accessUntil: string | null = null): AccessDecision => ({
    allowed: false, reason, accessUntil,
  });

  if (!input.emailConfirmed) return deny("unverified");
  if (input.suspended) return deny("suspended");
  if (input.deletionRequested) return deny("deletion_pending");

  const sub = input.subscription;
  if (!sub) return deny("no_subscription");

  switch (sub.status) {
    case "active":
    case "trialing": {
      if (!sub.current_period_end) return deny("period_ended");
      const end = Date.parse(sub.current_period_end);
      if (Number.isNaN(end) || end + RENEWAL_BUFFER_MS <= now) return deny("period_ended", sub.current_period_end);
      return { allowed: true, reason: "ok", accessUntil: sub.current_period_end };
    }
    case "past_due": {
      const since = sub.past_due_since ?? sub.current_period_end;
      if (!since) return deny("past_due_grace_expired");
      const graceDays = input.pastDueGraceDays ?? DEFAULT_PAST_DUE_GRACE_DAYS;
      const graceEnd = Date.parse(since) + graceDays * 86_400_000;
      const iso = new Date(graceEnd).toISOString();
      return graceEnd > now ? { allowed: true, reason: "ok", accessUntil: iso } : deny("past_due_grace_expired", iso);
    }
    default:
      return deny("subscription_inactive");
  }
}

/** Where an authenticated-but-ineligible user is sent. */
export function redirectForReason(reason: AccessReason): string {
  switch (reason) {
    case "unverified": return "/verify-email";
    case "no_subscription": return "/pricing";
    case "ok": return "/dashboard";
    default: return "/subscription-expired";
  }
}
