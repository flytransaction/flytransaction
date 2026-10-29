"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import { addTransaction, replaceTransaction, voidTransaction } from "./actions";
import { addTransactionSchema, replaceTransactionSchema, voidTransactionSchema } from "./schemas";

type TxType = "received" | "given";

interface FormValues {
  amount: string; currency: string; transactionDate: string; note?: string; referenceNumber?: string; reason?: string;
}

const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function TransactionFields({ f, currencies, withReason }: { f: ReturnType<typeof useForm<FormValues>>; currencies: string[]; withReason?: boolean }) {
  const e = f.formState.errors;
  const d = (id: keyof FormValues) => ({ "aria-invalid": e[id] ? true : undefined, "aria-describedby": e[id] ? `${id}-error` : undefined });
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label="Amount" htmlFor="amount" error={e.amount?.message}>
            <Input id="amount" inputMode="decimal" autoComplete="off" placeholder="0.00" autoFocus {...d("amount")} {...f.register("amount")} />
          </Field>
        </div>
        <Field label="Currency" htmlFor="currency" error={e.currency?.message}>
          <Select id="currency" {...f.register("currency")}>{currencies.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        </Field>
      </div>
      <Field label="Transaction date" htmlFor="transactionDate" error={e.transactionDate?.message}>
        <Input id="transactionDate" type="date" {...d("transactionDate")} {...f.register("transactionDate")} />
      </Field>
      <Field label="Note / message (optional)" htmlFor="note" error={e.note?.message}><Textarea id="note" rows={2} {...d("note")} {...f.register("note")} /></Field>
      <Field label="Reference number (optional)" htmlFor="referenceNumber" error={e.referenceNumber?.message}><Input id="referenceNumber" {...d("referenceNumber")} {...f.register("referenceNumber")} /></Field>
      {withReason ? (
        <Field label="Reason for correction" htmlFor="reason" error={e.reason?.message} hint="Saved in the audit history with the original values.">
          <Input id="reason" {...d("reason")} {...f.register("reason")} />
        </Field>
      ) : null}
    </>
  );
}

function applyServerErrors(f: ReturnType<typeof useForm<FormValues>>, errors?: Record<string, string[] | undefined>) {
  for (const [k, v] of Object.entries(errors ?? {})) if (v?.[0]) f.setError(k as keyof FormValues, { message: v[0] });
}

/** "+ Add received" / "+ Add advance" dialog. One idempotency key per opening, so double-clicks cannot duplicate. */
export function AddTransactionButton({
  personId, type, defaultCurrency, currencies, today,
}: { personId: string; type: TxType; defaultCurrency: string; currencies: string[]; today: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [key, setKey] = React.useState(newKey);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const f = useForm<FormValues>({
    defaultValues: { amount: "", currency: defaultCurrency, transactionDate: today, note: "", referenceNumber: "" },
  });
  const given = type === "given";

  const close = () => { setOpen(false); setServerError(null); };
  return (
    <>
      <Button variant={given ? "given" : "received"} onClick={() => { setKey(newKey()); f.reset({ amount: "", currency: defaultCurrency, transactionDate: today, note: "", referenceNumber: "" }); setOpen(true); }}>
        {given ? "+ Add advance / given" : "+ Add received amount"}
      </Button>
      <Dialog open={open} onClose={close} title={given ? "Add advance / given amount" : "Add received amount"} description={given ? "Money you gave to this person." : "Money this person gave to you."}>
        <form
          noValidate className="space-y-4"
          onSubmit={f.handleSubmit(async (v) => {
            setServerError(null);
            const input = { personId, type, ...v, idempotencyKey: key };
            const check = addTransactionSchema.safeParse(input);
            if (!check.success) { applyServerErrors(f, check.error.flatten().fieldErrors); return; }
            const r = await addTransaction(input);
            if (!r.ok) { setServerError(r.error); applyServerErrors(f, r.fieldErrors); return; }
            toast.success(given ? "Advance recorded." : "Payment recorded.");
            close(); router.refresh();
          })}
        >
          <TransactionFields f={f} currencies={currencies} />
          {serverError ? <FormMessage tone="error">{serverError}</FormMessage> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" variant={given ? "given" : "received"} disabled={f.formState.isSubmitting}>{f.formState.isSubmitting ? "Saving…" : "Save"}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export interface EditableTx {
  id: string; amount: string; currency: string; transaction_date: string; note: string | null; reference_number: string | null;
}

/** Row actions: Correct (void + replacement) and Void. Both ask for a reason and are written to the audit log. */
export function TransactionRowActions({ tx, currencies }: { tx: EditableTx; currencies: string[] }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<null | "correct" | "void">(null);
  const [key, setKey] = React.useState(newKey);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const f = useForm<FormValues>({
    defaultValues: { amount: tx.amount, currency: tx.currency, transactionDate: tx.transaction_date, note: tx.note ?? "", referenceNumber: tx.reference_number ?? "", reason: "" },
  });
  const close = () => { setMode(null); setServerError(null); };
  const open = (m: "correct" | "void") => {
    setKey(newKey());
    f.reset({ amount: tx.amount, currency: tx.currency, transactionDate: tx.transaction_date, note: tx.note ?? "", referenceNumber: tx.reference_number ?? "", reason: "" });
    setMode(m);
  };

  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="outline" onClick={() => open("correct")} aria-label="Correct this transaction">Correct</Button>
      <Button size="sm" variant="ghost" onClick={() => open("void")} aria-label="Void this transaction">Void</Button>

      <Dialog open={mode === "correct"} onClose={close} title="Correct transaction" description="The original is voided and kept in the history; a corrected entry replaces it.">
        <form
          noValidate className="space-y-4"
          onSubmit={f.handleSubmit(async (v) => {
            setServerError(null);
            const input = { transactionId: tx.id, ...v, reason: v.reason ?? "", idempotencyKey: key };
            const check = replaceTransactionSchema.safeParse(input);
            if (!check.success) { applyServerErrors(f, check.error.flatten().fieldErrors); return; }
            const r = await replaceTransaction(input);
            if (!r.ok) { setServerError(r.error); applyServerErrors(f, r.fieldErrors); return; }
            toast.success("Transaction corrected."); close(); router.refresh();
          })}
        >
          <TransactionFields f={f} currencies={currencies} withReason />
          {serverError ? <FormMessage tone="error">{serverError}</FormMessage> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={f.formState.isSubmitting}>{f.formState.isSubmitting ? "Saving…" : "Save correction"}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={mode === "void"} onClose={close} title="Void this transaction?" description="It stops counting toward totals but stays visible in the ledger and audit history.">
        <form
          noValidate className="space-y-4"
          onSubmit={f.handleSubmit(async (v) => {
            setServerError(null);
            const input = { transactionId: tx.id, reason: v.reason ?? "" };
            const check = voidTransactionSchema.safeParse(input);
            if (!check.success) { applyServerErrors(f, check.error.flatten().fieldErrors); return; }
            const r = await voidTransaction(input);
            if (!r.ok) { setServerError(r.error); return; }
            toast.success("Transaction voided."); close(); router.refresh();
          })}
        >
          <Field label="Reason" htmlFor="void-reason" error={f.formState.errors.reason?.message}>
            <Input id="void-reason" autoFocus {...f.register("reason")} />
          </Field>
          {serverError ? <FormMessage tone="error">{serverError}</FormMessage> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>Keep it</Button>
            <Button type="submit" variant="destructive" disabled={f.formState.isSubmitting}>{f.formState.isSubmitting ? "Voiding…" : "Void transaction"}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
