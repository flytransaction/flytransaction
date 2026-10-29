import type { Metadata } from "next";
import { SignupForm } from "@/features/auth/components";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mb-6 text-sm text-muted-foreground">We’ll email you a link to verify your address before you subscribe.</p>
      <SignupForm />
    </>
  );
}
