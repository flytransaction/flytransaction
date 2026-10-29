import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-4">
        <Logo />
        <div className="ml-auto flex items-center gap-2">
          <Link className="hidden px-3 text-sm text-muted-foreground hover:text-foreground sm:block" href="/pricing">Pricing</Link>
          <ThemeToggle />
          <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/login">Log in</Link>
          <Link className={buttonVariants({ size: "sm" })} href="/signup">Get started</Link>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4">
        <section className="grid items-center gap-10 py-16 md:grid-cols-2 md:py-24">
          <div>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">A clear ledger for every person you deal with.</h1>
            <p className="mt-5 max-w-prose text-lg text-muted-foreground">
              Record what you receive and what you give, see who owes whom at a glance, and export a clean statement whenever you need one.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link className={buttonVariants({ size: "lg" })} href="/signup">Start your ledger</Link>
              <Link className={buttonVariants({ variant: "outline", size: "lg" })} href="/pricing">See pricing</Link>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-5 shadow-sm" aria-hidden>
            <p className="mb-3 text-sm font-medium text-muted-foreground">Example ledger</p>
            {[
              { n: "Person A", r: "₹0.00", g: "₹0.00", o: "Settled" },
              { n: "Person B", r: "₹5,000.00", g: "₹2,000.00", o: "₹3,000.00 owes you" },
            ].map((row, i) => (
              <div key={row.n} className={`grid grid-cols-4 gap-2 rounded-md px-3 py-3 text-sm ${i % 2 ? "bg-muted/60" : ""}`}>
                <span className="font-medium">{row.n}</span><span className="text-received money">{row.r}</span>
                <span className="text-given money">{row.g}</span><span className="text-muted-foreground">{row.o}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="grid gap-4 pb-20 sm:grid-cols-3">
          {[
            { Icon: ArrowDownLeft, t: "Money received", d: "Log incoming payments with date, note and reference." },
            { Icon: ArrowUpRight, t: "Advances given", d: "Track money you hand out, per person and per currency." },
            { Icon: Scale, t: "Honest balances", d: "Every balance says who owes whom. Corrections keep a full audit trail." },
          ].map(({ Icon, t, d }) => (
            <div key={t} className="rounded-lg border bg-card p-5">
              <Icon className="mb-3 h-5 w-5 text-primary" aria-hidden /><h2 className="font-semibold">{t}</h2><p className="mt-1 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
