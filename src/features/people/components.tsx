"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/form";
import { Dialog } from "@/components/ui/dialog";
import { archivePerson, createPerson, updatePerson } from "./actions";
import { personSchema, type PersonInput } from "./schemas";

export function PersonForm({ personId, defaults }: { personId?: string; defaults?: PersonInput }) {
  const router = useRouter();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const f = useForm<PersonInput>({
    resolver: zodResolver(personSchema),
    defaultValues: { name: "", phone: "", email: "", address: "", notes: "", ...defaults },
  });
  const e = f.formState.errors;
  const d = (id: keyof PersonInput) => ({ "aria-invalid": e[id] ? true : undefined, "aria-describedby": e[id] ? `${id}-error` : undefined });

  return (
    <form
      noValidate className="max-w-xl space-y-4"
      onSubmit={f.handleSubmit(async (v) => {
        setServerError(null);
        const r = personId ? await updatePerson(personId, v) : await createPerson(v);
        if (!r.ok) {
          setServerError(r.error);
          for (const [k, msgs] of Object.entries(r.fieldErrors ?? {})) if (msgs?.[0]) f.setError(k as keyof PersonInput, { message: msgs[0] });
          return;
        }
        toast.success(personId ? "Changes saved." : "Person added.");
        router.push(personId ? `/dashboard/people/${personId}` : `/dashboard/people/${(r as { data: { id: string } }).data.id}`);
        router.refresh();
      })}
    >
      <Field label="Person name" htmlFor="name" error={e.name?.message}>
        <Input id="name" autoComplete="off" autoFocus {...d("name")} {...f.register("name")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone (optional)" htmlFor="phone" error={e.phone?.message}><Input id="phone" type="tel" {...d("phone")} {...f.register("phone")} /></Field>
        <Field label="Email (optional)" htmlFor="email" error={e.email?.message}><Input id="email" type="email" {...d("email")} {...f.register("email")} /></Field>
      </div>
      <Field label="Address or description (optional)" htmlFor="address" error={e.address?.message}><Textarea id="address" rows={2} {...d("address")} {...f.register("address")} /></Field>
      <Field label="Reference notes (optional)" htmlFor="notes" error={e.notes?.message}><Textarea id="notes" rows={3} {...d("notes")} {...f.register("notes")} /></Field>
      {serverError ? <FormMessage tone="error">{serverError}</FormMessage> : null}
      <div className="flex gap-3">
        <Button type="submit" disabled={f.formState.isSubmitting}>{f.formState.isSubmitting ? "Saving…" : personId ? "Save changes" : "Add person"}</Button>
        <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}

export function ArchivePersonButton({ personId, name }: { personId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Archive person</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Archive ${name}?`} description="They disappear from your people list. Their transactions and audit history are kept, and are still included in your data export.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Keep</Button>
          <Button variant="destructive" disabled={pending} onClick={() => start(async () => {
            const r = await archivePerson(personId);
            if (!r.ok) { toast.error(r.error); return; }
            toast.success("Person archived.");
            router.push("/dashboard"); router.refresh();
          })}>{pending ? "Archiving…" : "Archive"}</Button>
        </div>
      </Dialog>
    </>
  );
}
