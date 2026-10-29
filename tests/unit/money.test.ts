import { describe, expect, it } from "vitest";
import { formatMoney, isValidIsoDate, isValidTimeZone, minorToDecimal, MoneyError, parseMinor, todayInTimeZone } from "@/lib/money";

describe("parseMinor / minorToDecimal", () => {
  it("parses exact decimal strings into minor units", () => {
    expect(parseMinor("5000", "INR")).toBe(500000n);
    expect(parseMinor("5000.5", "INR")).toBe(500050n);
    expect(parseMinor("0.01", "USD")).toBe(1n);
    expect(parseMinor("5000.00", "INR")).toBe(500000n);
  });

  it("avoids floating point error (0.1 + 0.2 style)", () => {
    expect(parseMinor("0.10", "INR") + parseMinor("0.20", "INR")).toBe(parseMinor("0.30", "INR"));
    expect(minorToDecimal(parseMinor("0.10", "INR") + parseMinor("0.20", "INR"), "INR")).toBe("0.30");
  });

  it("keeps full precision for very large values", () => {
    expect(minorToDecimal(parseMinor("999999999999999.99", "INR"), "INR")).toBe("999999999999999.99");
  });

  it("rejects malformed, negative, empty and over-precise input", () => {
    for (const bad of ["", "abc", "-5", "1e3", "1,000", "1.234", "12.", ".5", "1234567890123456"]) {
      expect(() => parseMinor(bad, "INR"), bad).toThrow(MoneyError);
    }
  });

  it("respects zero-decimal currencies", () => {
    expect(parseMinor("500", "JPY")).toBe(500n);
    expect(parseMinor("500.00", "JPY")).toBe(500n);
    expect(() => parseMinor("500.5", "JPY")).toThrow(MoneyError);
    expect(minorToDecimal(500n, "JPY")).toBe("500");
  });

  it("formats negatives and zero", () => {
    expect(minorToDecimal(-500n, "INR")).toBe("-5.00");
    expect(minorToDecimal(0n, "INR")).toBe("0.00");
    expect(minorToDecimal(5n, "USD")).toBe("0.05");
  });
});

describe("formatMoney", () => {
  it("uses the currency's own conventions", () => {
    expect(formatMoney("5000", "INR")).toMatch(/₹\s?5,000\.00/);
    expect(formatMoney("1234567.5", "INR")).toMatch(/₹\s?12,34,567\.50/); // Indian digit grouping
    expect(formatMoney("1234.5", "USD")).toBe("$1,234.50");
    expect(formatMoney("1234", "JPY")).toMatch(/1,234/);
  });
});

describe("dates and time zones", () => {
  it("computes 'today' in the user's time zone, not the server's", () => {
    const instant = new Date("2026-10-28T20:00:00Z"); // already 29 Oct 01:30 in Kolkata
    expect(todayInTimeZone("Asia/Kolkata", instant)).toBe("2026-10-29");
    expect(todayInTimeZone("UTC", instant)).toBe("2026-10-28");
    expect(todayInTimeZone("America/Los_Angeles", instant)).toBe("2026-10-28");
  });

  it("validates time zones and calendar dates", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidIsoDate("2026-02-28")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-2-3")).toBe(false);
  });
});
