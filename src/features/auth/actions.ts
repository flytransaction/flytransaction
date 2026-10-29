"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { rateLimit } from "@/lib/security/rate-limit";
import { fail, ok, type ActionResult } from "@/lib/security/action-result";
import { safeNextPath } from "@/lib/security/redirect";
import { getSession } from "@/lib/security/guard";
import { isValidTimeZone } from "@/lib/money";
import { stripe } from "@/lib/stripe/server";
import {
  changePasswordSchema, deleteAccountSchema, forgotSchema, loginSchema, profileSchema, resetSchema, signupSchema,
  type ChangePasswordInput, type ForgotInput, type LoginInput, type ProfileInput, type ResetInput, type SignupInput,
} from "./schemas";

const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";

export async function signUp(input: SignupInput): Promise<ActionResult<{ email: string }>> {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const { fullName, email, password } = parsed.data;
  if (!(await rateLimit("signup", email, 5, 3600))) return fail(TOO_MANY);

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${publicEnv.appUrl}/auth/callback?next=${encodeURIComponent("/dashboard")}`,
    },
  });
  // Do not reveal whether the email is already registered: Supabase returns success for existing confirmed emails.
  if (error && error.status && error.status >= 500) return fail("We could not create your account. Please try again.");
  if (error && /password/i.test(error.message)) return fail("Choose a stronger password.", { password: [error.message] });
  return ok({ email });
}

export async function logIn(input: LoginInput): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return fail("Enter your email and password.", parsed.error.flatten().fieldErrors);
  const { email, password, next } = parsed.data;
  if (!(await rateLimit("login", email, 10, 900))) return fail(TOO_MANY);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") redirect(`/verify-email?email=${encodeURIComponent(email)}`);
    return fail("Incorrect email or password.");
  }
  redirect(safeNextPath(next));
}

export async function logOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(input: ForgotInput): Promise<ActionResult> {
  const parsed = forgotSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a valid email address.", parsed.error.flatten().fieldErrors);
  const { email } = parsed.data;
  if (!(await rateLimit("forgot", email, 5, 3600))) return fail(TOO_MANY);

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${publicEnv.appUrl}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
  });
  // Identical response whether or not the account exists (and even if sending failed).
  return ok();
}

export async function resetPassword(input: ResetInput): Promise<ActionResult> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("This reset link is invalid or has expired. Request a new one.");

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return fail(/same/i.test(error.message) ? "Choose a password you have not used before." : "Could not update the password. Request a new reset link.");
  await supabase.auth.signOut({ scope: "others" });
  return ok();
}

export async function resendVerification(email: string): Promise<ActionResult> {
  const parsed = forgotSchema.safeParse({ email });
  if (!parsed.success) return fail("Enter a valid email address.");
  if (!(await rateLimit("resend", parsed.data.email, 3, 3600))) return fail(TOO_MANY);
  const supabase = await createClient();
  await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: `${publicEnv.appUrl}/auth/callback?next=${encodeURIComponent("/dashboard")}` },
  });
  return ok(); // same response regardless of account state
}

export async function changePassword(input: ChangePasswordInput): Promise<ActionResult> {
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const session = await getSession();
  if (!session?.email) return fail("Please sign in again.");
  if (!(await rateLimit("change-password", session.userId, 5, 900))) return fail(TOO_MANY);

  const supabase = await createClient();
  // Re-authenticate: a stolen session alone must not be enough to change the password.
  const { error: reauth } = await supabase.auth.signInWithPassword({ email: session.email, password: parsed.data.current });
  if (reauth) return fail("Your current password is incorrect.", { current: ["Incorrect password"] });
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return fail("Could not update the password. Try a different one.");
  await supabase.auth.signOut({ scope: "others" });
  return ok();
}

export async function signOutEverywhere(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login");
}

export async function updateProfile(input: ProfileInput): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
  if (!isValidTimeZone(parsed.data.timeZone)) return fail("Choose a valid time zone.", { timeZone: ["Unknown time zone"] });
  const session = await getSession();
  if (!session) return fail("Please sign in again.");

  const supabase = await createClient();
  const { data: currencies } = await supabase.from("app_settings").select("value").eq("key", "supported_currencies").maybeSingle();
  if (Array.isArray(currencies?.value) && !currencies.value.includes(parsed.data.defaultCurrency)) {
    return fail("That currency is not supported.", { defaultCurrency: ["Unsupported currency"] });
  }
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName, time_zone: parsed.data.timeZone, default_currency: parsed.data.defaultCurrency })
    .eq("id", session.userId);
  if (error) return fail("Could not save your profile.");
  return ok();
}

/** Starts the retention window: access is blocked at once, data is purged after `account_retention_days`. */
export async function requestAccountDeletion(input: { confirmation: string }): Promise<ActionResult> {
  const parsed = deleteAccountSchema.safeParse(input);
  if (!parsed.success) return fail('Type DELETE to confirm.', parsed.error.flatten().fieldErrors);
  const session = await getSession();
  if (!session) return fail("Please sign in again.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_account_deletion");
  if (error) return fail("Could not start account deletion.");

  // Stop future charges now (access ends at the paid-through date regardless; the account is blocked immediately).
  try {
    const admin = createAdminClient();
    const { data: sub } = await admin.from("subscriptions").select("stripe_subscription_id, status").eq("user_id", session.userId).maybeSingle();
    if (sub?.stripe_subscription_id && ["active", "trialing", "past_due"].includes(sub.status)) {
      await stripe().subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });
    }
  } catch {
    // Non-fatal: the purge job cancels the subscription again before deleting the account.
  }
  await supabase.auth.signOut();
  return ok();
}

export async function cancelAccountDeletion(): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_account_deletion");
  if (error) return fail("Could not cancel deletion.");
  return ok();
}
