import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LedgerRow, PeopleListRow, TransactionListRow } from "@/types/database";

/**
 * Streaming data access for exports: fixed-size pages pulled lazily, so memory stays flat no matter how
 * many rows a user has. Every call goes through the user's own RLS-scoped client.
 */
const PAGE = 500;

export interface DateFilters {
  from?: string;
  to?: string;
  type?: "received" | "given";
}

export async function* iteratePeople(supabase: SupabaseClient, currency: string): AsyncGenerator<PeopleListRow> {
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase.rpc("list_people", {
      p_search: null, p_sort: "name", p_dir: "asc", p_currency: currency, p_limit: 200, p_offset: offset,
    });
    if (error) throw new Error("export_query_failed");
    const rows = (data ?? []) as PeopleListRow[];
    for (const r of rows) yield r;
    if (rows.length < 200) return;
  }
}

export async function* iterateTransactions(supabase: SupabaseClient, f: DateFilters, personId?: string): AsyncGenerator<TransactionListRow> {
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.rpc("list_transactions", {
      p_from: f.from ?? null, p_to: f.to ?? null, p_type: f.type ?? null, p_person: personId ?? null,
      p_limit: PAGE, p_offset: offset,
    });
    if (error) throw new Error("export_query_failed");
    const rows = (data ?? []) as TransactionListRow[];
    for (const r of rows) yield r;
    if (rows.length < PAGE) return;
  }
}

export async function* iterateLedger(supabase: SupabaseClient, personId: string, f: DateFilters): AsyncGenerator<LedgerRow> {
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.rpc("ledger_for_person", {
      p_person_id: personId, p_from: f.from ?? null, p_to: f.to ?? null, p_type: f.type ?? null,
      p_dir: "asc", p_limit: PAGE, p_offset: offset,
    });
    if (error) throw new Error("export_query_failed");
    const rows = (data ?? []) as LedgerRow[];
    for (const r of rows) yield r;
    if (rows.length < PAGE) return;
  }
}

/** Raw table pages for the complete account-data export (explicit column lists; money as text). */
export async function* iterateTable(
  supabase: SupabaseClient,
  table: "people" | "transactions" | "transaction_audit_logs",
): AsyncGenerator<Record<string, unknown>> {
  const select = {
    people: "id, name, phone, email, address, notes, created_at, updated_at, archived_at",
    transactions:
      "id, person_id, transaction_type, amount:amount::text, currency, transaction_date, note, reference_number, status, void_reason, replaces_transaction_id, created_at, voided_at",
    transaction_audit_logs: "id, transaction_id, action, before_snapshot, after_snapshot, reason, created_at",
  }[table];
  const order = table === "transaction_audit_logs" ? "id" : "created_at";
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from(table).select(select).order(order, { ascending: true }).order("id", { ascending: true }).range(offset, offset + PAGE - 1);
    if (error) throw new Error("export_query_failed");
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    for (const r of rows) yield r;
    if (rows.length < PAGE) return;
  }
}
