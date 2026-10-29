/**
 * Live isolation tests against a REAL Supabase project (local `supabase start` or a dedicated test project).
 * Skipped unless TEST_SUPABASE_URL / TEST_SUPABASE_PUBLISHABLE_KEY / TEST_SUPABASE_SECRET_KEY are set.
 * NEVER point these at production: the test creates and deletes users.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.TEST_SUPABASE_URL;
const publishable = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.TEST_SUPABASE_SECRET_KEY;
const enabled = Boolean(url && publishable && secret);
const suite = enabled ? describe : describe.skip;

suite("RLS isolation (live database)", () => {
  const admin = createClient(url ?? "http://x", secret ?? "x", { auth: { persistSession: false } });
  const stamp = Date.now();
  const password = "Test-Passw0rd!x";
  const users: Record<"a" | "b" | "c", { id: string; email: string; client: SupabaseClient }> = {} as never;
  let personA = "";
  let txA = "";

  async function makeUser(tag: "a" | "b" | "c", subscribed: boolean) {
    const email = `rls-${tag}-${stamp}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw error ?? new Error("createUser failed");
    if (subscribed) {
      await admin.from("subscriptions").insert({
        user_id: data.user.id, stripe_customer_id: `cus_test_${tag}_${stamp}`, stripe_subscription_id: `sub_test_${tag}_${stamp}`,
        status: "active", current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });
    }
    const client = createClient(url as string, publishable as string, { auth: { persistSession: false } });
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;
    users[tag] = { id: data.user.id, email, client };
  }

  beforeAll(async () => {
    await makeUser("a", true);
    await makeUser("b", true);
    await makeUser("c", false); // verified but not subscribed
    const { data: person, error } = await users.a.client.from("people").insert({ owner_id: users.a.id, name: "Ahmed" }).select("id").single();
    if (error) throw error;
    personA = person.id as string;
    const { data: tx, error: txError } = await users.a.client.rpc("add_transaction", {
      p_person_id: personA, p_type: "received", p_amount: 5000, p_currency: "INR", p_date: "2026-10-28", p_note: "Payment", p_reference: null, p_idempotency_key: `key-${stamp}-1`,
    });
    if (txError) throw txError;
    txA = (tx as { id: string }).id;
  });

  afterAll(async () => {
    for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
  });

  it("owner can read their own data", async () => {
    const { data } = await users.a.client.from("people").select("id");
    expect(data?.map((r) => r.id)).toContain(personA);
  });

  it("User B cannot read User A's people, transactions, ledger or totals", async () => {
    expect((await users.b.client.from("people").select("id").eq("id", personA)).data).toEqual([]);
    expect((await users.b.client.from("transactions").select("id").eq("id", txA)).data).toEqual([]);
    expect((await users.b.client.rpc("ledger_for_person", { p_person_id: personA })).data).toEqual([]);
    expect((await users.b.client.rpc("person_totals", { p_person_id: personA })).data).toEqual([]);
  });

  it("User B cannot modify or add to User A's records", async () => {
    const upd = await users.b.client.from("people").update({ name: "Hacked" }).eq("id", personA).select("id");
    expect(upd.data ?? []).toEqual([]);
    const add = await users.b.client.rpc("add_transaction", { p_person_id: personA, p_type: "given", p_amount: 1, p_currency: "INR", p_date: "2026-10-28" });
    expect(add.error?.message).toBe("person_not_found");
    const voided = await users.b.client.rpc("void_transaction", { p_transaction_id: txA, p_reason: "attack" });
    expect(voided.error?.message).toBe("transaction_not_found");
  });

  it("a user cannot forge an owner id", async () => {
    const r = await users.b.client.from("people").insert({ owner_id: users.a.id, name: "Forged" });
    expect(r.error).not.toBeNull();
  });

  it("a user cannot promote themselves or edit trusted columns", async () => {
    const role = await users.b.client.from("profiles").update({ role: "super_admin" }).eq("id", users.b.id);
    expect(role.error).not.toBeNull();
    const { data } = await admin.from("profiles").select("role").eq("id", users.b.id).single();
    expect(data?.role).toBe("user");
    const sub = await users.b.client.from("subscriptions").update({ status: "active" }).eq("user_id", users.b.id);
    expect(sub.error).not.toBeNull();
  });

  it("a regular user cannot call admin functions or read billing tables", async () => {
    expect((await users.b.client.rpc("admin_stats")).error?.message).toBe("forbidden");
    expect((await users.b.client.from("billing_events").select("id")).data ?? []).toEqual([]);
    expect((await users.b.client.from("billing_customers").select("user_id")).error).not.toBeNull();
  });

  it("ledger tables cannot be written directly", async () => {
    const ins = await users.a.client.from("transactions").insert({
      owner_id: users.a.id, person_id: personA, transaction_type: "received", amount: 1, currency: "INR", transaction_date: "2026-10-28", created_by: users.a.id, updated_by: users.a.id,
    });
    expect(ins.error).not.toBeNull();
    expect((await users.a.client.from("transactions").delete().eq("id", txA)).error).not.toBeNull();
  });

  it("an unsubscribed (but verified) user cannot reach transaction data by direct API calls", async () => {
    const c = users.c.client;
    expect((await c.from("people").select("id")).data).toEqual([]);
    expect((await c.from("people").insert({ owner_id: users.c.id, name: "x" })).error).not.toBeNull();
    const rpc = await c.rpc("add_transaction", { p_person_id: personA, p_type: "received", p_amount: 1, p_currency: "INR", p_date: "2026-10-28" });
    expect(rpc.error?.message).toBe("subscription_required");
    // ...but their profile is still readable so login and renewal keep working
    expect((await c.from("profiles").select("id").eq("id", users.c.id)).data).toHaveLength(1);
  });

  it("an expired subscription blocks A, and renewing restores access without data loss", async () => {
    await admin.from("subscriptions").update({ status: "canceled" }).eq("user_id", users.a.id);
    expect((await users.a.client.from("people").select("id")).data).toEqual([]);
    await admin.from("subscriptions").update({ status: "active" }).eq("user_id", users.a.id);
    expect((await users.a.client.from("people").select("id").eq("id", personA)).data).toHaveLength(1);
  });
});
