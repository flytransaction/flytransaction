import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DashboardSummary, PeopleListRow, Person, TransactionListRow } from "@/types/database";
import { peopleQuerySchema } from "./schemas";

export const PAGE_SIZE = 15;

export async function listPeople(rawQuery: Record<string, string | string[] | undefined>, currency: string) {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const candidate = peopleQuerySchema.safeParse({
    q: first(rawQuery.q), sort: first(rawQuery.sort) ?? undefined, dir: first(rawQuery.dir) ?? undefined, page: first(rawQuery.page) ?? undefined,
  });
  // Hand-edited or stale URLs fall back to defaults instead of crashing the page.
  const q = candidate.success ? candidate.data : peopleQuerySchema.parse({});
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_people", {
    p_search: q.q ?? null, p_sort: q.sort, p_dir: q.dir, p_currency: currency,
    p_limit: PAGE_SIZE, p_offset: (q.page - 1) * PAGE_SIZE,
  });
  if (error) throw new Error("Could not load people");
  const rows = (data ?? []) as PeopleListRow[];
  return { rows, total: Number(rows[0]?.total_count ?? 0), query: q };
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_summary");
  if (error) throw new Error("Could not load summary");
  return data as DashboardSummary;
}

export async function recentTransactions(limit = 6): Promise<TransactionListRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_transactions", { p_limit: limit, p_offset: 0 });
  if (error) throw new Error("Could not load recent transactions");
  return (data ?? []) as TransactionListRow[];
}

/** RLS guarantees only the caller's own, non-archived person can come back. */
export async function getPerson(personId: string): Promise<Person | null> {
  if (!/^[0-9a-f-]{36}$/i.test(personId)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("people").select("*").eq("id", personId).is("archived_at", null).maybeSingle();
  return (data as Person | null) ?? null;
}
