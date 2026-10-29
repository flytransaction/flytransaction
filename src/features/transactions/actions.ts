"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActionContext } from "@/lib/security/guard";
import { fail, friendlyDbError, ok, type ActionResult } from "@/lib/security/action-result";
import {
  addTransactionSchema, replaceTransactionSchema, voidTransactionSchema,
  type AddTransactionInput, type ReplaceTransactionInput, type VoidTransactionInput,
} from "./schemas";

/**
 * All three actions call SECURITY DEFINER SQL functions that derive the owner from the session, re-check the
 * subscription, write the audit record in the same transaction, and enforce idempotency. The browser never
 * supplies an owner id, a total or a balance.
 */

export async function addTransaction(input: AddTransactionInput): Promise<ActionResult<{ id: string }>> {
  const parsed = addTransactionSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const auth = await getActionContext({ needAccess: true });
  if (!auth.ok) return fail(auth.error);

  const d = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_transaction", {
    p_person_id: d.personId, p_type: d.type, p_amount: d.amount, p_currency: d.currency, p_date: d.transactionDate,
    p_note: d.note ?? null, p_reference: d.referenceNumber ?? null, p_idempotency_key: d.idempotencyKey,
  });
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath("/dashboard", "layout");
  return ok({ id: (data as { id: string }).id });
}

export async function replaceTransaction(input: ReplaceTransactionInput): Promise<ActionResult<{ id: string }>> {
  const parsed = replaceTransactionSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const auth = await getActionContext({ needAccess: true });
  if (!auth.ok) return fail(auth.error);

  const d = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("replace_transaction", {
    p_transaction_id: d.transactionId, p_amount: d.amount, p_currency: d.currency, p_date: d.transactionDate,
    p_note: d.note ?? null, p_reference: d.referenceNumber ?? null, p_reason: d.reason, p_idempotency_key: d.idempotencyKey,
  });
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath("/dashboard", "layout");
  return ok({ id: (data as { id: string }).id });
}

export async function voidTransaction(input: VoidTransactionInput): Promise<ActionResult> {
  const parsed = voidTransactionSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const auth = await getActionContext({ needAccess: true });
  if (!auth.ok) return fail(auth.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("void_transaction", {
    p_transaction_id: parsed.data.transactionId, p_reason: parsed.data.reason,
  });
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath("/dashboard", "layout");
  return ok();
}
