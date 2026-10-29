-- Fly-Transaction: core schema.
-- Conventions: money is numeric(18,2); every private row has an owner; ledger rows are append-only in spirit
-- (financial columns are immutable, corrections are void-and-replace through SECURITY DEFINER functions).

-- Nothing in public should be callable/readable by default. Every grant below is explicit.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

create type public.app_role as enum ('user', 'super_admin');
create type public.transaction_type as enum ('received', 'given');
create type public.transaction_status as enum ('valid', 'voided');
create type public.billing_interval as enum ('monthly', 'yearly');

-- ---------------------------------------------------------------- helpers
create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  email text check (email is null or char_length(email) <= 254),
  role public.app_role not null default 'user',
  time_zone text not null default 'Asia/Kolkata' check (char_length(time_zone) between 1 and 64),
  default_currency char(3) not null default 'INR' check (default_currency ~ '^[A-Z]{3}$'),
  suspended_at timestamptz,
  deletion_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Role is NEVER taken from client-supplied metadata: new accounts are always 'user'.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email, time_zone)
  values (
    new.id,
    coalesce(left(new.raw_user_meta_data ->> 'full_name', 120), ''),
    new.email,
    coalesce((select left(value #>> '{}', 64) from public.app_settings where key = 'default_time_zone'), 'Asia/Kolkata')
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function public.sync_profile_email();

-- ---------------------------------------------------------------- people
create table public.people (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  phone text check (phone is null or char_length(phone) <= 32),
  email text check (email is null or char_length(email) <= 254),
  address text check (address is null or char_length(address) <= 500),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  -- Target of the composite FK from transactions: guarantees a transaction's owner equals its person's owner.
  constraint people_id_owner_unique unique (id, owner_id)
);
create index people_owner_name_idx on public.people (owner_id, lower(name)) where archived_at is null;
create index people_owner_created_idx on public.people (owner_id, created_at desc);
create trigger people_updated_at before update on public.people
  for each row execute function public.set_updated_at();

create function public.forbid_owner_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id is immutable' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger people_owner_immutable before update on public.people
  for each row execute function public.forbid_owner_change();

-- ---------------------------------------------------------------- transactions
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  person_id uuid not null,
  transaction_type public.transaction_type not null,
  amount numeric(18, 2) not null check (amount > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  transaction_date date not null check (transaction_date between date '1990-01-01' and date '2100-12-31'),
  note text check (note is null or char_length(note) <= 1000),
  reference_number text check (reference_number is null or char_length(reference_number) <= 100),
  status public.transaction_status not null default 'valid',
  replaces_transaction_id uuid references public.transactions (id),
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) <= 500),
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 8 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id) on delete cascade,
  updated_by uuid not null references public.profiles (id) on delete cascade,
  constraint transactions_person_owner_fk foreign key (person_id, owner_id)
    references public.people (id, owner_id) on delete cascade,
  constraint transactions_idempotency_unique unique (owner_id, idempotency_key),
  constraint transactions_void_consistency check ((status = 'voided') = (voided_at is not null))
);
create index transactions_person_ledger_idx on public.transactions (person_id, transaction_date, created_at, id);
create index transactions_owner_date_idx on public.transactions (owner_id, transaction_date desc, created_at desc);
create index transactions_owner_status_idx on public.transactions (owner_id, status);
create trigger transactions_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();

-- Defence in depth: even a privileged role cannot rewrite financial facts in place.
create function public.transactions_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.owner_id, new.person_id, new.transaction_type, new.amount, new.currency, new.transaction_date,
      new.note, new.reference_number, new.created_by, new.created_at, new.idempotency_key,
      new.replaces_transaction_id)
     is distinct from
     (old.owner_id, old.person_id, old.transaction_type, old.amount, old.currency, old.transaction_date,
      old.note, old.reference_number, old.created_by, old.created_at, old.idempotency_key,
      old.replaces_transaction_id) then
    raise exception 'transaction financial fields are immutable; void and replace instead' using errcode = '55000';
  end if;
  if old.status = 'voided' and new.status <> 'voided' then
    raise exception 'a voided transaction cannot be restored' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger transactions_immutable before update on public.transactions
  for each row execute function public.transactions_guard();

-- ---------------------------------------------------------------- transaction audit log (append-only)
create table public.transaction_audit_logs (
  id bigint generated always as identity primary key,
  transaction_id uuid not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid not null,
  action text not null check (action in ('created', 'voided', 'replaced')),
  before_snapshot jsonb,
  after_snapshot jsonb,
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now()
);
create index transaction_audit_tx_idx on public.transaction_audit_logs (transaction_id, created_at);
create index transaction_audit_owner_idx on public.transaction_audit_logs (owner_id, created_at desc);

create function public.audit_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end $$;
create trigger transaction_audit_no_update before update on public.transaction_audit_logs
  for each row execute function public.audit_append_only();
-- DELETE is blocked by privileges (nobody but the owner-cascade of account purge has it).

-- ---------------------------------------------------------------- plans / subscriptions / billing
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  billing_interval public.billing_interval not null,
  price numeric(12, 2) not null check (price >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  stripe_product_id text,
  stripe_price_id text unique,
  features jsonb not null default '[]'::jsonb check (jsonb_typeof(features) = 'array'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Exactly one purchasable plan per interval at a time (pricing page shows two cards).
create unique index plans_one_active_per_interval on public.plans (billing_interval) where is_active;
create trigger plans_updated_at before update on public.plans
  for each row execute function public.set_updated_at();

create table public.billing_customers (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  plan_id uuid references public.plans (id) on delete set null,
  stripe_customer_id text not null,
  stripe_subscription_id text unique,
  status text not null check (status in
    ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  past_due_since timestamptz,
  last_reconciled_at timestamptz,
  reconcile_error text check (reconcile_error is null or char_length(reconcile_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_status_idx on public.subscriptions (status);
create index subscriptions_reconcile_idx on public.subscriptions (last_reconciled_at nulls first);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'stripe',
  provider_event_id text not null,
  event_type text not null,
  status text not null default 'received' check (status in ('received', 'processed', 'failed', 'ignored')),
  attempts int not null default 1,
  error text check (error is null or char_length(error) <= 500),
  summary jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint billing_events_provider_event_unique unique (provider, provider_event_id)
);
create index billing_events_status_idx on public.billing_events (status, received_at desc);

-- ---------------------------------------------------------------- settings, admin audit, rate limits
create table public.app_settings (
  key text primary key check (key ~ '^[a-z_]{1,64}$'),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  admin_id uuid references public.profiles (id) on delete set null,
  action text not null check (char_length(action) <= 64),
  target_type text check (target_type is null or char_length(target_type) <= 64),
  target_id text check (target_id is null or char_length(target_id) <= 100),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_created_idx on public.admin_audit_logs (created_at desc);
create trigger admin_audit_no_update before update on public.admin_audit_logs
  for each row execute function public.audit_append_only();

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 1,
  primary key (key, window_start)
);
