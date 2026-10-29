import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ResendVerification } from "@/features/auth/components";
import { getSession } from "@/lib/security/guard";

export const metadata: Metadata = { title: "Verify your email" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (session?.emailConfirmed) redirect("/dashboard");
  const email = session?.email ?? sp.email ?? "";
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Check your inbox</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        We sent a verification link{email ? <> to <strong className="text-foreground">{email}</strong></> : null}. Open it to confirm your address.
        You can subscribe once it is verified.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <ResendVerification email={email} />
        <Link className="text-sm underline text-muted-foreground" href="/login">Back to log in</Link>
      </div>
    </>
  );
}
