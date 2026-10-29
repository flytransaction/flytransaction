"use client";

import { Button } from "@/components/ui/button";

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-md rounded-lg border bg-card p-8 text-center">
      <h1 className="text-lg font-semibold">We couldn’t load this page</h1>
      <p className="mt-1 text-sm text-muted-foreground">Nothing was changed. Check your connection and try again.</p>
      <Button className="mt-4" onClick={reset}>Try again</Button>
    </div>
  );
}
