import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
import { reconcileSubscriptions } from "@/features/billing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${serverEnv("CRON_SECRET")}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Daily: reconcile subscriptions with Stripe, then purge accounts whose deletion retention window has passed. */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const reconcile = await reconcileSubscriptions({ limit: 100 });

  const admin = createAdminClient();
  const { data: retention } = await admin.from("app_settings").select("value").eq("key", "account_retention_days").maybeSingle();
  const days = typeof retention?.value === "number" ? retention.value : 30;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

  const { data: due } = await admin.from("profiles").select("id").lt("deletion_requested_at", cutoff).limit(25);
  let purged = 0;
  for (const p of due ?? []) {
    const userId = p.id as string;
    try {
      const { data: sub } = await admin.from("subscriptions").select("stripe_subscription_id, status").eq("user_id", userId).maybeSingle();
      if (sub?.stripe_subscription_id && !["canceled", "incomplete_expired"].includes(sub.status as string)) {
        await stripe().subscriptions.cancel(sub.stripe_subscription_id as string);
      }
      // Cascades through profiles -> people -> transactions, audit logs, subscriptions, billing customers.
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
      await admin.from("admin_audit_logs").insert({ admin_id: null, action: "account_purged", target_type: "user", target_id: userId });
      purged += 1;
    } catch {
      // Left in place; retried on the next run.
    }
  }
  return NextResponse.json({ reconcile, purged });
}
