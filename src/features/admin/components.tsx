"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import { reconcileUser, reprocessBillingEvent, savePlan, saveSetting, setUserSuspended } from "./actions";

export function SuspendButton({ userId, email, suspended }: { userId: string; email: string; suspended: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <>
      <Button size="sm" variant={suspended ? "outline" : "ghost"} onClick={() => { setReason(""); setError(null); setOpen(true); }}>{suspended ? "Reactivate" : "Suspend"}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`${suspended ? "Reactivate" : "Suspend"} ${email}?`}
        description={suspended ? "They regain access if their subscription is eligible." : "They are blocked from the app immediately but can still log in to see why. Their data is untouched."}>
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await setUserSuspended({ userId, suspended: !suspended, reason });
            if (!r.ok) { setError(r.error); return; }
            toast.success(suspended ? "Account reactivated." : "Account suspended.");
            setOpen(false); router.refresh();
          });
        }}>
          <Field label="Reason (recorded in the audit log)" htmlFor={`reason-${userId}`}><Input id={`reason-${userId}`} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
          {error ? <FormMessage tone="error">{error}</FormMessage> : null}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant={suspended ? "default" : "destructive"} disabled={pending}>{pending ? "Saving…" : suspended ? "Reactivate" : "Suspend"}</Button></div>
        </form>
      </Dialog>
    </>
  );
}

export function PlanForm({
  plan, currencies,
}: { plan?: { id: string; name: string; billing_interval: "monthly" | "yearly"; price: string | number; currency: string; features: string[]; is_active: boolean; linked: boolean }; currencies: string[] }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[] | undefined>>({});

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const sync = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("data-sync") === "1";
        setError(null); setFieldErrors({});
        start(async () => {
          const r = await savePlan(
            {
              id: plan?.id, name: String(fd.get("name")), interval: fd.get("interval") as "monthly" | "yearly", price: String(fd.get("price")),
              currency: String(fd.get("currency")), features: String(fd.get("features") ?? ""), isActive: fd.get("isActive") === "on",
            },
            { syncStripe: sync },
          );
          if (!r.ok) { setError(r.error); setFieldErrors(r.fieldErrors ?? {}); return; }
          toast.success(sync ? "Saved and synced to Stripe." : "Plan saved."); router.refresh();
        });
      }}
    >
      <Field label="Name" htmlFor={`name-${plan?.id ?? "new"}`} error={fieldErrors.name?.[0]}><Input id={`name-${plan?.id ?? "new"}`} name="name" defaultValue={plan?.name} required /></Field>
      <Field label="Billing interval" htmlFor={`interval-${plan?.id ?? "new"}`}>
        <Select id={`interval-${plan?.id ?? "new"}`} name="interval" defaultValue={plan?.billing_interval ?? "monthly"}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></Select>
      </Field>
      <Field label="Price" htmlFor={`price-${plan?.id ?? "new"}`} error={fieldErrors.price?.[0]}><Input id={`price-${plan?.id ?? "new"}`} name="price" inputMode="decimal" defaultValue={plan ? String(plan.price) : ""} required /></Field>
      <Field label="Currency" htmlFor={`currency-${plan?.id ?? "new"}`}><Select id={`currency-${plan?.id ?? "new"}`} name="currency" defaultValue={plan?.currency ?? currencies[0]}>{currencies.map((c) => <option key={c}>{c}</option>)}</Select></Field>
      <div className="sm:col-span-2"><Field label="Included features (one per line)" htmlFor={`features-${plan?.id ?? "new"}`}><Textarea id={`features-${plan?.id ?? "new"}`} name="features" rows={4} defaultValue={(plan?.features ?? []).join("\n")} /></Field></div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="isActive" defaultChecked={plan?.is_active ?? true} className="h-4 w-4" />Available for purchase</label>
      {error ? <div className="sm:col-span-2"><FormMessage tone="error">{error}</FormMessage></div> : null}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" data-sync="1" disabled={pending}>{pending ? "Saving…" : plan?.linked ? "Save & update Stripe price" : "Save & create in Stripe"}</Button>
        <Button type="submit" variant="outline" disabled={pending}>Save without Stripe</Button>
      </div>
    </form>
  );
}

export function SettingForm({ name, label, hint, initial, kind }: { name: string; label: string; hint?: string; initial: string; kind: "list" | "int" | "text" }) {
  const router = useRouter();
  const [value, setValue] = React.useState(initial);
  const [pending, start] = React.useTransition();
  const id = `setting-${name}`;
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const parsed = kind === "list" ? value.split(/[\s,]+/).map((s) => s.toUpperCase()).filter(Boolean) : kind === "int" ? Number(value) : value.trim();
          const r = await saveSetting(name, parsed);
          if (!r.ok) { toast.error(r.error); return; }
          toast.success("Setting saved."); router.refresh();
        });
      }}
    >
      <div className="min-w-64 flex-1"><Field label={label} htmlFor={id} hint={hint}><Input id={id} value={value} onChange={(e) => setValue(e.target.value)} /></Field></div>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
    </form>
  );
}

export function ReconcileButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
    const r = await reconcileUser(userId);
    if (!r.ok) toast.error(r.error); else toast.success(r.data.changed ? "Updated from Stripe." : "Already in sync.");
    router.refresh();
  })}>{pending ? "Checking…" : "Reconcile"}</Button>;
}

export function ReprocessButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
    const r = await reprocessBillingEvent(eventId);
    if (!r.ok) toast.error(r.error); else toast.success("Event reprocessed.");
    router.refresh();
  })}>{pending ? "Retrying…" : "Retry"}</Button>;
}
