import type { Metadata } from "next";
import { ForgotForm } from "@/features/auth/components";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mb-6 text-sm text-muted-foreground">Enter your email and we’ll send a secure reset link.</p>
      <ForgotForm />
    </>
  );
}
