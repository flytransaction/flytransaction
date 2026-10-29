import { describe, expect, it } from "vitest";
import {
  absoluteAmount, balanceDirection, computeTotals, TotalsAccumulator, withRunningBalance,
  type LedgerEntry, type RunningRow,
} from "@/features/transactions/ledger";

const e = (type: "received" | "given", amount: string, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
  transaction_type: type, status: "valid", amount, currency: "INR", ...extra,
});

describe("totals", () => {
  it("a new person has no totals (UI renders zero)", () => {
    expect(computeTotals([])).toEqual([]);
  });

  it("incoming payment increases total received; given increases total given", () => {
    expect(computeTotals([e("received", "5000")])).toEqual([
      { currency: "INR", totalReceived: "5000.00", totalGiven: "0.00", outstanding: "5000.00" },
    ]);
    expect(computeTotals([e("given", "2000")])).toEqual([
      { currency: "INR", totalReceived: "0.00", totalGiven: "2000.00", outstanding: "-2000.00" },
    ]);
  });

  it("matches the spec example: received 10,000 then given 3,000 => outstanding 7,000", () => {
    const [t] = computeTotals([e("received", "10000"), e("given", "3000")]);
    expect(t).toEqual({ currency: "INR", totalReceived: "10000.00", totalGiven: "3000.00", outstanding: "7000.00" });
  });

  it("voided transactions never count", () => {
    const [t] = computeTotals([e("received", "10000"), e("received", "999", { status: "voided" }), e("given", "3000")]);
    expect(t?.totalReceived).toBe("10000.00");
  });

  it("never combines currencies", () => {
    const totals = computeTotals([
      e("received", "100"),
      e("received", "50", { currency: "USD" }),
      e("given", "20", { currency: "USD" }),
    ]);
    expect(totals).toEqual([
      { currency: "INR", totalReceived: "100.00", totalGiven: "0.00", outstanding: "100.00" },
      { currency: "USD", totalReceived: "50.00", totalGiven: "20.00", outstanding: "30.00" },
    ]);
  });

  it("is exact across many small amounts", () => {
    const acc = new TotalsAccumulator();
    for (let i = 0; i < 1000; i++) acc.add(e("received", "0.10"));
    expect(acc.result()[0]?.totalReceived).toBe("100.00");
  });
});

describe("balance direction", () => {
  it("positive => the person owes you; negative => you owe them; zero => settled", () => {
    expect(balanceDirection("7000.00", "INR")).toBe("owes_you");
    expect(balanceDirection("-2000.00", "INR")).toBe("you_owe");
    expect(balanceDirection("0.00", "INR")).toBe("settled");
    expect(balanceDirection("-0.00", "INR")).toBe("settled");
  });
  it("absoluteAmount strips the sign so the label can carry the direction", () => {
    expect(absoluteAmount("-2000.00")).toBe("2000.00");
    expect(absoluteAmount("7000.00")).toBe("7000.00");
  });
});

describe("running balance", () => {
  const row = (id: string, date: string, created: string, type: "received" | "given", amount: string, extra: Partial<RunningRow> = {}): RunningRow => ({
    id, transaction_date: date, created_at: created, transaction_type: type, amount, currency: "INR", status: "valid", ...extra,
  });

  it("orders by date, then created_at, then id, and accumulates per currency", () => {
    const rows = withRunningBalance([
      row("c", "2026-10-02", "2026-10-02T09:00:00Z", "given", "3000"),
      row("a", "2026-10-01", "2026-10-01T09:00:00Z", "received", "10000"),
      row("b", "2026-10-01", "2026-10-01T09:00:00Z", "received", "500"), // same date+created_at: id breaks the tie
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(rows.map((r) => r.running_balance)).toEqual(["10000.00", "10500.00", "7500.00"]);
  });

  it("skips voided rows and does not mix currencies", () => {
    const rows = withRunningBalance([
      row("a", "2026-10-01", "2026-10-01T09:00:00Z", "received", "100"),
      row("b", "2026-10-02", "2026-10-02T09:00:00Z", "received", "999", { status: "voided" }),
      row("c", "2026-10-03", "2026-10-03T09:00:00Z", "received", "50", { currency: "USD" }),
      row("d", "2026-10-04", "2026-10-04T09:00:00Z", "given", "30"),
    ]);
    expect(rows.map((r) => r.running_balance)).toEqual(["100.00", null, "50.00", "70.00"]);
  });

  it("goes negative when you have given more than received", () => {
    const rows = withRunningBalance([row("a", "2026-10-01", "2026-10-01T09:00:00Z", "given", "250")]);
    expect(rows[0]?.running_balance).toBe("-250.00");
  });
});
