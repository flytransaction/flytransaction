import type { SubscriptionStatus } from "@/features/billing/access-policy";

export type AppRole = "user" | "super_admin";

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  role: AppRole;
  time_zone: string;
  default_currency: string;
  suspended_at: string | null;
  deletion_requested_at: string | null;
  created_at: string;
}

export interface Person {
  id: string;
  owner_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface CurrencyBalanceRow {
  currency: string;
  total_received: string;
  total_given: string;
  outstanding: string;
}

export interface PeopleListRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  created_at: string;
  last_transaction_date: string | null;
  balances: CurrencyBalanceRow[];
  total_count: number;
}

export interface LedgerRow {
  id: string;
  transaction_type: "received" | "given";
  amount: string;
  currency: string;
  transaction_date: string;
  note: string | null;
  reference_number: string | null;
  status: "valid" | "voided";
  void_reason: string | null;
  replaces_transaction_id: string | null;
  created_at: string;
  running_balance: string | null;
  total_count: number;
}

export interface TransactionListRow {
  id: string;
  person_id: string;
  person_name: string;
  transaction_type: "received" | "given";
  amount: string;
  currency: string;
  transaction_date: string;
  note: string | null;
  reference_number: string | null;
  status: "valid" | "voided";
  created_at: string;
  total_count: number;
}

export interface DashboardSummary {
  people_count: number;
  totals: CurrencyBalanceRow[];
}

export interface Plan {
  id: string;
  name: string;
  billing_interval: "monthly" | "yearly";
  price: string | number;
  currency: string;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  features: string[];
  is_active: boolean;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string | null;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  past_due_since: string | null;
  last_reconciled_at: string | null;
  reconcile_error: string | null;
}

export interface AuditLogRow {
  id: number;
  transaction_id: string;
  action: "created" | "voided" | "replaced";
  before_snapshot: Record<string, unknown> | null;
  after_snapshot: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}
