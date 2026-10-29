-- Required runtime settings. Lives in a migration (not only seed.sql) because `supabase db push` to production
-- does not run seed.sql, and add_transaction() refuses to work without `supported_currencies`.
insert into public.app_settings (key, value) values
  ('supported_currencies', '["INR","USD","EUR","GBP"]'::jsonb),
  ('past_due_grace_days', '3'::jsonb),
  ('default_time_zone', '"Asia/Kolkata"'::jsonb),
  ('account_retention_days', '30'::jsonb)
on conflict (key) do nothing;
