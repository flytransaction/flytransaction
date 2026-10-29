import { z } from "zod";
import { currencyExponent, isValidIsoDate } from "@/lib/money";

const amountString = z
  .string()
  .trim()
  .regex(/^\d{1,15}(\.\d{1,2})?$/, "Enter an amount like 1500 or 1500.50")
  .refine((v) => Number(v) > 0, "Amount must be greater than zero");

const currency = z.string().regex(/^[A-Z]{3}$/, "Choose a currency");
const isoDate = z.string().refine(isValidIsoDate, "Enter a valid date").refine((v) => v >= "1990-01-01" && v <= "2100-12-31", "Date out of range");
const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

const base = {
  amount: amountString,
  currency,
  transactionDate: isoDate,
  note: optionalText(1000),
  referenceNumber: optionalText(100),
  idempotencyKey: z.string().min(8).max(100),
};

function checkDecimals(v: { amount: string; currency: string }, ctx: z.RefinementCtx) {
  const decimals = v.amount.split(".")[1]?.length ?? 0;
  if (decimals > currencyExponent(v.currency)) {
    ctx.addIssue({ code: "custom", path: ["amount"], message: `${v.currency} does not use decimals` });
  }
}

export const addTransactionSchema = z
  .object({ personId: z.string().uuid(), type: z.enum(["received", "given"]), ...base })
  .superRefine(checkDecimals);

export const replaceTransactionSchema = z
  .object({ transactionId: z.string().uuid(), reason: z.string().trim().min(3, "Add a short reason").max(500), ...base })
  .superRefine(checkDecimals);

export const voidTransactionSchema = z.object({
  transactionId: z.string().uuid(),
  reason: z.string().trim().min(3, "Add a short reason").max(500),
});

export type AddTransactionInput = z.input<typeof addTransactionSchema>;
export type ReplaceTransactionInput = z.input<typeof replaceTransactionSchema>;
export type VoidTransactionInput = z.input<typeof voidTransactionSchema>;

export const ledgerFilterSchema = z.object({
  from: z.string().refine(isValidIsoDate).optional().catch(undefined),
  to: z.string().refine(isValidIsoDate).optional().catch(undefined),
  type: z.enum(["received", "given"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).catch(1).default(1),
});
