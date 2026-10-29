import type { Metadata } from "next";
import { ProfileForm } from "@/features/auth/components";
import { requireUser } from "@/lib/security/guard";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("value").eq("key", "supported_currencies").maybeSingle();
  const currencies = Array.isArray(data?.value) ? (data.value as string[]) : ["INR"];
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? ["UTC", "Asia/Kolkata"];
  const timeZones = zones.includes(session.profile.time_zone) ? zones : [session.profile.time_zone, ...zones];
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Profile</h1>
      <p className="mb-6 text-sm text-muted-foreground">Signed in as {session.email}. Light or dark mode is switched from the header and remembered on this device.</p>
      <ProfileForm
        defaults={{ fullName: session.profile.full_name, timeZone: session.profile.time_zone, defaultCurrency: session.profile.default_currency.trim() }}
        currencies={currencies.includes(session.profile.default_currency.trim()) ? currencies : [session.profile.default_currency.trim(), ...currencies]}
        timeZones={timeZones}
      />
    </div>
  );
}
