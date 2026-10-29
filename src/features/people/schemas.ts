import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const personSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  phone: optionalText(32),
  email: z
    .string().trim().max(254).optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || z.string().email().safeParse(v).success, "Enter a valid email address"),
  address: optionalText(500),
  notes: optionalText(2000),
});

export type PersonInput = z.input<typeof personSchema>;
export type PersonData = z.output<typeof personSchema>;

export const peopleQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  sort: z.enum(["name", "last_transaction", "received", "given", "outstanding"]).default("name"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
