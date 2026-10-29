-- pgTAP tests: ledger correctness, ownership isolation, privilege hardening, audit integrity.
-- Run with:  supabase start && supabase test db
-- NOT executed in the environment that generated this project (no Postgres available there) — run it before deploying.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ------------------------------------------------------------------ fixtures (as postgres)
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local', now(), now(), now());

update public.profiles set role = 'super_admin' where id = '00000000-0000-0000-0000-00000000000d';

insert into public.subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end) values
  ('00000000-0000-0000-0000-00000000000a', 'cus_a', 'sub_a', 'active', now() + interval '30 days'),
  ('00000000-0000-0000-0000-00000000000b', 'cus_b', 'sub_b', 'active', now() + interval '30 days');
-- user C: verified but never subscribed. Admin: no subscription either.

insert into public.app_settings (key, value) values
  ('supported_currencies', '["INR","USD","EUR","GBP"]'::jsonb), ('past_due_grace_days', '3'::jsonb)
on conflict (key) do nothing;
insert into public.plans (name, billing_interval, price, currency, is_active) values ('Test monthly', 'monthly', 1, 'INR', true)
on conflict do nothing;

select is((select count(*)::int from public.profiles where id in
  ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b')), 2, 'profiles are created by the auth trigger');
select is((select role::text from public.profiles where id = '00000000-0000-0000-0000-00000000000a'), 'user', 'new accounts are regular users');

-- ------------------------------------------------------------------ access policy mirror (see tests/fixtures/access-cases.json)
create function pg_temp.set_sub(p_status text, p_end interval, p_since interval) returns void language sql as $$
  insert into public.subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, past_due_since)
  values ('00000000-0000-0000-0000-00000000000c', 'cus_c', 'sub_c', p_status,
          case when p_end is null then null else now() + p_end end,
          case when p_since is null then null else now() + p_since end)
  on conflict (user_id) do update set status = excluded.status, current_period_end = excluded.current_period_end,
                                      past_due_since = excluded.past_due_since;
$$;
select is(public.has_app_access('00000000-0000-0000-0000-00000000000c'), false, 'access: no subscription');
select pg_temp.set_sub('active', interval '18 days', null);
select is(public.has_app_access('00000000-0000-0000-0000-00000000000c'), true, 'access: active mid period');
select pg_temp.set_sub('trialing', interval '4 days', null);
select is(public.has_app_access('00000000-0000-0000-0000-00000000000c'), true, 'access: trialing');
select pg_temp.set_sub('active', interval '-1 hour', null);
select is(public.has_app_access('00000000-0000-0000-0000-00000000000c'), true, 'access: period ended 1h ago is inside the 6h buffer');
select pg_temp.set_sub('active', interval '-7 hours', null);
select is(public.has_app_access('00000000-0000-0000-0000-00000000000c'), false, 'access: period ended 7h ago is outside the buffer');
select pg_temp.set_sub('active', null, null);
select is(public.has_app_access('00000000-0000-0000-0000-00000000000c'), false, 'access: active without period end is not trusted');
select pg_temp.set_sub('past_due', interval '-8 days', interval '-1 day');
select is(public.has_app_access('00000000-0000-0000-0000-00000000000c'), true, 'access: past_due inside grace');
select pg_temp.set_sub('past_due', interval '-8 days', interval '-4 days');
select is(public.has_app_access('00000000-0000-0000-0000-00000000000c'), false, 'access: past_due beyond grace');
select pg_temp.set_sub('past_due', interval '-1 day', null);
select is(public.has_app_access('00000000-0000-0000-0000-00000000000c'), true, 'access: past_due without since falls back to period end');
select pg_temp.set_sub('canceled', interval '18 days', null);
select is(public.has_app_access('00000000-0000-0000-0000-00000000000c'), false, 'access: canceled is terminal');
select pg_temp.set_sub('unpaid', interval '18 days', null);
select is(public.has_app_access('00000000-0000-0000-0000-00000000000c'), false, 'access: unpaid');
select pg_temp.set_sub('incomplete', null, null);
select is(public.has_app_access('00000000-0000-0000-0000-00000000000c'), false, 'access: incomplete');
select pg_temp.set_sub('incomplete_expired', null, null);
select is(public.has_app_access('00000000-0000-0000-0000-00000000000c'), false, 'access: incomplete_expired');
select pg_temp.set_sub('paused', interval '18 days', null);
select is(public.has_app_access('00000000-0000-0000-0000-00000000000c'), false, 'access: paused');
select pg_temp.set_sub('active', interval '18 days', null);
update public.profiles set suspended_at = now() where id = '00000000-0000-0000-0000-00000000000c';
select is(public.has_app_access('00000000-0000-0000-0000-00000000000c'), false, 'access: suspended beats a valid subscription');
update public.profiles set suspended_at = null, deletion_requested_at = now() where id = '00000000-0000-0000-0000-00000000000c';
select is(public.has_app_access('00000000-0000-0000-0000-00000000000c'), false, 'access: pending deletion blocks access');
update public.profiles set deletion_requested_at = null where id = '00000000-0000-0000-0000-00000000000c';
update auth.users set email_confirmed_at = null where id = '00000000-0000-0000-0000-00000000000c';
select is(public.has_app_access('00000000-0000-0000-0000-00000000000c'), false, 'access: unverified email beats a valid subscription');

-- ------------------------------------------------------------------ User A: people + ledger
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

select lives_ok($$ insert into public.people (owner_id, name) values ('00000000-0000-0000-0000-00000000000a', 'Ahmed') $$, 'A can create a person');
select throws_ok($$ insert into public.people (owner_id, name) values ('00000000-0000-0000-0000-00000000000b', 'Forged') $$, '42501', null, 'A cannot forge another owner_id');
select throws_ok($$ update public.people set owner_id = '00000000-0000-0000-0000-00000000000b' where name = 'Ahmed' $$, '42501', null, 'owner_id column is not updatable');
select throws_ok($$ update public.profiles set role = 'super_admin' where id = '00000000-0000-0000-0000-00000000000a' $$, '42501', null, 'A cannot promote themselves to super admin');
select throws_ok($$ update public.profiles set suspended_at = null where id = '00000000-0000-0000-0000-00000000000a' $$, '42501', null, 'A cannot edit suspended_at');
select throws_ok($$ insert into public.subscriptions (user_id, stripe_customer_id, status) values ('00000000-0000-0000-0000-00000000000a', 'x', 'active') $$, '42501', null, 'A cannot write subscriptions');
select throws_ok($$ update public.plans set price = 0 $$, '42501', null, 'A cannot change plan prices');
select is((select count(*)::int from public.billing_events), 0, 'A sees no billing events');

select is((select count(*)::int from public.person_totals((select id from public.people where name = 'Ahmed'))), 0, 'a new person has no totals (UI shows zero)');
select is((select balances from public.list_people() where name = 'Ahmed'), '[]'::jsonb, 'list_people: new person has empty balances');

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;
insert into t_ids select 'person', id from public.people where name = 'Ahmed';

select lives_ok($$ select public.add_transaction((select v from t_ids where k='person'), 'received', 10000, 'INR', date '2026-10-01', 'first', null, 'idem-key-0001') $$, 'A records a received amount');
select lives_ok($$ select public.add_transaction((select v from t_ids where k='person'), 'given', 3000, 'INR', date '2026-10-02', 'advance', 'REF1', 'idem-key-0002') $$, 'A records an advance');
select is((select outstanding from public.person_totals((select v from t_ids where k='person'))), '7000.00', 'outstanding = received - given = 7000.00');
select is((select total_received from public.person_totals((select v from t_ids where k='person'))), '10000.00', 'total received 10000.00');
select is((select total_given from public.person_totals((select v from t_ids where k='person'))), '3000.00', 'total given 3000.00');

-- idempotency: the same key does not create a second row
select lives_ok($$ select public.add_transaction((select v from t_ids where k='person'), 'received', 10000, 'INR', date '2026-10-01', 'first', null, 'idem-key-0001') $$, 'duplicate submission is accepted idempotently');
select is((select count(*)::int from public.transactions), 2, 'duplicate submission did not create a second row');

-- validation
select throws_ok($$ select public.add_transaction((select v from t_ids where k='person'), 'received', 0, 'INR', date '2026-10-01') $$, '22023', 'invalid_amount', 'zero amount rejected');
select throws_ok($$ select public.add_transaction((select v from t_ids where k='person'), 'received', 10.555, 'INR', date '2026-10-01') $$, '22023', 'invalid_amount', 'sub-cent precision rejected');
select throws_ok($$ select public.add_transaction((select v from t_ids where k='person'), 'received', 5, 'XXX', date '2026-10-01') $$, '22023', 'invalid_currency', 'unsupported currency rejected');

-- multi-currency totals stay separate
select lives_ok($$ select public.add_transaction((select v from t_ids where k='person'), 'received', 50, 'USD', date '2026-10-03') $$, 'USD entry');
select is((select count(*)::int from public.person_totals((select v from t_ids where k='person'))), 2, 'two currencies => two separate balance rows');
select is((select outstanding from public.person_totals((select v from t_ids where k='person')) where currency = 'INR'), '7000.00', 'INR total unaffected by USD');

-- running balance + ordering
select is(
  (select array_agg(running_balance order by transaction_date, created_at, id) from public.ledger_for_person((select v from t_ids where k='person')) where currency = 'INR'),
  array['10000.00', '7000.00'], 'running balance per currency in chronological order');

-- direct writes to the ledger are impossible for clients
select throws_ok($$ insert into public.transactions (owner_id, person_id, transaction_type, amount, currency, transaction_date, created_by, updated_by) values ('00000000-0000-0000-0000-00000000000a', (select v from t_ids where k='person'), 'received', 1, 'INR', date '2026-10-01', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a') $$, '42501', null, 'direct INSERT into transactions denied');
select throws_ok($$ update public.transactions set amount = 1 $$, '42501', null, 'direct UPDATE of transactions denied');
select throws_ok($$ delete from public.transactions $$, '42501', null, 'direct DELETE of transactions denied');
select throws_ok($$ delete from public.transaction_audit_logs $$, '42501', null, 'audit log cannot be deleted by users');

-- void + replace
insert into t_ids select 'tx_given', id from public.transactions where reference_number = 'REF1';
select throws_ok($$ select public.void_transaction((select v from t_ids where k='tx_given'), '') $$, '22023', 'reason_required', 'void requires a reason');
select lives_ok($$ select public.void_transaction((select v from t_ids where k='tx_given'), 'entered by mistake') $$, 'A voids a transaction');
select is((select outstanding from public.person_totals((select v from t_ids where k='person')) where currency = 'INR'), '10000.00', 'voided entries no longer count');
select throws_ok($$ select public.void_transaction((select v from t_ids where k='tx_given'), 'again') $$, '22023', 'transaction_not_valid', 'cannot void twice');
select is((select running_balance from public.ledger_for_person((select v from t_ids where k='person')) where id = (select v from t_ids where k='tx_given')), null, 'voided rows have no running balance');

insert into t_ids select 'tx_received', id from public.transactions where note = 'first';
select lives_ok($$ select public.replace_transaction((select v from t_ids where k='tx_received'), 12000, 'INR', date '2026-10-01', 'corrected', null, 'wrong amount typed', 'idem-key-0003') $$, 'A corrects a transaction (void + replacement)');
select is((select outstanding from public.person_totals((select v from t_ids where k='person')) where currency = 'INR'), '12000.00', 'totals reflect the replacement only');
select lives_ok($$ select public.replace_transaction((select v from t_ids where k='tx_received'), 12000, 'INR', date '2026-10-01', 'corrected', null, 'wrong amount typed', 'idem-key-0003') $$, 'replaying the same correction is idempotent');
select is((select count(*)::int from public.transactions where replaces_transaction_id = (select v from t_ids where k='tx_received')), 1, 'only one replacement row exists');
select is((select count(*)::int from public.transaction_audit_logs where transaction_id = (select v from t_ids where k='tx_received')), 2, 'original has created + replaced audit rows');
select is((select before_snapshot ->> 'amount' from public.transaction_audit_logs where transaction_id = (select v from t_ids where k='tx_received') and action = 'replaced'), '10000.00', 'audit keeps the original value');

-- ------------------------------------------------------------------ User B cannot see or touch A's data
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.people), 0, 'B sees none of A''s people');
select is((select count(*)::int from public.transactions), 0, 'B sees none of A''s transactions');
select is((select count(*)::int from public.transaction_audit_logs), 0, 'B sees none of A''s audit rows');
select is((select count(*)::int from public.ledger_for_person((select v from t_ids where k='person'))), 0, 'B cannot read A''s ledger by person id');
select is((select count(*)::int from public.person_totals((select v from t_ids where k='person'))), 0, 'B cannot read A''s totals by person id');
select throws_ok($$ select public.add_transaction((select v from t_ids where k='person'), 'received', 1, 'INR', date '2026-10-01') $$, 'P0002', 'person_not_found', 'B cannot add to A''s person');
select throws_ok($$ select public.void_transaction((select v from t_ids where k='tx_received'), 'attack') $$, 'P0002', 'transaction_not_found', 'B cannot void A''s transaction');
select throws_ok($$ select public.replace_transaction((select v from t_ids where k='tx_received'), 1, 'INR', date '2026-10-01', null, null, 'attack') $$, 'P0002', 'transaction_not_found', 'B cannot replace A''s transaction');
select is((with u as (update public.people set name = 'Hacked' returning 1) select count(*)::int from u), 0, 'B cannot update A''s people (0 rows)');
select throws_ok($$ select public.admin_stats() $$, '42501', 'forbidden', 'a regular user cannot call admin functions');
select throws_ok($$ select public.admin_set_suspended('00000000-0000-0000-0000-00000000000a', true, 'attack') $$, '42501', 'forbidden', 'a regular user cannot suspend others');
select throws_ok($$ select public.check_rate_limit('x', 1, 60) $$, '42501', null, 'rate limiter is not callable by users');

-- ------------------------------------------------------------------ expired subscription blocks data, not login/profile
reset role;
update public.subscriptions set status = 'canceled' where user_id = '00000000-0000-0000-0000-00000000000a';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.people), 0, 'expired user: people are hidden by RLS');
select is((select count(*)::int from public.transactions), 0, 'expired user: transactions are hidden by RLS');
select throws_ok($$ select public.add_transaction((select v from t_ids where k='person'), 'received', 1, 'INR', date '2026-10-01') $$, '42501', 'subscription_required', 'expired user cannot write via the API');
select throws_ok($$ insert into public.people (owner_id, name) values ('00000000-0000-0000-0000-00000000000a', 'Nope') $$, '42501', null, 'expired user cannot insert people');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-00000000000a'), 1, 'expired user can still read their own profile (login/renew still work)');
select is((select count(*)::int from public.subscriptions), 1, 'expired user can still see their subscription status');
reset role;
update public.subscriptions set status = 'active' where user_id = '00000000-0000-0000-0000-00000000000a';

-- ------------------------------------------------------------------ super admin
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select public.admin_stats() $$, 'admin can read aggregate stats');
select is((select count(*)::int from public.people), 0, 'admin has NO access to customer people');
select is((select count(*)::int from public.transactions), 0, 'admin has NO access to customer transactions');
select cmp_ok((select count(*)::int from public.profiles), '>=', 4, 'admin can list users');
select lives_ok($$ select public.admin_set_suspended('00000000-0000-0000-0000-00000000000b', true, 'test suspension') $$, 'admin can suspend a user');
select throws_ok($$ select public.admin_set_suspended('00000000-0000-0000-0000-00000000000d', true, 'self') $$, '42501', 'cannot_suspend_admin', 'admin cannot suspend an administrator');
select is((select count(*)::int from public.admin_audit_logs where action = 'user_suspended'), 1, 'suspension is audited');
select throws_ok($$ update public.admin_audit_logs set action = 'x' $$, '42501', null, 'admin audit log is not editable');
reset role;
select is(public.has_app_access('00000000-0000-0000-0000-00000000000b'), false, 'suspended user loses access');

-- ------------------------------------------------------------------ anonymous role
set local role anon;
select cmp_ok((select count(*)::int from public.plans), '>=', 1, 'anon can read active plans (pricing page)');
select throws_ok($$ select count(*) from public.people $$, '42501', null, 'anon cannot read people');
select throws_ok($$ select public.add_transaction(gen_random_uuid(), 'received', 1, 'INR', date '2026-10-01') $$, '42501', null, 'anon cannot call ledger functions');
reset role;

-- ------------------------------------------------------------------ database-level integrity (as postgres)
select throws_ok($$ insert into public.transactions (owner_id, person_id, transaction_type, amount, currency, transaction_date, created_by, updated_by)
  values ('00000000-0000-0000-0000-00000000000b', (select v from t_ids where k='person'), 'received', 1, 'INR', date '2026-10-01', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b') $$,
  '23503', null, 'a transaction cannot reference another owner''s person (composite FK)');
select throws_ok($$ update public.transactions set amount = 1 $$, '55000', null, 'financial fields are immutable even for privileged roles');
select throws_ok($$ update public.transactions set status = 'valid' where status = 'voided' $$, '55000', null, 'a voided transaction cannot be restored');
select throws_ok($$ update public.transaction_audit_logs set reason = 'tamper' $$, '55000', null, 'audit logs are append-only');
select throws_ok($$ insert into public.transactions (owner_id, person_id, transaction_type, amount, currency, transaction_date, created_by, updated_by)
  values ('00000000-0000-0000-0000-00000000000a', (select v from t_ids where k='person'), 'received', -5, 'INR', date '2026-10-01', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a') $$,
  '23514', null, 'negative amounts violate the CHECK constraint');
select throws_ok($$ insert into public.plans (name, billing_interval, price, currency, is_active) values ('Second monthly', 'monthly', 2, 'INR', true) $$, '23505', null, 'only one active plan per interval');

select * from finish();
rollback;
