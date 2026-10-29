import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme";
import { buttonVariants } from "@/components/ui/button";
import { getSession } from "@/lib/security/guard";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-4">
        <Logo />
        <nav aria-label="Primary" className="ml-6 hidden gap-4 text-sm sm:flex">
          <Link className="text-muted-foreground hover:text-foreground" href="/pricing">Pricing</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {session
            ? <Link className={buttonVariants({ size: "sm" })} href="/dashboard">Open ledger</Link>
            : <><Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/login">Log in</Link><Link className={buttonVariants({ size: "sm" })} href="/signup">Get started</Link></>}
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">{children}</main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} Fly-Transaction</footer>
    </div>
  );
}
