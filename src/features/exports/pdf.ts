import "server-only";
import { PassThrough, Readable } from "node:stream";
import PDFDocument from "pdfkit";
import { TotalsAccumulator, type CurrencyTotals } from "@/features/transactions/ledger";
import { directionLabel, formatTimestamp } from "./format";
import type { LedgerRow } from "@/types/database";

/**
 * Account statement. PDFKit's built-in Helvetica covers Latin-1 only, so currency CODES are printed (not symbols
 * such as the rupee sign) and characters outside Latin-1 in notes are replaced with '?'. Embed a Unicode font
 * (see README, "PDF fonts") if you need other scripts.
 */
const latin = (s: string | null | undefined) => (s ?? "").replace(/[^\u0020-\u00FF]/g, "?");
const plain = (v: string, cur: string) => `${cur} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface StatementMeta {
  personName: string;
  timeZone: string;
  from?: string;
  to?: string;
  type?: string;
  allTime?: CurrencyTotals[]; // only when a filter hides part of the history
}

export function statementPdf(
  meta: StatementMeta,
  totals: CurrencyTotals[],
  rows: () => AsyncGenerator<LedgerRow>,
): ReadableStream<Uint8Array> {
  const pass = new PassThrough();
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: false, info: { Title: `Statement - ${latin(meta.personName)}`, Creator: "Fly-Transaction" } });
  doc.pipe(pass);

  void (async () => {
    try {
      const left = 40;
      const width = doc.page.width - 80;
      const cols = { date: left, type: left + 62, rec: left + 118, giv: left + 200, bal: left + 282, note: left + 372 };
      const noteWidth = left + width - cols.note;

      doc.font("Helvetica-Bold").fontSize(20).text("Fly-Transaction", left, 40);
      doc.font("Helvetica").fontSize(11).fillColor("#555").text("Account statement");
      doc.moveDown(0.8).fillColor("#000").font("Helvetica-Bold").fontSize(14).text(latin(meta.personName));
      doc.font("Helvetica").fontSize(9).fillColor("#444");
      const range = meta.from || meta.to ? `${meta.from ?? "start"} to ${meta.to ?? "today"}` : "All dates";
      doc.text(`Exported: ${formatTimestamp(new Date().toISOString(), meta.timeZone)} (${meta.timeZone})`);
      doc.text(`Date range: ${range}${meta.type ? `   |   Type: ${meta.type}` : ""}`);
      doc.moveDown(0.8);

      doc.fillColor("#000").font("Helvetica-Bold").fontSize(10).text(meta.from || meta.to || meta.type ? "Totals for the selected period" : "Totals");
      doc.font("Helvetica").fontSize(9);
      if (totals.length === 0) doc.text("No valid transactions in this range.");
      for (const t of totals) {
        doc.text(`${t.currency}   Received ${plain(t.totalReceived, t.currency)}   Given ${plain(t.totalGiven, t.currency)}   Outstanding ${plain(t.outstanding, t.currency)}`);
        doc.fillColor("#444").text(`      ${directionLabel(t.outstanding, t.currency)}`).fillColor("#000");
      }
      if (meta.allTime?.length) {
        doc.moveDown(0.5).font("Helvetica-Bold").text("Overall balance (all time)").font("Helvetica");
        for (const t of meta.allTime) doc.text(`${t.currency}   Outstanding ${plain(t.outstanding, t.currency)}   -   ${directionLabel(t.outstanding, t.currency)}`);
      }
      doc.moveDown(1);

      const header = () => {
        const y = doc.y;
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#000");
        doc.text("Date", cols.date, y, { width: 58 }); doc.text("Type", cols.type, y, { width: 52 });
        doc.text("Received", cols.rec, y, { width: 78, align: "right" }); doc.text("Given", cols.giv, y, { width: 78, align: "right" });
        doc.text("Balance", cols.bal, y, { width: 84, align: "right" }); doc.text("Note", cols.note, y, { width: noteWidth });
        doc.moveTo(left, y + 12).lineTo(left + width, y + 12).strokeColor("#999").lineWidth(0.5).stroke();
        doc.y = y + 16;
      };
      header();

      let zebra = false;
      for await (const r of rows()) {
        const note = latin([r.note, r.reference_number ? `Ref ${r.reference_number}` : "", r.status === "voided" ? `VOIDED${r.void_reason ? `: ${r.void_reason}` : ""}` : ""].filter(Boolean).join("  |  "));
        doc.font("Helvetica").fontSize(8);
        const h = Math.max(12, doc.heightOfString(note, { width: noteWidth }) + 3);
        if (doc.y + h > doc.page.height - 50) { doc.addPage(); header(); zebra = false; }
        const y = doc.y;
        if (zebra) doc.rect(left, y - 1, width, h).fill("#f3f4f6");
        zebra = !zebra;
        doc.fillColor(r.status === "voided" ? "#888" : "#000");
        doc.text(r.transaction_date, cols.date, y, { width: 58 });
        doc.text(r.transaction_type === "received" ? "Received" : "Given", cols.type, y, { width: 52 });
        doc.text(r.transaction_type === "received" ? plain(r.amount, r.currency) : "", cols.rec, y, { width: 78, align: "right" });
        doc.text(r.transaction_type === "given" ? plain(r.amount, r.currency) : "", cols.giv, y, { width: 78, align: "right" });
        doc.text(r.running_balance ? plain(r.running_balance, r.currency) : "-", cols.bal, y, { width: 84, align: "right" });
        doc.text(note, cols.note, y, { width: noteWidth });
        doc.y = y + h;
      }
      doc.fillColor("#666").fontSize(7).text("Totals count valid entries only. Voided entries are listed for transparency.", left, doc.y + 8);
      doc.end();
    } catch (err) {
      pass.destroy(err instanceof Error ? err : new Error("export_failed"));
    }
  })();

  return Readable.toWeb(pass) as unknown as ReadableStream<Uint8Array>;
}

export const statementTotals = (rows: Iterable<LedgerRow>) => {
  const acc = new TotalsAccumulator();
  for (const r of rows) acc.add(r);
  return acc.result();
};
