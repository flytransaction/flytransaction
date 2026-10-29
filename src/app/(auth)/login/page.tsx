import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/features/auth/components";
import { getSession } from "@/lib/security/guard";
import { safeNextPath } from "@/lib/security/redirect";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  if (await getSession()) redirect(safeNextPath(sp.next));
  const notice = sp.error === "link_invalid" ? "That email link is invalid or has expired. Log in, or request a new one." : undefined;
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mb-6 text-sm text-muted-foreground">Log in to your ledger.</p>
      <LoginForm next={sp.next ? safeNextPath(sp.next) : undefined} notice={notice} />
    </>
  );
}
