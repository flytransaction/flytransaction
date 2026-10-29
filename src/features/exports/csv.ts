import "server-only";
import { CSV_BOM, csvRow } from "./sanitize";
import { formatTimestamp } from "./format";
import { TotalsAccumulator } from "@/features/transactions/ledger";
import type { LedgerRow, PeopleListRow, TransactionListRow } from "@/types/database";

const label = (t: string) => (t === "received" ? "Received" : "Given");

export async function* peopleCsv(rows: AsyncGenerator<PeopleListRow>): AsyncGenerator<string> {
  yield CSV_BOM + csvRow(["Person", "Phone", "Email", "Currency", "Total received", "Total given", "Outstanding", "Last transaction date"]);
  for await (const p of rows) {
    if (p.balances.length === 0) {
      yield csvRow([p.name, p.phone, p.email, "", "0.00", "0.00", "0.00", p.last_transaction_date]);
    } else {
      for (const b of p.balances) {
        yield csvRow([p.name, p.phone, p.email, b.currency, b.total_received, b.total_given, b.outstanding, p.last_transaction_date]);
      }
    }
  }
}

export async function* transactionsCsv(rows: AsyncGenerator<TransactionListRow>, timeZone: string): AsyncGenerator<string> {
  yield CSV_BOM + csvRow(["Date", "Person", "Type", "Currency", "Amount received", "Amount given", "Status", "Note", "Reference", "Created at"]);
  const totals = new TotalsAccumulator();
  for await (const t of rows) {
    totals.add(t);
    yield csvRow([
      t.transaction_date, t.person_name, label(t.transaction_type), t.currency,
      t.transaction_type === "received" ? t.amount : "", t.transaction_type === "given" ? t.amount : "",
      t.status === "valid" ? "Valid" : "Voided", t.note, t.reference_number, formatTimestamp(t.created_at, timeZone),
    ]);
  }
  yield* totalsRows(totals, 10);
}

export async function* ledgerCsv(rows: AsyncGenerator<LedgerRow>, personName: string, timeZone: string): AsyncGenerator<string> {
  yield CSV_BOM + csvRow(["Person", "Date", "Type", "Currency", "Amount received", "Amount given", "Status", "Note", "Reference", "Running balance", "Created at"]);
  const totals = new TotalsAccumulator();
  for await (const r of rows) {
    totals.add(r);
    yield csvRow([
      personName, r.transaction_date, label(r.transaction_type), r.currency,
      r.transaction_type === "received" ? r.amount : "", r.transaction_type === "given" ? r.amount : "",
      r.status === "valid" ? "Valid" : "Voided", r.note, r.reference_number, r.running_balance ?? "", formatTimestamp(r.created_at, timeZone),
    ]);
  }
  yield* totalsRows(totals, 11);
}

function* totalsRows(totals: TotalsAccumulator, width: number): Generator<string> {
  for (const t of totals.result()) {
    const row: Array<string | null> = Array.from({ length: width }, () => "");
    row[0] = "TOTAL (valid entries)";
    row[3] = t.currency;
    row[4] = t.totalReceived;
    row[5] = t.totalGiven;
    row[width === 11 ? 9 : 6] = t.outstanding;
    yield csvRow(row);
  }
}
