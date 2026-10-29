import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AuditLogRow, CurrencyBalanceRow, LedgerRow, TransactionListRow } from "@/types/database";
import { ledgerFilterSchema } from "./schemas";

export const LEDGER_PAGE_SIZE = 25;

type RawQuery = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseLedgerFilters(raw: RawQuery) {
  return ledgerFilterSchema.parse({ from: first(raw.from), to: first(raw.to), type: first(raw.type), page: first(raw.page) });
}

export async function getLedger(personId: string, raw: RawQuery) {
  const f = parseLedgerFilters(raw);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ledger_for_person", {
    p_person_id: personId, p_from: f.from ?? null, p_to: f.to ?? null, p_type: f.type ?? null,
    p_dir: "desc", p_limit: LEDGER_PAGE_SIZE, p_offset: (f.page - 1) * LEDGER_PAGE_SIZE,
  });
  if (error) throw new Error("Could not load the ledger");
  const rows = (data ?? []) as LedgerRow[];
  return { rows, total: Number(rows[0]?.total_count ?? 0), filters: f };
}

/** Person-level totals per currency (valid rows only), computed by the database. */
export async function getPersonTotals(personId: string): Promise<CurrencyBalanceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("person_totals", { p_person_id: personId });
  if (error) throw new Error("Could not load totals");
  return (data ?? []) as CurrencyBalanceRow[];
}

export async function getAllTransactions(raw: RawQuery, personId?: string) {
  const f = parseLedgerFilters(raw);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_transactions", {
    p_from: f.from ?? null, p_to: f.to ?? null, p_type: f.type ?? null, p_person: personId ?? null,
    p_limit: LEDGER_PAGE_SIZE, p_offset: (f.page - 1) * LEDGER_PAGE_SIZE,
  });
  if (error) throw new Error("Could not load transactions");
  const rows = (data ?? []) as TransactionListRow[];
  return { rows, total: Number(rows[0]?.total_count ?? 0), filters: f };
}

export async function getAuditTrail(transactionId: string): Promise<AuditLogRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("transaction_audit_logs")
    .select("id, transaction_id, action, before_snapshot, after_snapshot, reason, created_at")
    .eq("transaction_id", transactionId).order("created_at", { ascending: true });
  return (data ?? []) as AuditLogRow[];
}
