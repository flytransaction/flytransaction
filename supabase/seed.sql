-- Safe development seed. Contains NO users, NO secrets, NO real prices.
-- Run automatically by `supabase db reset`. For demo users use `npm run seed:dev`.

insert into public.app_settings (key, value) values
  ('supported_currencies', '["INR","USD","EUR","GBP"]'::jsonb),
  ('past_due_grace_days', '3'::jsonb),
  ('default_time_zone', '"Asia/Kolkata"'::jsonb),
  ('account_retention_days', '30'::jsonb)
on conflict (key) do nothing;

-- DEVELOPMENT PLACEHOLDERS. Prices are fake and plans are not linked to Stripe (stripe_price_id is null),
-- so checkout is refused until a Super Admin links them from /admin/plans (or you paste real Stripe price IDs).
insert into public.plans (name, billing_interval, price, currency, features, is_active) values
  ('Monthly (DEV PLACEHOLDER)', 'monthly', 100.00, 'INR',
   '["Unlimited people","Unlimited transactions","CSV, Excel and PDF exports","Full audit history"]'::jsonb, true),
  ('Yearly (DEV PLACEHOLDER)', 'yearly', 1000.00, 'INR',
   '["Unlimited people","Unlimited transactions","CSV, Excel and PDF exports","Full audit history","Two months free"]'::jsonb, true)
on conflict do nothing;
