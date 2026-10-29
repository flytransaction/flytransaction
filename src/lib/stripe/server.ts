import "server-only";
import Stripe from "stripe";
import { serverEnv } from "@/lib/env";

let client: Stripe | null = null;

/** Lazily created so builds and tests without Stripe keys still work. The account's default API version is used. */
export function stripe(): Stripe {
  client ??= new Stripe(serverEnv("STRIPE_SECRET_KEY"), { maxNetworkRetries: 2, appInfo: { name: "Fly-Transaction" } });
  return client;
}
