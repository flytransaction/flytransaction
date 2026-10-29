import "server-only";
import { headers } from "next/headers";
import { publicEnv } from "@/lib/env";

/**
 * CSRF defence for Route Handlers that change state with cookies (Server Actions already compare Origin to Host).
 * Rejects requests whose Origin/Referer is not our own origin.
 */
export async function isSameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  const allowed = new URL(publicEnv.appUrl).origin;
  if (origin) return origin === allowed;
  const referer = h.get("referer");
  if (referer) {
    try { return new URL(referer).origin === allowed; } catch { return false; }
  }
  return false;
}
