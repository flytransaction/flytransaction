import "server-only";
import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";
import { neutralizeFormula } from "./sanitize";
import { formatTimestamp } from "./format";
import { TotalsAccumulator } from "@/features/transactions/ledger";
import type { LedgerRow, PeopleListRow, TransactionListRow } from "@/types/database";

/** Cells hold real numbers/dates (not text) so Excel can sum them; money is shown with 2 decimals. */
const MONEY_FMT = "#,##0.00;[Red]-#,##0.00";
const text = (v: string | null | undefined) => (v ? neutralizeFormula(v) : "");
const num = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const dateCell = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function boot(name: string, columns: Array<{ header: string; key: string; width: number; style?: Partial<ExcelJS.Style> }>) {
  const pass = new PassThrough();
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: pass, useStyles: true, useSharedStrings: false });
  wb.creator = "Fly-Transaction";
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns;
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.commit();
  return { pass, wb, ws };
}

async function run(pass: PassThrough, wb: ExcelJS.stream.xlsx.WorkbookWriter, body: () => Promise<void>) {
  try {
    await body();
    await wb.commit();
  } catch (err) {
    pass.destroy(err instanceof Error ? err : new Error("export_failed"));
  }
}

export function peopleXlsx(rows: AsyncGenerator<PeopleListRow>): ReadableStream<Uint8Array> {
  const { pass, wb, ws } = boot("People", [
    { header: "Person", key: "name", width: 28 }, { header: "Phone", key: "phone", width: 16 },
    { header: "Email", key: "email", width: 28 }, { header: "Currency", key: "currency", width: 10 },
    { header: "Total received", key: "rec", width: 16, style: { numFmt: MONEY_FMT } },
    { header: "Total given", key: "giv", width: 16, style: { numFmt: MONEY_FMT } },
    { header: "Outstanding", key: "out", width: 16, style: { numFmt: MONEY_FMT } },
    { header: "Last transaction", key: "last", width: 16, style: { numFmt: "yyyy-mm-dd" } },
  ]);
  void run(pass, wb, async () => {
    for await (const p of rows) {
      const last = p.last_transaction_date ? dateCell(p.last_transaction_date) : null;
      const list = p.balances.length ? p.balances : [{ currency: "", total_received: "0", total_given: "0", outstanding: "0" }];
      for (const b of list) {
        ws.addRow({ name: text(p.name), phone: text(p.phone), email: text(p.email), currency: b.currency,
          rec: num(b.total_received), giv: num(b.total_given), out: num(b.outstanding), last }).commit();
      }
    }
    ws.commit();
  });
  return Readable.toWeb(pass) as unknown as ReadableStream<Uint8Array>;
}

export function transactionsXlsx(rows: AsyncGenerator<TransactionListRow>, timeZone: string): ReadableStream<Uint8Array> {
  const { pass, wb, ws } = boot("Transactions", [
    { header: "Date", key: "date", width: 12, style: { numFmt: "yyyy-mm-dd" } }, { header: "Person", key: "person", width: 26 },
    { header: "Type", key: "type", width: 10 }, { header: "Currency", key: "cur", width: 10 },
    { header: "Amount received", key: "rec", width: 16, style: { numFmt: MONEY_FMT } },
    { header: "Amount given", key: "giv", width: 16, style: { numFmt: MONEY_FMT } },
    { header: "Status", key: "status", width: 10 }, { header: "Note", key: "note", width: 40 },
    { header: "Reference", key: "ref", width: 16 }, { header: "Created at", key: "created", width: 18 },
  ]);
  void run(pass, wb, async () => {
    const totals = new TotalsAccumulator();
    for await (const t of rows) {
      totals.add(t);
      ws.addRow({
        date: dateCell(t.transaction_date), person: text(t.person_name), type: t.transaction_type === "received" ? "Received" : "Given",
        cur: t.currency, rec: t.transaction_type === "received" ? num(t.amount) : null, giv: t.transaction_type === "given" ? num(t.amount) : null,
        status: t.status === "valid" ? "Valid" : "Voided", note: text(t.note), ref: text(t.reference_number),
        created: formatTimestamp(t.created_at, timeZone),
      }).commit();
    }
    for (const t of totals.result()) {
      const r = ws.addRow({ person: "TOTAL (valid entries)", cur: t.currency, rec: num(t.totalReceived), giv: num(t.totalGiven), note: `Outstanding: ${t.outstanding}` });
      r.font = { bold: true };
      r.commit();
    }
    ws.commit();
  });
  return Readable.toWeb(pass) as unknown as ReadableStream<Uint8Array>;
}

export function ledgerXlsx(rows: AsyncGenerator<LedgerRow>, personName: string, timeZone: string): ReadableStream<Uint8Array> {
  const { pass, wb, ws } = boot("Ledger", [
    { header: "Person", key: "person", width: 24 }, { header: "Date", key: "date", width: 12, style: { numFmt: "yyyy-mm-dd" } },
    { header: "Type", key: "type", width: 10 }, { header: "Currency", key: "cur", width: 10 },
    { header: "Amount received", key: "rec", width: 16, style: { numFmt: MONEY_FMT } },
    { header: "Amount given", key: "giv", width: 16, style: { numFmt: MONEY_FMT } },
    { header: "Status", key: "status", width: 10 }, { header: "Note", key: "note", width: 40 },
    { header: "Reference", key: "ref", width: 16 },
    { header: "Running balance", key: "bal", width: 16, style: { numFmt: MONEY_FMT } },
    { header: "Created at", key: "created", width: 18 },
  ]);
  void run(pass, wb, async () => {
    const totals = new TotalsAccumulator();
    for await (const r of rows) {
      totals.add(r);
      ws.addRow({
        person: text(personName), date: dateCell(r.transaction_date), type: r.transaction_type === "received" ? "Received" : "Given",
        cur: r.currency, rec: r.transaction_type === "received" ? num(r.amount) : null, giv: r.transaction_type === "given" ? num(r.amount) : null,
        status: r.status === "valid" ? "Valid" : "Voided", note: text(r.note), ref: text(r.reference_number),
        bal: num(r.running_balance), created: formatTimestamp(r.created_at, timeZone),
      }).commit();
    }
    for (const t of totals.result()) {
      const row = ws.addRow({ person: "TOTAL (valid entries)", cur: t.currency, rec: num(t.totalReceived), giv: num(t.totalGiven), bal: num(t.outstanding) });
      row.font = { bold: true };
      row.commit();
    }
    ws.commit();
  });
  return Readable.toWeb(pass) as unknown as ReadableStream<Uint8Array>;
}
