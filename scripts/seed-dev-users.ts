/**
 * Creates demo users + sample data for LOCAL development only.
 *   supabase start && npm run seed:dev
 * Refuses to run against a non-local Supabase URL unless ALLOW_REMOTE_SEED=1 (don't).
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from the environment (.env.local via your shell/dotenv).
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw new Error("Set SUPABASE_SECRET_KEY (local: `supabase status` shows the service_role/secret key).");
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url) && process.env.ALLOW_REMOTE_SEED !== "1") {
  throw new Error(`Refusing to seed a non-local project (${url}). Set ALLOW_REMOTE_SEED=1 only for a throwaway test project.`);
}

const admin = createClient(url, key, { auth: { persistSession: false } });
const PASSWORD = "DevPassw0rd!2026";
const day = 86_400_000;

async function ensureUser(email: string, name: string) {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users.find((u) => u.email === email);
  if (existing) return existing.id;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name } });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  return data.user.id;
}

async function setSubscription(userId: string, status: string, endsInDays: number) {
  await admin.from("subscriptions").upsert({
    user_id: userId, stripe_customer_id: `cus_dev_${userId.slice(0, 8)}`, stripe_subscription_id: `sub_dev_${userId.slice(0, 8)}`,
    status, current_period_start: new Date(Date.now() - 5 * day).toISOString(), current_period_end: new Date(Date.now() + endsInDays * day).toISOString(),
    cancel_at_period_end: false,
  }, { onConflict: "user_id" });
}

async function main() {
  const demo = await ensureUser("demo@example.test", "Demo User");
  const other = await ensureUser("other@example.test", "Other User");
  const expired = await ensureUser("expired@example.test", "Expired User");
  const boss = await ensureUser("admin@example.test", "Super Admin");

  await setSubscription(demo, "active", 25);
  await setSubscription(other, "active", 25);
  await setSubscription(expired, "canceled", -3);
  await admin.from("profiles").update({ role: "super_admin" }).eq("id", boss);

  const { count } = await admin.from("people").select("id", { count: "exact", head: true }).eq("owner_id", demo);
  if (!count) {
    const { data: people } = await admin.from("people").insert([
      { owner_id: demo, name: "Person A" }, { owner_id: demo, name: "Ahmed", phone: "+91 98765 43210" }, { owner_id: demo, name: "Person B" },
    ]).select("id, name");
    const byName = Object.fromEntries((people ?? []).map((p) => [p.name as string, p.id as string]));
    const tx = (person: string, type: "received" | "given", amount: number, date: string, note: string) => ({
      owner_id: demo, person_id: byName[person], transaction_type: type, amount, currency: "INR", transaction_date: date, note, created_by: demo, updated_by: demo,
    });
    const { data: rows } = await admin.from("transactions").insert([
      tx("Person B", "received", 5000, "2026-10-20", "Payment received for previous balance"),
      tx("Person B", "given", 2000, "2026-10-22", "Advance given"),
      tx("Ahmed", "received", 5000, "2026-10-28", "Payment received for previous balance"),
      tx("Ahmed", "given", 1000, "2026-10-28", "Advance given for personal expenses"),
    ]).select("id, owner_id");
    await admin.from("transaction_audit_logs").insert((rows ?? []).map((r) => ({ transaction_id: r.id, owner_id: demo, actor_id: demo, action: "created", after_snapshot: r })));
  }

  console.log(`Seeded. Password for every demo user: ${PASSWORD}`);
  console.log("  demo@example.test     active subscription, sample people");
  console.log("  other@example.test    second user (for isolation checks)");
  console.log("  expired@example.test  canceled subscription (renewal flow)");
  console.log("  admin@example.test    Super Admin");
  console.log("E2E env:  E2E_USER_EMAIL=demo@example.test E2E_USER_PASSWORD=" + PASSWORD + " E2E_EXPIRED_EMAIL=expired@example.test E2E_EXPIRED_PASSWORD=" + PASSWORD);
}

main().catch((e) => { console.error(e); process.exit(1); });
