/**
 * Spreadsheet-formula-injection defence for CSV and XLSX: a text cell that starts with = + - @ TAB or CR
 * is interpreted as a formula by Excel/Sheets/LibreOffice. Prefix such text with a single quote.
 * Only applied to TEXT. Numeric cells are written as numbers and never touched.
 */
const DANGEROUS_START = /^[=+\-@\t\r]/;

export function neutralizeFormula(value: string): string {
  return DANGEROUS_START.test(value) ? `'${value}` : value;
}

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? String(value) : neutralizeFormula(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvCell).join(",") + "\r\n";
}

/** UTF-8 BOM so Excel opens non-ASCII (e.g. ₹, names) correctly. */
export const CSV_BOM = "\uFEFF";
