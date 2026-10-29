import type { Metadata } from "next";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlanForm } from "@/features/admin/components";
import { adminPlans, adminSettings } from "@/features/admin/queries";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Plans" };
export const dynamic = "force-dynamic";

export default async function AdminPlans() {
  const [plans, settings] = await Promise.all([adminPlans(), adminSettings()]);
  const currencies = Array.isArray(settings.supported_currencies) ? (settings.supported_currencies as string[]) : ["INR"];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plans &amp; pricing</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Only one plan per interval can be active. Changing a price creates a new Stripe Price; existing subscribers keep their current price until they change plan,
          new checkouts use the new one. A plan without a Stripe price cannot be purchased.
        </p>
      </div>
      {plans.map((p) => (
        <Card key={p.id}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{p.name}</CardTitle>
              <Badge tone={p.is_active ? "received" : "neutral"}>{p.is_active ? "Active" : "Inactive"}</Badge>
              <Badge tone={p.stripe_price_id ? "neutral" : "warning"}>{p.stripe_price_id ? `Stripe ${p.stripe_price_id}` : "Not linked to Stripe"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground money">{formatMoney(String(p.price), p.currency)} / {p.billing_interval === "yearly" ? "year" : "month"}</p>
          </CardHeader>
          <CardContent><PlanForm currencies={currencies} plan={{ id: p.id, name: p.name, billing_interval: p.billing_interval, price: p.price, currency: p.currency, features: p.features, is_active: p.is_active, linked: Boolean(p.stripe_price_id) }} /></CardContent>
        </Card>
      ))}
      <Card><CardHeader><CardTitle>Add a plan</CardTitle></CardHeader><CardContent><PlanForm currencies={currencies} /></CardContent></Card>
    </div>
  );
}
