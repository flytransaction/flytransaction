import { describe, expect, it } from "vitest";
import { csvCell, csvRow, neutralizeFormula } from "@/features/exports/sanitize";
import { safeNextPath } from "@/lib/security/redirect";

describe("spreadsheet formula injection", () => {
  it("neutralizes cells that spreadsheets would execute", () => {
    for (const s of ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\tTAB", "\rCR", "=HYPERLINK(\"http://evil\")"]) {
      expect(neutralizeFormula(s), s).toBe(`'${s}`);
    }
  });
  it("leaves ordinary text alone", () => {
    for (const s of ["Ahmed", "Payment received", "12 Main St", "x=1"]) expect(neutralizeFormula(s)).toBe(s);
  });
  it("quotes cells with commas, quotes and newlines (RFC 4180)", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });
  it("neutralizes first, then quotes", () => {
    expect(csvCell("=A1,B1")).toBe('"\'=A1,B1"');
    expect(csvRow(["a", "=b", 3])).toBe("a,'=b,3\r\n");
  });
});

describe("safeNextPath (open redirect defence)", () => {
  it("allows same-site relative paths", () => {
    expect(safeNextPath("/dashboard/people/abc?x=1")).toBe("/dashboard/people/abc?x=1");
  });
  it("rejects absolute, protocol-relative and malformed targets", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "evil", "/ok\r\nSet-Cookie: a=b", ""]) {
      expect(safeNextPath(bad), bad).toBe("/dashboard");
    }
    expect(safeNextPath(null, "/x")).toBe("/x");
  });
});
