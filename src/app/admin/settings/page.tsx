import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingForm } from "@/features/admin/components";
import { adminSettings } from "@/features/admin/queries";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const s = await adminSettings();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Application settings</h1>
      <Card><CardHeader><CardTitle>Currencies</CardTitle></CardHeader><CardContent>
        <SettingForm name="supported_currencies" kind="list" label="Supported currencies" hint="Space or comma separated ISO 4217 codes, e.g. INR USD EUR GBP. Removing a code does not change existing transactions." initial={Array.isArray(s.supported_currencies) ? (s.supported_currencies as string[]).join(" ") : ""} />
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Billing policy</CardTitle></CardHeader><CardContent className="space-y-4">
        <SettingForm name="past_due_grace_days" kind="int" label="Past-due grace period (days)" hint="How long a user keeps access after a failed renewal payment." initial={String(s.past_due_grace_days ?? 3)} />
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Defaults &amp; retention</CardTitle></CardHeader><CardContent className="space-y-4">
        <SettingForm name="default_time_zone" kind="text" label="Default reporting time zone" hint="IANA name, e.g. Asia/Kolkata. Users can override it in their profile." initial={String(s.default_time_zone ?? "UTC")} />
        <SettingForm name="account_retention_days" kind="int" label="Deleted-account retention (days)" hint="Days between a deletion request and permanent removal." initial={String(s.account_retention_days ?? 30)} />
      </CardContent></Card>
    </div>
  );
}
