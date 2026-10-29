import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";

/**
 * Service-role client: BYPASSES Row Level Security. Server-only (the `server-only` import fails the build if
 * this file is ever bundled for the browser). Use ONLY for: Stripe webhooks, the cron job, rate limiting,
 * billing customer mapping, and account purge. Never to serve user data on behalf of a request parameter.
 */
export function createAdminClient() {
  return createClient(publicEnv.supabaseUrl, serverEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
