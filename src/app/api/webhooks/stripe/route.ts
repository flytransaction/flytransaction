import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { makeProcessorDeps } from "@/features/billing/service";
import { SignatureError, verifyStripeSignature } from "@/features/billing/signature";
import { processBillingEvent, type StripeEventLike } from "@/features/billing/webhook-processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook. Order matters:
 *  1. read the RAW body (signature is computed over the exact bytes),
 *  2. verify the signature,
 *  3. process idempotently,
 *  4. 2xx only when the event is recorded as processed/ignored/duplicate; 500 makes Stripe retry.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    verifyStripeSignature(rawBody, request.headers.get("stripe-signature"), serverEnv("STRIPE_WEBHOOK_SECRET"));
  } catch (err) {
    const reason = err instanceof SignatureError ? err.message : "Invalid signature";
    return NextResponse.json({ error: reason }, { status: 400 });
  }

  let event: StripeEventLike;
  try {
    event = JSON.parse(rawBody) as StripeEventLike;
    if (!event?.id || !event?.type || !event?.data?.object) throw new Error("bad shape");
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const result = await processBillingEvent(event, makeProcessorDeps());
  if (result.outcome === "failed") {
    // Safe, short reason only. Details are stored in billing_events.error for admins.
    return NextResponse.json({ received: false, error: "processing_failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true, outcome: result.outcome });
}
