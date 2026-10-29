/**
 * Exact money handling. Amounts travel as decimal STRINGS (as returned by SQL `::text`) and are
 * summed as BigInt minor units. Floating point is never used for arithmetic.
 */

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** ISO 4217 minor-unit exponents for the currencies the app can offer. Unknown codes default to 2. */
const EXPONENTS: Record<string, number> = {
  INR: 2, USD: 2, EUR: 2, GBP: 2, AED: 2, AUD: 2, CAD: 2, SGD: 2, CHF: 2, JPY: 0,
};

export function currencyExponent(code: string): number {
  return EXPONENTS[code] ?? 2;
}

/** Parse a decimal string ("1234.5", "1234.50") into minor units. Rejects anything that is not exact. */
export function parseMinor(input: string, currency: string): bigint {
  const exp = currencyExponent(currency);
  const m = /^(\d{1,15})(?:\.(\d{1,18}))?$/.exec(input.trim());
  if (!m) throw new MoneyError(`Invalid amount: "${input}"`);
  const whole = m[1] ?? "0";
  let frac = m[2] ?? "";
  if (frac.length > exp) {
    const extra = frac.slice(exp);
    if (!/^0*$/.test(extra)) throw new MoneyError(`Too many decimal places for ${currency}`);
    frac = frac.slice(0, exp);
  }
  frac = frac.padEnd(exp, "0");
  return BigInt(whole + frac);
}

/** Minor units -> canonical decimal string with the currency's exponent ("-5.00"). */
export function minorToDecimal(minor: bigint, currency: string): string {
  const exp = currencyExponent(currency);
  const negative = minor < 0n;
  const abs = (negative ? -minor : minor).toString().padStart(exp + 1, "0");
  const whole = exp === 0 ? abs : abs.slice(0, abs.length - exp);
  const frac = exp === 0 ? "" : "." + abs.slice(abs.length - exp);
  return `${negative ? "-" : ""}${whole}${frac}`;
}

function localeFor(currency: string): string {
  return currency === "INR" ? "en-IN" : "en-US";
}

/** Display formatting (e.g. "₹5,000.00"). Uses Intl's exact decimal-string input; no float math. */
export function formatMoney(decimal: string, currency: string): string {
  const exp = currencyExponent(currency);
  return new Intl.NumberFormat(localeFor(currency), {
    style: "currency",
    currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(decimal as unknown as number);
}

export function formatMinor(minor: bigint, currency: string): string {
  return formatMoney(minorToDecimal(minor, currency), currency);
}

/** "2026-10-28" for "now" in the given IANA time zone. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Validates "YYYY-MM-DD" is a real calendar date. */
export function isValidIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
