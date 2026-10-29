"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActionContext } from "@/lib/security/guard";
import { fail, ok, type ActionResult } from "@/lib/security/action-result";
import { personSchema, type PersonInput } from "./schemas";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createPerson(input: PersonInput): Promise<ActionResult<{ id: string }>> {
  const parsed = personSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const auth = await getActionContext({ needAccess: true });
  if (!auth.ok) return fail(auth.error);

  const supabase = await createClient();
  const d = parsed.data;
  const { data, error } = await supabase
    .from("people")
    .insert({
      owner_id: auth.ctx.userId, // forced server-side; RLS WITH CHECK enforces it again
      name: d.name, phone: d.phone ?? null, email: d.email ?? null, address: d.address ?? null, notes: d.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return fail("Could not save this person. Please try again.");
  revalidatePath("/dashboard");
  return ok({ id: data.id as string });
}

export async function updatePerson(personId: string, input: PersonInput): Promise<ActionResult> {
  if (!uuid.test(personId)) return fail("Person not found.");
  const parsed = personSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const auth = await getActionContext({ needAccess: true });
  if (!auth.ok) return fail(auth.error);

  const supabase = await createClient();
  const d = parsed.data;
  // owner filter is belt-and-braces: RLS already limits the UPDATE to the caller's rows.
  const { data, error } = await supabase
    .from("people")
    .update({ name: d.name, phone: d.phone ?? null, email: d.email ?? null, address: d.address ?? null, notes: d.notes ?? null })
    .eq("id", personId).eq("owner_id", auth.ctx.userId).is("archived_at", null)
    .select("id");
  if (error) return fail("Could not save changes. Please try again.");
  if (!data?.length) return fail("Person not found.");
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/people/${personId}`);
  return ok();
}

/** People are archived, never hard-deleted by users, so ledger history and audit logs stay intact. */
export async function archivePerson(personId: string): Promise<ActionResult> {
  if (!uuid.test(personId)) return fail("Person not found.");
  const auth = await getActionContext({ needAccess: true });
  if (!auth.ok) return fail(auth.error);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("people").update({ archived_at: new Date().toISOString() })
    .eq("id", personId).eq("owner_id", auth.ctx.userId).is("archived_at", null).select("id");
  if (error) return fail("Could not archive this person.");
  if (!data?.length) return fail("Person not found.");
  revalidatePath("/dashboard");
  return ok();
}
