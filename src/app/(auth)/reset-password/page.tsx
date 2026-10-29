import type { Metadata } from "next";
import Link from "next/link";
import { ResetForm } from "@/features/auth/components";
import { getSession } from "@/lib/security/guard";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  // The recovery link signs the user in via /auth/callback; without that session the link was invalid or expired.
  const session = await getSession();
  if (!session) {
    return (
      <>
        <h1 className="mb-2 text-2xl font-semibold tracking-tight">Link expired</h1>
        <p className="mb-4 text-sm text-muted-foreground">This reset link is invalid or has already been used.</p>
        <Link className="underline" href="/forgot-password">Request a new link</Link>
      </>
    );
  }
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mb-6 text-sm text-muted-foreground">Other devices will be signed out.</p>
      <ResetForm />
    </>
  );
}
