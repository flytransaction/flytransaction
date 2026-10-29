import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_PAST_DUE_GRACE_DAYS, evaluateAccess, redirectForReason,
  type AccessDecision, type SubscriptionSnapshot,
} from "@/features/billing/access-policy";
import type { Profile, SubscriptionRow } from "@/types/database";

export interface SessionContext {
  userId: string;
  email: string | null;
  emailConfirmed: boolean;
  profile: Profile;
}

export interface AccessContext extends SessionContext {
  access: AccessDecision;
  subscription: SubscriptionRow | null;
}

/** Validated user + profile, or null. Cached per request. */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser(); // verifies the JWT with Supabase Auth
  if (error || !user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, time_zone, default_currency, suspended_at, deletion_requested_at, created_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return null;
  return {
    userId: user.id,
    email: user.email ?? null,
    emailConfirmed: Boolean(user.email_confirmed_at),
    profile: profile as Profile,
  };
});

/** The one place subscription eligibility is computed server-side. */
export const getAccess = cache(async (): Promise<AccessContext | null> => {
  const session = await getSession();
  if (!session) return null;
  const supabase = await createClient();

  const [{ data: sub }, { data: grace }] = await Promise.all([
    supabase.from("subscriptions").select("*").eq("user_id", session.userId).maybeSingle(),
    supabase.from("app_settings").select("value").eq("key", "past_due_grace_days").maybeSingle(),
  ]);
  const subscription = (sub as SubscriptionRow | null) ?? null;
  const graceDays = typeof grace?.value === "number" ? grace.value : DEFAULT_PAST_DUE_GRACE_DAYS;

  const snapshot: SubscriptionSnapshot | null = subscription
    ? {
        status: subscription.status,
        current_period_end: subscription.current_period_end,
        past_due_since: subscription.past_due_since,
        cancel_at_period_end: subscription.cancel_at_period_end,
      }
    : null;

  const access = evaluateAccess({
    emailConfirmed: session.emailConfirmed,
    suspended: session.profile.suspended_at !== null,
    deletionRequested: session.profile.deletion_requested_at !== null,
    subscription: snapshot,
    pastDueGraceDays: graceDays,
  });
  return { ...session, access, subscription };
});

/** Pages: must be signed in (any verification/subscription state). */
export async function requireUser(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Pages: signed in AND allowed to use the paid app; otherwise redirected to the right recovery page. */
export async function requireAccess(): Promise<AccessContext> {
  const ctx = await getAccess();
  if (!ctx) redirect("/login");
  if (!ctx.access.allowed) redirect(redirectForReason(ctx.access.reason));
  return ctx;
}

/** Pages: Super Admin only. Non-admins get a 404-style redirect, not a hint that /admin exists. */
export async function requireAdmin(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.profile.role !== "super_admin" || session.profile.suspended_at) redirect("/dashboard");
  return session;
}

/**
 * Server actions / route handlers: never redirect, return a typed failure instead.
 * (RLS and the SQL functions enforce the same rules again; this gives a friendlier error.)
 */
export async function getActionContext(opts: { needAccess: boolean }): Promise<
  { ok: true; ctx: AccessContext } | { ok: false; error: string }
> {
  const ctx = await getAccess();
  if (!ctx) return { ok: false, error: "Please sign in again." };
  if (opts.needAccess && !ctx.access.allowed) {
    return { ok: false, error: ctx.access.reason === "unverified" ? "Verify your email first." : "Your subscription is not active." };
  }
  return { ok: true, ctx };
}

export async function getAdminActionContext(): Promise<{ ok: true; ctx: SessionContext } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session || session.profile.role !== "super_admin" || session.profile.suspended_at) {
    return { ok: false, error: "You do not have permission to do that." };
  }
  return { ok: true, ctx: session };
}
