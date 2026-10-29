import Link from "next/link";

export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="5" className="fill-primary" />
      <path d="M6 15.5 18 8.5M6 15.5l4.2.9M18 8.5l-6.2 8.6-1.6-.7M18 8.5 10.2 16.4" stroke="hsl(var(--primary-foreground))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold tracking-tight">
      <LogoMark />
      <span>Fly-Transaction</span>
    </Link>
  );
}
