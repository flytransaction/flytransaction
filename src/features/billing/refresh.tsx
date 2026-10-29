"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/** After Stripe Checkout the webhook may take a few seconds. Poll the server (never grant access client-side). */
export function AwaitSubscription({ active }: { active: boolean }) {
  const router = useRouter();
  const [tries, setTries] = React.useState(0);
  React.useEffect(() => {
    if (active || tries >= 20) return;
    const id = setTimeout(() => { setTries((n) => n + 1); router.refresh(); }, 3000);
    return () => clearTimeout(id);
  }, [active, tries, router]);
  if (active) return null;
  return (
    <p role="status" className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
      {tries < 20 ? "Payment received — waiting for Stripe to confirm your subscription…" : "Still waiting. This can take a minute; refresh this page shortly. You have not been charged twice."}
    </p>
  );
}
