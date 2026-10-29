import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Plan, SubscriptionRow } from "@/types/database";

/** Every admin read goes through the signed-in admin's session, so RLS/RPC re-verify the role. */
export async function adminStats() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_stats");
  if (error) throw new Error("forbidden");
  return data as Record<string, number>;
}

export interface AdminUserRow {
  id: string; full_name: string; email: string | null; role: "user" | "super_admin";
  suspended_at: string | null; deletion_requested_at: string | null; created_at: string; email_confirmed_at: string | null;
  subscription_status: string | null; current_period_end: string | null; cancel_at_period_end: boolean | null; total_count: number;
}

export async function adminUsers(search: string | undefined, page: number, pageSize = 25) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_users", { p_search: search ?? null, p_limit: pageSize, p_offset: (page - 1) * pageSize });
  if (error) throw new Error("forbidden");
  const rows = (data ?? []) as AdminUserRow[];
  return { rows, total: Number(rows[0]?.total_count ?? 0) };
}

export async function adminPlans(): Promise<Plan[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("plans").select("*").order("billing_interval").order("created_at", { ascending: false });
  return (data ?? []) as Plan[];
}

export async function adminSubscriptions(page: number, pageSize = 25) {
  const supabase = await createClient();
  const { data, count } = await supabase
    .from("subscriptions")
    .select("*, profiles(email, full_name), plans(name)", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  return { rows: (data ?? []) as unknown as Array<SubscriptionRow & { profiles: { email: string | null; full_name: string } | null; plans: { name: string } | null }>, total: count ?? 0 };
}

export interface BillingEventRow {
  id: string; provider_event_id: string; event_type: string; status: "received" | "processed" | "failed" | "ignored";
  attempts: number; error: string | null; received_at: string; processed_at: string | null;
}

export async function adminBillingEvents(status: string | undefined, page: number, pageSize = 30) {
  const supabase = await createClient();
  let q = supabase.from("billing_events").select("id, provider_event_id, event_type, status, attempts, error, received_at, processed_at", { count: "exact" })
    .order("received_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  if (status && ["received", "processed", "failed", "ignored"].includes(status)) q = q.eq("status", status);
  const { data, count } = await q;
  return { rows: (data ?? []) as BillingEventRow[], total: count ?? 0 };
}

export async function adminAuditLogs(page: number, pageSize = 40) {
  const supabase = await createClient();
  const { data, count } = await supabase
    .from("admin_audit_logs").select("id, admin_id, action, target_type, target_id, details, created_at", { count: "exact" })
    .order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  return {
    rows: (data ?? []) as Array<{ id: number; admin_id: string | null; action: string; target_type: string | null; target_id: string | null; details: Record<string, unknown>; created_at: string }>,
    total: count ?? 0,
  };
}

export async function adminSettings() {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("key, value, updated_at");
  return Object.fromEntries((data ?? []).map((r) => [r.key as string, r.value as unknown]));
}
