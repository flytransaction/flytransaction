import { describe, expect, it } from "vitest";
import { computeSignature, SignatureError, verifyStripeSignature } from "@/features/billing/signature";

const secret = "whsec_test_secret";
const body = JSON.stringify({ id: "evt_1", type: "invoice.paid", data: { object: {} } });
const now = 1_800_000_000_000; // ms
const ts = Math.floor(now / 1000);
const header = (t = ts, sig = computeSignature(body, t, secret)) => `t=${t},v1=${sig}`;

describe("verifyStripeSignature", () => {
  it("accepts a valid signature", () => {
    expect(() => verifyStripeSignature(body, header(), secret, { now })).not.toThrow();
  });

  it("accepts when any of several v1 signatures matches (secret rotation)", () => {
    const h = `t=${ts},v1=${"00".repeat(32)},v1=${computeSignature(body, ts, secret)}`;
    expect(() => verifyStripeSignature(body, h, secret, { now })).not.toThrow();
  });

  it("rejects a wrong secret, a tampered body and a malformed signature", () => {
    expect(() => verifyStripeSignature(body, header(), "whsec_other", { now })).toThrow(SignatureError);
    expect(() => verifyStripeSignature(body + " ", header(), secret, { now })).toThrow(SignatureError);
    expect(() => verifyStripeSignature(body, header(ts, "zz"), secret, { now })).toThrow(SignatureError);
    expect(() => verifyStripeSignature(body, header(ts, "ab"), secret, { now })).toThrow(SignatureError);
  });

  it("rejects missing or malformed headers and missing secret", () => {
    expect(() => verifyStripeSignature(body, null, secret, { now })).toThrow(/Missing/);
    expect(() => verifyStripeSignature(body, "garbage", secret, { now })).toThrow(/Malformed/);
    expect(() => verifyStripeSignature(body, `v1=abc`, secret, { now })).toThrow(/Malformed/);
    expect(() => verifyStripeSignature(body, header(), "", { now })).toThrow(/not configured/);
  });

  it("rejects replays outside the tolerance window", () => {
    const old = ts - 301;
    expect(() => verifyStripeSignature(body, header(old), secret, { now })).toThrow(/tolerance/);
    expect(() => verifyStripeSignature(body, header(ts - 299), secret, { now })).not.toThrow();
    expect(() => verifyStripeSignature(body, header(ts + 301), secret, { now })).toThrow(/tolerance/);
  });
});
