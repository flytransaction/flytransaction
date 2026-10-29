import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe webhook signature verification (the documented `Stripe-Signature` v1 scheme):
 *   header: t=<unix ts>,v1=<hex hmac>[,v1=...]
 *   signed payload: `${t}.${rawBody}` with HMAC-SHA256 keyed by the endpoint secret.
 * Equivalent to stripe.webhooks.constructEvent but dependency-free, so it is unit-tested without network.
 * MUST receive the raw, unparsed request body.
 */
export class SignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureError";
  }
}

export function computeSignature(rawBody: string, timestamp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

export function verifyStripeSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
  opts: { toleranceSeconds?: number; now?: number } = {},
): void {
  if (!secret) throw new SignatureError("Webhook secret is not configured");
  if (!header) throw new SignatureError("Missing Stripe-Signature header");

  let timestamp: number | null = null;
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === "t" && v) timestamp = Number(v);
    else if (k === "v1" && v) candidates.push(v);
  }
  if (timestamp === null || !Number.isFinite(timestamp) || candidates.length === 0) {
    throw new SignatureError("Malformed Stripe-Signature header");
  }

  const tolerance = opts.toleranceSeconds ?? 300;
  const nowSeconds = Math.floor((opts.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestamp) > tolerance) throw new SignatureError("Timestamp outside tolerance");

  const expected = Buffer.from(computeSignature(rawBody, timestamp, secret), "hex");
  const ok = candidates.some((c) => {
    const given = Buffer.from(c, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) throw new SignatureError("Signature mismatch");
}
