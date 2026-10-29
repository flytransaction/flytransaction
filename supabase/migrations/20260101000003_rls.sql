-- Fly-Transaction: Row Level Security and table privileges.
-- Rule of thumb: RLS decides WHICH rows; GRANTs decide WHICH columns/operations. Both are explicit.

alter table public.profiles enable row level security;
alter table public.people enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_audit_logs enable row level security;
alter table public.plans enable row level security;
alter table public.billing_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_events enable row level security;
alter table public.app_settings enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.rate_limits enable row level security;


-- ---------------------------------------------------------------- profiles
grant select on public.profiles to authenticated;
grant update (full_name, time_zone, default_currency) on public.profiles to authenticated;  -- NOT role, NOT suspended_at
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_select_admin on public.profiles for select to authenticated
  using ((select public.is_super_admin()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------------------------------------------------------------- people
grant select on public.people to authenticated;
grant insert (owner_id, name, phone, email, address, notes) on public.people to authenticated;
grant update (name, phone, email, address, notes, archived_at) on public.people to authenticated;
create policy people_select on public.people for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.has_app_access()));
create policy people_insert on public.people for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.has_app_access()));
create policy people_update on public.people for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.has_app_access()))
  with check (owner_id = (select auth.uid()) and (select public.has_app_access()));
-- No DELETE policy or privilege: people are archived, never destroyed by users.

-- ---------------------------------------------------------------- transactions (read-only for clients)
grant select on public.transactions to authenticated;
create policy transactions_select on public.transactions for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.has_app_access()));
-- Writes happen only in add_/void_/replace_transaction (SECURITY DEFINER).

grant select on public.transaction_audit_logs to authenticated;
create policy transaction_audit_select on public.transaction_audit_logs for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.has_app_access()));

-- ---------------------------------------------------------------- billing
grant select on public.plans to anon, authenticated;
create policy plans_select_active on public.plans for select to anon, authenticated
  using (is_active);
create policy plans_select_admin on public.plans for select to authenticated
  using ((select public.is_super_admin()));

grant select on public.subscriptions to authenticated;
create policy subscriptions_select_own on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy subscriptions_select_admin on public.subscriptions for select to authenticated
  using ((select public.is_super_admin()));
-- No client write policies: only the Stripe webhook / reconcile job (service role) writes subscriptions.

grant select on public.billing_events to authenticated;
create policy billing_events_select_admin on public.billing_events for select to authenticated
  using ((select public.is_super_admin()));
-- billing_customers and rate_limits: RLS on, no policies, no grants => service role only.

-- ---------------------------------------------------------------- settings & admin audit
grant select on public.app_settings to authenticated;
create policy app_settings_select on public.app_settings for select to authenticated using (true);

grant select on public.admin_audit_logs to authenticated;
create policy admin_audit_select_admin on public.admin_audit_logs for select to authenticated
  using ((select public.is_super_admin()));

-- Service role bypasses RLS but still needs table privileges (Supabase grants them by default to service_role).
