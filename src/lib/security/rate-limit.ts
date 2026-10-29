import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Fixed-window rate limit backed by Postgres (works across serverless instances).
 * Fails OPEN on infrastructure errors so an outage cannot lock everyone out; Supabase Auth has its own limits too.
 */
export async function rateLimit(scope: string, identity: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const h = await headers();
    const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
    const key = `${scope}:${createHash("sha256").update(`${ip}|${identity.toLowerCase()}`).digest("hex").slice(0, 32)}`;
    const { data, error } = await createAdminClient().rpc("check_rate_limit", {
      p_key: key, p_limit: limit, p_window_seconds: windowSeconds,
    });
    if (error) return true;
    return data === true;
  } catch {
    return true;
  }
}
