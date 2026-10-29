import { z } from "zod";

/** Public values are referenced literally so Next can inline them in the browser bundle. */
export const publicEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseKey:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
};

const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(10),
  STRIPE_SECRET_KEY: z.string().min(10),
  STRIPE_WEBHOOK_SECRET: z.string().min(10),
  CRON_SECRET: z.string().min(16),
});

type ServerEnv = z.infer<typeof serverSchema>;

/** Server-only secrets, validated lazily so `next build` works without them and failures name the variable. */
export function serverEnv<K extends keyof ServerEnv>(key: K): ServerEnv[K] {
  const raw = process.env[key] ?? (key === "SUPABASE_SECRET_KEY" ? process.env.SUPABASE_SERVICE_ROLE_KEY : undefined);
  const parsed = serverSchema.shape[key].safeParse(raw);
  if (!parsed.success) throw new Error(`Missing or invalid environment variable ${key}`);
  return parsed.data as ServerEnv[K];
}
