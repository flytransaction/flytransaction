import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("rounded-lg border bg-card text-card-foreground", className)} {...p} />
);
export const CardHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("space-y-1 p-5 pb-3", className)} {...p} />;
export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => <h2 className={cn("text-base font-semibold", className)} {...p} />;
export const CardContent = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("p-5 pt-0", className)} {...p} />;

export function Badge({ tone = "neutral", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "received" | "given" | "warning" | "danger" }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-muted text-muted-foreground",
        tone === "received" && "border-received/40 text-received",
        tone === "given" && "border-given/40 text-given",
        tone === "warning" && "border-warning/50 text-warning",
        tone === "danger" && "border-destructive/50 text-destructive", className)}
      {...p}
    />
  );
}

export const Skeleton = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div aria-hidden className={cn("animate-pulse rounded-md bg-muted", className)} {...p} />
);
