"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, type FieldValues, type Path, type UseFormSetError } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/form";
import type { ActionResult } from "@/lib/security/action-result";
import {
  changePasswordSchema, deleteAccountSchema, forgotSchema, loginSchema, profileSchema, resetSchema, signupSchema,
  type ChangePasswordInput, type ForgotInput, type LoginInput, type ProfileInput, type ResetInput, type SignupInput,
} from "./schemas";
import {
  cancelAccountDeletion, changePassword, logIn, requestAccountDeletion, requestPasswordReset, resendVerification, resetPassword, signUp, updateProfile,
} from "./actions";

function applyFieldErrors<T extends FieldValues>(setError: UseFormSetError<T>, errors?: Record<string, string[] | undefined>) {
  for (const [k, v] of Object.entries(errors ?? {})) if (v?.[0]) setError(k as Path<T>, { message: v[0] });
}

const describe = (id: string, error?: string) => ({ "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-error` : undefined });

export function SignupForm() {
  const router = useRouter();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const f = useForm<SignupInput>({ resolver: zodResolver(signupSchema), defaultValues: { fullName: "", email: "", password: "" } });
  const e = f.formState.errors;
  return (
    <form
      noValidate className="space-y-4"
      onSubmit={f.handleSubmit(async (v) => {
        setServerError(null);
        const r = await signUp(v);
        if (!r.ok) { setServerError(r.error); applyFieldErrors(f.setError, r.fieldErrors); return; }
        router.push(`/verify-email?email=${encodeURIComponent(r.data.email)}`);
      })}
    >
      <Field label="Full name" htmlFor="fullName" error={e.fullName?.message}>
        <Input id="fullName" autoComplete="name" {...describe("fullName", e.fullName?.message)} {...f.register("fullName")} />
      </Field>
      <Field label="Email" htmlFor="email" error={e.email?.message}>
        <Input id="email" type="email" autoComplete="email" {...describe("email", e.email?.message)} {...f.register("email")} />
      </Field>
      <Field label="Password" htmlFor="password" error={e.password?.message} hint="At least 10 characters with upper case, lower case and a number.">
        <Input id="password" type="password" autoComplete="new-password" {...describe("password", e.password?.message)} {...f.register("password")} />
      </Field>
      {serverError ? <FormMessage tone="error">{serverError}</FormMessage> : null}
      <Button type="submit" className="w-full" disabled={f.formState.isSubmitting}>{f.formState.isSubmitting ? "Creating account…" : "Create account"}</Button>
      <p className="text-center text-sm text-muted-foreground">Already registered? <Link className="underline" href="/login">Log in</Link></p>
    </form>
  );
}

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [serverError, setServerError] = React.useState<string | null>(null);
  const f = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "", next } });
  const e = f.formState.errors;
  return (
    <form
      noValidate className="space-y-4"
      onSubmit={f.handleSubmit(async (v) => {
        setServerError(null);
        const r = await logIn({ ...v, next });
        if (r && !r.ok) setServerError(r.error); // on success the action redirects
      })}
    >
      {notice ? <FormMessage tone="info">{notice}</FormMessage> : null}
      <Field label="Email" htmlFor="email" error={e.email?.message}>
        <Input id="email" type="email" autoComplete="email" {...describe("email", e.email?.message)} {...f.register("email")} />
      </Field>
      <Field label="Password" htmlFor="password" error={e.password?.message}>
        <Input id="password" type="password" autoComplete="current-password" {...describe("password", e.password?.message)} {...f.register("password")} />
      </Field>
      {serverError ? <FormMessage tone="error">{serverError}</FormMessage> : null}
      <Button type="submit" className="w-full" disabled={f.formState.isSubmitting}>{f.formState.isSubmitting ? "Logging in…" : "Log in"}</Button>
      <div className="flex justify-between text-sm text-muted-foreground">
        <Link className="underline" href="/forgot-password">Forgot password?</Link>
        <Link className="underline" href="/signup">Create account</Link>
      </div>
    </form>
  );
}

export function ForgotForm() {
  const [done, setDone] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const f = useForm<ForgotInput>({ resolver: zodResolver(forgotSchema), defaultValues: { email: "" } });
  const e = f.formState.errors;
  if (done) return <FormMessage tone="success">If an account exists for that email, a reset link is on its way. The link expires after a short time.</FormMessage>;
  return (
    <form
      noValidate className="space-y-4"
      onSubmit={f.handleSubmit(async (v) => {
        setServerError(null);
        const r = await requestPasswordReset(v);
        if (r.ok) setDone(true); else setServerError(r.error);
      })}
    >
      <Field label="Email" htmlFor="email" error={e.email?.message}>
        <Input id="email" type="email" autoComplete="email" {...describe("email", e.email?.message)} {...f.register("email")} />
      </Field>
      {serverError ? <FormMessage tone="error">{serverError}</FormMessage> : null}
      <Button type="submit" className="w-full" disabled={f.formState.isSubmitting}>{f.formState.isSubmitting ? "Sending…" : "Send reset link"}</Button>
      <p className="text-center text-sm"><Link className="underline text-muted-foreground" href="/login">Back to log in</Link></p>
    </form>
  );
}

export function ResetForm() {
  const router = useRouter();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const f = useForm<ResetInput>({ resolver: zodResolver(resetSchema), defaultValues: { password: "", confirm: "" } });
  const e = f.formState.errors;
  return (
    <form
      noValidate className="space-y-4"
      onSubmit={f.handleSubmit(async (v) => {
        setServerError(null);
        const r = await resetPassword(v);
        if (!r.ok) { setServerError(r.error); applyFieldErrors(f.setError, r.fieldErrors); return; }
        toast.success("Password updated.");
        router.push("/dashboard");
        router.refresh();
      })}
    >
      <Field label="New password" htmlFor="password" error={e.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" {...describe("password", e.password?.message)} {...f.register("password")} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm" error={e.confirm?.message}>
        <Input id="confirm" type="password" autoComplete="new-password" {...describe("confirm", e.confirm?.message)} {...f.register("confirm")} />
      </Field>
      {serverError ? <FormMessage tone="error">{serverError} <Link className="underline" href="/forgot-password">Request a new link</Link></FormMessage> : null}
      <Button type="submit" className="w-full" disabled={f.formState.isSubmitting}>{f.formState.isSubmitting ? "Saving…" : "Set new password"}</Button>
    </form>
  );
}

export function ResendVerification({ email }: { email: string }) {
  const [pending, start] = React.useTransition();
  return (
    <Button
      variant="outline" disabled={pending || !email}
      onClick={() => start(async () => {
        const r = await resendVerification(email);
        if (r.ok) toast.success("If that address needs verifying, a new link was sent."); else toast.error(r.error);
      })}
    >{pending ? "Sending…" : "Resend verification email"}</Button>
  );
}

export function ChangePasswordForm() {
  const f = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema), defaultValues: { current: "", password: "", confirm: "" } });
  const e = f.formState.errors;
  return (
    <form
      noValidate className="max-w-md space-y-4"
      onSubmit={f.handleSubmit(async (v) => {
        const r = await changePassword(v);
        if (!r.ok) { toast.error(r.error); applyFieldErrors(f.setError, r.fieldErrors); return; }
        toast.success("Password changed. Other devices were signed out.");
        f.reset();
      })}
    >
      <Field label="Current password" htmlFor="current" error={e.current?.message}>
        <Input id="current" type="password" autoComplete="current-password" {...describe("current", e.current?.message)} {...f.register("current")} />
      </Field>
      <Field label="New password" htmlFor="password" error={e.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" {...describe("password", e.password?.message)} {...f.register("password")} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm" error={e.confirm?.message}>
        <Input id="confirm" type="password" autoComplete="new-password" {...describe("confirm", e.confirm?.message)} {...f.register("confirm")} />
      </Field>
      <Button type="submit" disabled={f.formState.isSubmitting}>{f.formState.isSubmitting ? "Saving…" : "Change password"}</Button>
    </form>
  );
}

export function ProfileForm({ defaults, currencies, timeZones }: { defaults: ProfileInput; currencies: string[]; timeZones: string[] }) {
  const f = useForm<ProfileInput>({ resolver: zodResolver(profileSchema), defaultValues: defaults });
  const e = f.formState.errors;
  return (
    <form
      noValidate className="max-w-md space-y-4"
      onSubmit={f.handleSubmit(async (v) => {
        const r = await updateProfile(v);
        if (!r.ok) { toast.error(r.error); applyFieldErrors(f.setError, r.fieldErrors); return; }
        toast.success("Profile saved.");
      })}
    >
      <Field label="Full name" htmlFor="fullName" error={e.fullName?.message}>
        <Input id="fullName" autoComplete="name" {...describe("fullName", e.fullName?.message)} {...f.register("fullName")} />
      </Field>
      <Field label="Default currency" htmlFor="defaultCurrency" error={e.defaultCurrency?.message} hint="Used to pre-fill new transactions and to sort the people table.">
        <Select id="defaultCurrency" {...f.register("defaultCurrency")}>{currencies.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
      </Field>
      <Field label="Reporting time zone" htmlFor="timeZone" error={e.timeZone?.message} hint="Used for “today”, and for timestamps in exports and statements.">
        <Select id="timeZone" {...f.register("timeZone")}>{timeZones.map((z) => <option key={z} value={z}>{z}</option>)}</Select>
      </Field>
      <Button type="submit" disabled={f.formState.isSubmitting}>{f.formState.isSubmitting ? "Saving…" : "Save profile"}</Button>
    </form>
  );
}

export function DeleteAccountForm({ pendingSince }: { pendingSince: string | null }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const f = useForm<{ confirmation: string }>({ resolver: zodResolver(deleteAccountSchema), defaultValues: { confirmation: "" } });
  if (pendingSince) {
    return (
      <div className="space-y-3">
        <FormMessage tone="info">Deletion requested. Your data is locked and will be permanently removed after the retention period.</FormMessage>
        <Button variant="outline" disabled={pending} onClick={() => start(async () => {
          const r: ActionResult = await cancelAccountDeletion();
          if (r.ok) { toast.success("Deletion cancelled."); router.refresh(); } else toast.error(r.error);
        })}>Cancel deletion</Button>
      </div>
    );
  }
  return (
    <form
      noValidate className="max-w-md space-y-3"
      onSubmit={f.handleSubmit(async (v) => {
        const r = await requestAccountDeletion(v);
        if (!r.ok) { toast.error(r.error); return; }
        router.push("/login");
        router.refresh();
      })}
    >
      <p className="text-sm text-muted-foreground">
        Your access ends immediately and your people, transactions and exports are permanently deleted after the retention period.
        Export your data first if you need a copy.
      </p>
      <Field label="Type DELETE to confirm" htmlFor="confirmation" error={f.formState.errors.confirmation?.message}>
        <Input id="confirmation" autoComplete="off" {...describe("confirmation", f.formState.errors.confirmation?.message)} {...f.register("confirmation")} />
      </Field>
      <Button type="submit" variant="destructive" disabled={f.formState.isSubmitting}>Delete my account</Button>
    </form>
  );
}
