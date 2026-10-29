import { minorToDecimal, parseMinor } from "@/lib/money";

export type TxType = "received" | "given";
export type TxStatus = "valid" | "voided";

export interface LedgerEntry {
  transaction_type: TxType;
  status: TxStatus;
  amount: string;
  currency: string;
}

export interface CurrencyTotals {
  currency: string;
  totalReceived: string;
  totalGiven: string;
  outstanding: string; // received - given; may be negative
}

export type BalanceDirection = "owes_you" | "you_owe" | "settled";

/**
 * Totals per currency over VALID entries only. Currencies are never combined.
 * The database computes the same figures for the UI; this implementation is used for export
 * statements and as the reference model that tests compare with the SQL behaviour.
 */
export class TotalsAccumulator {
  private readonly byCurrency = new Map<string, { received: bigint; given: bigint }>();

  add(entry: LedgerEntry): void {
    if (entry.status !== "valid") return;
    const minor = parseMinor(entry.amount, entry.currency);
    const cur = this.byCurrency.get(entry.currency) ?? { received: 0n, given: 0n };
    if (entry.transaction_type === "received") cur.received += minor;
    else cur.given += minor;
    this.byCurrency.set(entry.currency, cur);
  }

  result(): CurrencyTotals[] {
    return [...this.byCurrency.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, v]) => ({
        currency,
        totalReceived: minorToDecimal(v.received, currency),
        totalGiven: minorToDecimal(v.given, currency),
        outstanding: minorToDecimal(v.received - v.given, currency),
      }));
  }
}

export function computeTotals(entries: Iterable<LedgerEntry>): CurrencyTotals[] {
  const acc = new TotalsAccumulator();
  for (const e of entries) acc.add(e);
  return acc.result();
}

/**
 * Direction of an outstanding balance (received - given), from the owner's point of view:
 * positive => the person owes you that amount (ledger model in the product spec);
 * negative => you owe the person; zero => settled.
 */
export function balanceDirection(outstanding: string, currency: string): BalanceDirection {
  const negative = outstanding.startsWith("-");
  const minor = parseMinor(negative ? outstanding.slice(1) : outstanding, currency);
  if (minor === 0n) return "settled";
  return negative ? "you_owe" : "owes_you";
}

export function absoluteAmount(outstanding: string): string {
  return outstanding.startsWith("-") ? outstanding.slice(1) : outstanding;
}

export interface RunningRow extends LedgerEntry {
  id: string;
  transaction_date: string; // YYYY-MM-DD
  created_at: string; // ISO timestamp
}

/**
 * Reference implementation of the SQL window function in ledger_for_person():
 * order by (date, created_at, id), running balance per currency over valid rows only.
 * Voided rows get null.
 */
export function withRunningBalance(rows: RunningRow[]): Array<RunningRow & { running_balance: string | null }> {
  const sorted = [...rows].sort(
    (a, b) =>
      a.transaction_date.localeCompare(b.transaction_date) ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
  const running = new Map<string, bigint>();
  return sorted.map((r) => {
    if (r.status !== "valid") return { ...r, running_balance: null };
    const minor = parseMinor(r.amount, r.currency);
    const next = (running.get(r.currency) ?? 0n) + (r.transaction_type === "received" ? minor : -minor);
    running.set(r.currency, next);
    return { ...r, running_balance: minorToDecimal(next, r.currency) };
  });
}
