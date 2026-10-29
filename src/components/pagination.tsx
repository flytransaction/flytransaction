import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Pagination({
  page, pageSize, total, hrefFor,
}: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn = cn(buttonVariants({ variant: "outline", size: "sm" }));
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 pt-4 text-sm text-muted-foreground">
      <p>Showing {from}–{to} of {total}</p>
      <div className="flex gap-2">
        {page > 1 ? <Link className={btn} href={hrefFor(page - 1)} rel="prev">Previous</Link> : <span className={cn(btn, "pointer-events-none opacity-50")} aria-disabled>Previous</span>}
        {page < pages ? <Link className={btn} href={hrefFor(page + 1)} rel="next">Next</Link> : <span className={cn(btn, "pointer-events-none opacity-50")} aria-disabled>Next</span>}
      </div>
    </nav>
  );
}

/** Builds a URL that keeps the current query params and overrides some. */
export function withParams(base: string, current: Record<string, string | string[] | undefined>, override: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val !== undefined && val !== "") p.set(k, val);
  }
  for (const [k, v] of Object.entries(override)) {
    if (v === undefined || v === "") p.delete(k);
    else p.set(k, v);
  }
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}
