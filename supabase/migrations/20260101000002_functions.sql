-- Fly-Transaction: access helpers, ledger functions, reporting RPCs, admin RPCs.
-- All SECURITY DEFINER functions pin search_path to '' and fully qualify every object.

-- ================================================================ access helpers
create function public.is_super_admin(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = p_user and role = 'super_admin' and suspended_at is null
  );
$$;

-- SQL mirror of src/features/billing/access-policy.ts (evaluateAccess). Keep the two in sync;
-- supabase/tests/database/access_policy.test.sql and tests/unit/access-policy.test.ts use the same case table.
create function public.has_app_access(p_user uuid default auth.uid()) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_profile public.profiles%rowtype;
  v_sub public.subscriptions%rowtype;
  v_grace int;
  v_buffer constant interval := interval '6 hours';  -- tolerate webhook latency around renewals
  v_since timestamptz;
begin
  if p_user is null then return false; end if;
  select * into v_profile from public.profiles where id = p_user;
  if not found or v_profile.suspended_at is not null or v_profile.deletion_requested_at is not null then
    return false;
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user and u.email_confirmed_at is not null) then
    return false;
  end if;
  select * into v_sub from public.subscriptions where user_id = p_user;
  if not found then return false; end if;

  select coalesce((select (value #>> '{}')::int from public.app_settings where key = 'past_due_grace_days'), 3)
    into v_grace;

  if v_sub.status in ('active', 'trialing') then
    return v_sub.current_period_end is not null and v_sub.current_period_end + v_buffer > now();
  elsif v_sub.status = 'past_due' then
    v_since := coalesce(v_sub.past_due_since, v_sub.current_period_end);
    return v_since is not null and v_since + make_interval(days => v_grace) > now();
  end if;
  return false;  -- incomplete, incomplete_expired, canceled, unpaid, paused
end $$;

create function public.assert_app_access(p_user uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_app_access(p_user) then
    raise exception 'subscription_required' using errcode = '42501';
  end if;
end $$;

-- ================================================================ ledger writes
-- Every ledger mutation goes through these functions: ownership is derived from auth.uid(),
-- subscription is re-checked, and the audit row is written in the same database transaction.

create function public.add_transaction(
  p_person_id uuid,
  p_type public.transaction_type,
  p_amount numeric,
  p_currency text,
  p_date date,
  p_note text default null,
  p_reference text default null,
  p_idempotency_key text default null
) returns public.transactions
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_row public.transactions;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform public.assert_app_access(v_uid);

  if p_idempotency_key is not null then
    select * into v_row from public.transactions
      where owner_id = v_uid and idempotency_key = p_idempotency_key;
    if found then return v_row; end if;
  end if;

  perform 1 from public.people where id = p_person_id and owner_id = v_uid and archived_at is null for key share;
  if not found then raise exception 'person_not_found' using errcode = 'P0002'; end if;

  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' or not exists (
    select 1 from public.app_settings s, jsonb_array_elements_text(s.value) c
    where s.key = 'supported_currencies' and c = p_currency
  ) then
    raise exception 'invalid_currency' using errcode = '22023';
  end if;

  insert into public.transactions (owner_id, person_id, transaction_type, amount, currency, transaction_date,
                                   note, reference_number, idempotency_key, created_by, updated_by)
  values (v_uid, p_person_id, p_type, p_amount, p_currency, p_date,
          nullif(btrim(p_note), ''), nullif(btrim(p_reference), ''), p_idempotency_key, v_uid, v_uid)
  on conflict (owner_id, idempotency_key) do nothing
  returning * into v_row;

  if not found then  -- concurrent duplicate submission won the race
    select * into v_row from public.transactions
      where owner_id = v_uid and idempotency_key = p_idempotency_key;
    return v_row;
  end if;

  insert into public.transaction_audit_logs (transaction_id, owner_id, actor_id, action, after_snapshot)
  values (v_row.id, v_uid, v_uid, 'created', to_jsonb(v_row));
  return v_row;
end $$;

create function public.void_transaction(p_transaction_id uuid, p_reason text)
returns public.transactions
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_old public.transactions;
  v_new public.transactions;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform public.assert_app_access(v_uid);
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into v_old from public.transactions
    where id = p_transaction_id and owner_id = v_uid for update;
  if not found then raise exception 'transaction_not_found' using errcode = 'P0002'; end if;
  if v_old.status <> 'valid' then raise exception 'transaction_not_valid' using errcode = '22023'; end if;

  update public.transactions
     set status = 'voided', voided_at = now(), void_reason = btrim(p_reason), updated_by = v_uid
   where id = v_old.id
   returning * into v_new;

  insert into public.transaction_audit_logs
    (transaction_id, owner_id, actor_id, action, before_snapshot, after_snapshot, reason)
  values (v_old.id, v_uid, v_uid, 'voided', to_jsonb(v_old), to_jsonb(v_new), btrim(p_reason));
  return v_new;
end $$;

-- Correction = void the original and insert a linked replacement, atomically.
create function public.replace_transaction(
  p_transaction_id uuid,
  p_amount numeric,
  p_currency text,
  p_date date,
  p_note text,
  p_reference text,
  p_reason text,
  p_idempotency_key text default null
) returns public.transactions
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_old public.transactions;
  v_voided public.transactions;
  v_new public.transactions;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform public.assert_app_access(v_uid);
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    select * into v_new from public.transactions
      where owner_id = v_uid and idempotency_key = p_idempotency_key;
    if found then return v_new; end if;
  end if;

  select * into v_old from public.transactions
    where id = p_transaction_id and owner_id = v_uid for update;
  if not found then raise exception 'transaction_not_found' using errcode = 'P0002'; end if;
  if v_old.status <> 'valid' then raise exception 'transaction_not_valid' using errcode = '22023'; end if;

  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' or not exists (
    select 1 from public.app_settings s, jsonb_array_elements_text(s.value) c
    where s.key = 'supported_currencies' and c = p_currency
  ) then
    raise exception 'invalid_currency' using errcode = '22023';
  end if;

  update public.transactions
     set status = 'voided', voided_at = now(), void_reason = btrim(p_reason), updated_by = v_uid
   where id = v_old.id
   returning * into v_voided;

  insert into public.transactions (owner_id, person_id, transaction_type, amount, currency, transaction_date,
                                   note, reference_number, replaces_transaction_id, idempotency_key,
                                   created_by, updated_by)
  values (v_uid, v_old.person_id, v_old.transaction_type, p_amount, p_currency, p_date,
          nullif(btrim(p_note), ''), nullif(btrim(p_reference), ''), v_old.id, p_idempotency_key, v_uid, v_uid)
  returning * into v_new;

  insert into public.transaction_audit_logs
    (transaction_id, owner_id, actor_id, action, before_snapshot, after_snapshot, reason)
  values
    (v_old.id, v_uid, v_uid, 'replaced', to_jsonb(v_old), to_jsonb(v_voided), btrim(p_reason)),
    (v_new.id, v_uid, v_uid, 'created', to_jsonb(v_old), to_jsonb(v_new), btrim(p_reason));
  return v_new;
end $$;

-- ================================================================ reporting (SECURITY INVOKER: RLS applies)
-- Money leaves SQL as text so JavaScript never rounds it through a float.

create function public.list_people(
  p_search text default null,
  p_sort text default 'name',
  p_dir text default 'asc',
  p_currency text default 'INR',
  p_limit int default 20,
  p_offset int default 0
) returns table (
  id uuid, name text, phone text, email text, created_at timestamptz,
  last_transaction_date date, balances jsonb, total_count bigint
)
language sql stable set search_path = '' as $$
  with b as (
    select t.person_id, t.currency,
           coalesce(sum(t.amount) filter (where t.transaction_type = 'received'), 0) as rec,
           coalesce(sum(t.amount) filter (where t.transaction_type = 'given'), 0) as giv,
           max(t.transaction_date) as last_date
    from public.transactions t
    where t.status = 'valid'
    group by t.person_id, t.currency
  ), pb as (
    select person_id,
           max(last_date) as last_date,
           jsonb_agg(jsonb_build_object(
             'currency', currency,
             'total_received', rec::text,
             'total_given', giv::text,
             'outstanding', (rec - giv)::text) order by currency) as balances,
           coalesce(sum(rec) filter (where currency = p_currency), 0) as m_rec,
           coalesce(sum(giv) filter (where currency = p_currency), 0) as m_giv
    from b group by person_id
  )
  select p.id, p.name, p.phone, p.email, p.created_at, pb.last_date,
         coalesce(pb.balances, '[]'::jsonb),
         count(*) over ()
  from public.people p
  left join pb on pb.person_id = p.id
  where p.archived_at is null
    and (p_search is null or p_search = ''
         or p.name ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
         or p.phone ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
         or p.email ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by
    case when p_sort = 'name' and p_dir = 'asc' then lower(p.name) end asc,
    case when p_sort = 'name' and p_dir = 'desc' then lower(p.name) end desc,
    case when p_sort = 'last_transaction' and p_dir = 'asc' then pb.last_date end asc nulls last,
    case when p_sort = 'last_transaction' and p_dir = 'desc' then pb.last_date end desc nulls last,
    case when p_sort = 'received' and p_dir = 'asc' then coalesce(pb.m_rec, 0) end asc,
    case when p_sort = 'received' and p_dir = 'desc' then coalesce(pb.m_rec, 0) end desc,
    case when p_sort = 'given' and p_dir = 'asc' then coalesce(pb.m_giv, 0) end asc,
    case when p_sort = 'given' and p_dir = 'desc' then coalesce(pb.m_giv, 0) end desc,
    case when p_sort = 'outstanding' and p_dir = 'asc' then coalesce(pb.m_rec, 0) - coalesce(pb.m_giv, 0) end asc,
    case when p_sort = 'outstanding' and p_dir = 'desc' then coalesce(pb.m_rec, 0) - coalesce(pb.m_giv, 0) end desc,
    lower(p.name) asc, p.id asc
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
$$;

-- Ledger for one person. Running balance is computed over ALL valid rows of the same currency, then
-- the date/type filters are applied, so a filtered view still shows the true balance at each row.
create function public.ledger_for_person(
  p_person_id uuid,
  p_from date default null,
  p_to date default null,
  p_type text default null,
  p_dir text default 'desc',
  p_limit int default 50,
  p_offset int default 0
) returns table (
  id uuid, transaction_type public.transaction_type, amount text, currency text, transaction_date date,
  note text, reference_number text, status public.transaction_status, void_reason text,
  replaces_transaction_id uuid, created_at timestamptz, running_balance text, total_count bigint
)
language sql stable set search_path = '' as $$
  with base as (
    select t.*,
           case when t.status = 'valid'
                then (case t.transaction_type when 'received' then t.amount else -t.amount end)
                else 0 end as signed
    from public.transactions t
    where t.person_id = p_person_id
  ), run as (
    select b.*, sum(b.signed) over (
             partition by b.currency order by b.transaction_date, b.created_at, b.id) as running
    from base b
  )
  select r.id, r.transaction_type, r.amount::text, r.currency::text, r.transaction_date,
         r.note, r.reference_number, r.status, r.void_reason, r.replaces_transaction_id, r.created_at,
         case when r.status = 'valid' then r.running::text end,
         count(*) over ()
  from run r
  where (p_from is null or r.transaction_date >= p_from)
    and (p_to is null or r.transaction_date <= p_to)
    and (p_type is null or p_type = '' or r.transaction_type::text = p_type)
  order by
    case when p_dir = 'asc' then r.transaction_date end asc,
    case when p_dir = 'asc' then r.created_at end asc,
    case when p_dir = 'asc' then r.id end asc,
    case when p_dir <> 'asc' then r.transaction_date end desc,
    case when p_dir <> 'asc' then r.created_at end desc,
    case when p_dir <> 'asc' then r.id end desc
  limit least(greatest(p_limit, 1), 1000) offset greatest(p_offset, 0);
$$;

-- All-transactions list (with person names) for /dashboard/transactions and exports.
create function public.list_transactions(
  p_from date default null,
  p_to date default null,
  p_type text default null,
  p_person uuid default null,
  p_limit int default 50,
  p_offset int default 0
) returns table (
  id uuid, person_id uuid, person_name text, transaction_type public.transaction_type, amount text,
  currency text, transaction_date date, note text, reference_number text, status public.transaction_status,
  created_at timestamptz, total_count bigint
)
language sql stable set search_path = '' as $$
  select t.id, t.person_id, p.name, t.transaction_type, t.amount::text, t.currency::text, t.transaction_date,
         t.note, t.reference_number, t.status, t.created_at, count(*) over ()
  from public.transactions t
  join public.people p on p.id = t.person_id and p.owner_id = t.owner_id
  where (p_from is null or t.transaction_date >= p_from)
    and (p_to is null or t.transaction_date <= p_to)
    and (p_type is null or p_type = '' or t.transaction_type::text = p_type)
    and (p_person is null or t.person_id = p_person)
  order by t.transaction_date desc, t.created_at desc, t.id desc
  limit least(greatest(p_limit, 1), 1000) offset greatest(p_offset, 0);
$$;

-- Dashboard cards. Totals are per currency; nothing is ever summed across currencies.
create function public.dashboard_summary() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'people_count', (select count(*) from public.people where archived_at is null),
    'totals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'currency', currency,
               'total_received', rec::text,
               'total_given', giv::text,
               'outstanding', (rec - giv)::text) order by currency)
      from (
        select t.currency,
               coalesce(sum(t.amount) filter (where t.transaction_type = 'received'), 0) rec,
               coalesce(sum(t.amount) filter (where t.transaction_type = 'given'), 0) giv
        from public.transactions t
        join public.people p on p.id = t.person_id and p.owner_id = t.owner_id and p.archived_at is null
        where t.status = 'valid'
        group by t.currency
      ) x), '[]'::jsonb)
  );
$$;

-- ================================================================ account lifecycle
create function public.request_account_deletion() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.profiles set deletion_requested_at = coalesce(deletion_requested_at, now())
   where id = auth.uid();
end $$;

create function public.cancel_account_deletion() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.profiles set deletion_requested_at = null where id = auth.uid();
end $$;

-- ================================================================ rate limiting (service role only)
create function public.check_rate_limit(p_key text, p_limit int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into public.rate_limits (key, window_start) values (p_key, v_window)
  on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  delete from public.rate_limits where window_start < now() - interval '1 day';
  return v_hits <= p_limit;
end $$;

-- ================================================================ admin RPCs (each re-checks is_super_admin)
create function public.admin_guard() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return auth.uid();
end $$;

create function public.admin_log(p_action text, p_target_type text, p_target_id text, p_details jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, details)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb));
end $$;

-- Aggregate counts only: no names, notes, or amounts of any user's ledger are exposed.
create function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_guard();
  return jsonb_build_object(
    'users_total', (select count(*) from public.profiles),
    'users_suspended', (select count(*) from public.profiles where suspended_at is not null),
    'signups_30d', (select count(*) from public.profiles where created_at > now() - interval '30 days'),
    'subscriptions_active', (select count(*) from public.subscriptions where status in ('active', 'trialing')),
    'subscriptions_past_due', (select count(*) from public.subscriptions where status = 'past_due'),
    'subscriptions_scheduled_cancel', (select count(*) from public.subscriptions
                                        where cancel_at_period_end and status in ('active', 'trialing')),
    'people_total', (select count(*) from public.people),
    'transactions_total', (select count(*) from public.transactions),
    'billing_events_failed', (select count(*) from public.billing_events where status = 'failed'),
    'subscriptions_reconcile_errors', (select count(*) from public.subscriptions where reconcile_error is not null)
  );
end $$;

create function public.admin_list_users(p_search text default null, p_limit int default 25, p_offset int default 0)
returns table (
  id uuid, full_name text, email text, role public.app_role, suspended_at timestamptz,
  deletion_requested_at timestamptz, created_at timestamptz, email_confirmed_at timestamptz,
  subscription_status text, current_period_end timestamptz, cancel_at_period_end boolean, total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_guard();
  return query
  select p.id, p.full_name, p.email, p.role, p.suspended_at, p.deletion_requested_at, p.created_at,
         u.email_confirmed_at, s.status, s.current_period_end, s.cancel_at_period_end, count(*) over ()
  from public.profiles p
  left join auth.users u on u.id = p.id
  left join public.subscriptions s on s.user_id = p.id
  where p_search is null or p_search = ''
     or p.email ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
     or p.full_name ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by p.created_at desc, p.id
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

create function public.admin_set_suspended(p_user uuid, p_suspended boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_target public.profiles%rowtype;
begin
  perform public.admin_guard();
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select * into v_target from public.profiles where id = p_user for update;
  if not found then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  if p_user = auth.uid() or v_target.role = 'super_admin' then
    raise exception 'cannot_suspend_admin' using errcode = '42501';
  end if;
  update public.profiles set suspended_at = case when p_suspended then now() else null end where id = p_user;
  perform public.admin_log(case when p_suspended then 'user_suspended' else 'user_reactivated' end,
                           'user', p_user::text, jsonb_build_object('reason', btrim(p_reason)));
end $$;

create function public.admin_save_plan(
  p_id uuid, p_name text, p_interval public.billing_interval, p_price numeric, p_currency text,
  p_stripe_product_id text, p_stripe_price_id text, p_features jsonb, p_is_active boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.admin_guard();
  if p_id is null then
    insert into public.plans (name, billing_interval, price, currency, stripe_product_id, stripe_price_id, features, is_active)
    values (p_name, p_interval, p_price, p_currency, p_stripe_product_id, p_stripe_price_id,
            coalesce(p_features, '[]'::jsonb), p_is_active)
    returning id into v_id;
  else
    update public.plans set name = p_name, billing_interval = p_interval, price = p_price, currency = p_currency,
           stripe_product_id = p_stripe_product_id, stripe_price_id = p_stripe_price_id,
           features = coalesce(p_features, features), is_active = p_is_active
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'plan_not_found' using errcode = 'P0002'; end if;
  end if;
  perform public.admin_log(case when p_id is null then 'plan_created' else 'plan_updated' end, 'plan', v_id::text,
    jsonb_build_object('price', p_price, 'currency', p_currency, 'interval', p_interval, 'active', p_is_active));
  return v_id;
end $$;

create function public.admin_save_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_guard();
  if p_key not in ('supported_currencies', 'past_due_grace_days', 'default_time_zone', 'account_retention_days') then
    raise exception 'unknown_setting' using errcode = '22023';
  end if;
  insert into public.app_settings (key, value, updated_by) values (p_key, p_value, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform public.admin_log('setting_changed', 'setting', p_key, jsonb_build_object('value', p_value));
end $$;

-- ================================================================ grants
revoke all on function public.is_super_admin(uuid), public.has_app_access(uuid), public.assert_app_access(uuid),
  public.add_transaction(uuid, public.transaction_type, numeric, text, date, text, text, text),
  public.void_transaction(uuid, text),
  public.replace_transaction(uuid, numeric, text, date, text, text, text, text),
  public.list_people(text, text, text, text, int, int),
  public.ledger_for_person(uuid, date, date, text, text, int, int),
  public.list_transactions(date, date, text, uuid, int, int),
  public.dashboard_summary(),
  public.request_account_deletion(), public.cancel_account_deletion(),
  public.check_rate_limit(text, int, int),
  public.admin_guard(), public.admin_log(text, text, text, jsonb), public.admin_stats(),
  public.admin_list_users(text, int, int), public.admin_set_suspended(uuid, boolean, text),
  public.admin_save_plan(uuid, text, public.billing_interval, numeric, text, text, text, jsonb, boolean),
  public.admin_save_setting(text, jsonb)
  from public, anon, authenticated;

grant execute on function
  public.is_super_admin(uuid), public.has_app_access(uuid),
  public.add_transaction(uuid, public.transaction_type, numeric, text, date, text, text, text),
  public.void_transaction(uuid, text),
  public.replace_transaction(uuid, numeric, text, date, text, text, text, text),
  public.list_people(text, text, text, text, int, int),
  public.ledger_for_person(uuid, date, date, text, text, int, int),
  public.list_transactions(date, date, text, uuid, int, int),
  public.dashboard_summary(),
  public.request_account_deletion(), public.cancel_account_deletion(),
  public.admin_stats(), public.admin_list_users(text, int, int), public.admin_set_suspended(uuid, boolean, text),
  public.admin_save_plan(uuid, text, public.billing_interval, numeric, text, text, text, jsonb, boolean),
  public.admin_save_setting(text, jsonb)
  to authenticated;

grant execute on function public.check_rate_limit(text, int, int) to service_role;
-- assert_app_access / admin_guard / admin_log are internal: reachable only from other SECURITY DEFINER functions.
