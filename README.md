# Fly-Transaction

Multi-user SaaS ledger: keep an account per person, record **received** amounts and **advances given**, see who owes whom, correct mistakes with a full audit trail, and export CSV / Excel / PDF. Paid access via Stripe subscriptions. Next.js (App Router) + Supabase (Auth, Postgres, RLS) + Stripe.

> **Read this first — verification status.** This project was generated in a sandbox with **no network access**, so
> `npm install`, `next build`, Playwright, a Postgres database and Stripe could not be used. See [What has and has not been verified](#what-has-and-has-not-been-verified). Run the checklist in [Verify before you deploy](#verify-before-you-deploy) on your machine; expect to fix a small number of dependency-version or typing issues on first install.

---

## Contents
1. [What has and has not been verified](#what-has-and-has-not-been-verified)
2. [Architecture at a glance](#architecture-at-a-glance)
3. [Requirements](#1-required-software)
4. [Install](#2-install)
5. [Supabase setup](#3-supabase-project)
6. [Environment variables](#4-environment-variables)
7. [Migrations, seed and RLS verification](#5-migrations-seed-and-rls-verification)
8. [Auth redirects and email](#6-authentication-redirects-and-email)
9. [Stripe setup](#7-stripe-products-prices-portal-webhook)
10. [Local development](#8-local-development)
11. [Tests](#9-tests)
12. [Deploy to Vercel](#10-deploy-to-vercel)
13. [Backups and recovery](#11-database-backup-and-recovery)
14. [Production smoke tests](#12-production-smoke-tests)
15. [Troubleshooting](#13-troubleshooting)
16. [Business rules reference](#business-rules-reference)
17. [Remaining manual steps](#remaining-manual-steps-and-external-accounts)

---

## What has and has not been verified

| Area | Status |
|---|---|
| Money math (exact BigInt minor units, parsing, formatting, time-zone "today") | ✅ Unit-tested and passing |
| Ledger totals per currency, voided entries excluded, balance direction, running-balance model | ✅ Unit-tested and passing |
| Subscription access policy (all Stripe states, grace period, scheduled cancel, buffer) — shared case table | ✅ Unit-tested and passing |
| Stripe webhook signature verification (valid, invalid, tampered, replay, rotation) | ✅ Unit-tested and passing |
| Webhook processing: activation, renewal, cancel-at-period-end, expiry, failed payment → past_due, duplicates, out-of-order, retries, current-vs-old subscription | ✅ Unit-tested (in-memory fakes) and passing |
| CSV/XLSX formula-injection neutralisation, CSV quoting, open-redirect guard | ✅ Unit-tested and passing |
| All TypeScript syntax | ✅ Parsed with the TypeScript compiler (no syntax errors). Full type-check against real `next`/`react`/`@supabase` types: ❌ **not run** |
| `npm install`, `next build`, `next lint` | ❌ **not run** (offline). `package-lock.json` is therefore **not included**; your first `npm install` creates it — commit it |
| SQL migrations, RLS policies, SQL functions | ❌ **not executed** (no Postgres). Balanced-quoting sanity check only. Run `supabase db reset` and `supabase test db` |
| pgTAP tests (`supabase/tests/database/`): isolation, escalation, forged owner, direct writes, expired access, admin, audit integrity | ⚠️ Written, **not run** |
| Live RLS integration test (`tests/integration/rls.test.ts`) | ⚠️ Written, **not run** (skips without `TEST_SUPABASE_*`) |
| Playwright e2e (`tests/e2e`) | ⚠️ Written, **not run** |
| Stripe Checkout / Portal / real webhooks, Supabase Auth email flows, XLSX/PDF output | ⚠️ Implemented, **not exercised against live services** |

The unit tests run under **Vitest** in your project (`npm test`). In the generation sandbox they were executed through a small local stand-in for Vitest's `describe/it/expect`, since Vitest itself could not be installed.

Known simplifications you should decide on: see [Remaining manual steps](#remaining-manual-steps-and-external-accounts).

---

## Architecture at a glance

```
Browser ──► Next.js (RSC pages + Server Actions + a few Route Handlers)
              │  one service layer: src/features/*     one access guard: src/lib/security/guard.ts
              │  one subscription policy: src/features/billing/access-policy.ts
              ├─► Supabase (user-scoped client, RLS applies)   ← all user data reads/writes
              ├─► Supabase (service-role client, server only)  ← webhooks, cron, rate limit, account purge
              └─► Stripe (Checkout, Billing Portal, webhooks)
Postgres: RLS on every table • ledger writes only via SECURITY DEFINER functions • audit append-only
```

* **Ownership is derived from the session, never from the request.** `owner_id` is set from `auth.uid()` inside SQL functions; people inserts are pinned by RLS `WITH CHECK`; a composite FK `(person_id, owner_id) → people(id, owner_id)` makes cross-owner rows impossible.
* **Ledger integrity.** `add_transaction`, `void_transaction`, `replace_transaction` are the only write path. They re-check the subscription, lock rows, write the audit row **in the same transaction**, and are idempotent (`idempotency_key`). Financial columns are immutable by trigger. Corrections = void + linked replacement.
* **Money** is `numeric(18,2)` in Postgres, travels as **strings**, and is summed as `BigInt` minor units. No floats.
* **Subscription gating is enforced twice**: in Next.js (`requireAccess`) and in the database (`has_app_access()` inside RLS and in every ledger function), so direct PostgREST/API calls cannot bypass it. Login, profile and renewal keep working when expired.
* **Admins** are identified by `profiles.role` (column not writable by clients; there is no UI or API to promote anyone). Admin pages use aggregate RPCs only; there is **no admin RLS policy on `people` or `transactions`**.

Folder map: `src/app` (routes) · `src/features/{auth,people,transactions,billing,exports,admin}` · `src/lib/{supabase,stripe,security,money}` · `supabase/{migrations,seed.sql,tests}` · `tests/{unit,integration,e2e,fixtures}` · `scripts/`.

---

## 1. Required software

| Tool | Version |
|---|---|
| Node.js | 20.11+ (22 LTS recommended) |
| npm | 10+ |
| Docker Desktop (or compatible) | for the local Supabase stack |
| Supabase CLI | installed by `npm install` (dev dependency) — run with `npx supabase …` |
| Stripe CLI | 1.2x+ (https://stripe.com/docs/stripe-cli) for local webhooks |
| Git | any |

## 2. Install

```bash
cd fly-transaction
npm install            # creates package-lock.json — commit it
cp .env.example .env.local
npx playwright install --with-deps chromium   # only for e2e tests
```

Dependency ranges in `package.json` are caret ranges chosen for mutual compatibility (Next 15 / React 19 / Supabase SSR 0.7 / Stripe 18 / Zod 3 / Vitest 3). If a range fails to resolve, move it to the nearest published version and re-run `npm run typecheck`.

## 3. Supabase project

Local: `npx supabase start` (prints the local URL and keys — use them in `.env.local`).

Hosted:
1. https://supabase.com/dashboard → **New project** (choose a region near your users; save the DB password).
2. **Project Settings → API Keys**: copy the **Project URL**, the **publishable** key (`sb_publishable_…`) and the **secret** key (`sb_secret_…`). Legacy projects can use the anon / service_role JWTs instead (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are accepted as fallbacks).
3. **Authentication → Providers → Email**: enable, and turn **Confirm email ON**. Set minimum password length 10 with upper/lower/digit (matches `supabase/config.toml` for local).
4. Link the CLI: `npx supabase login && npx supabase link --project-ref <ref>`.

## 4. Environment variables

See `.env.example` (all placeholders). Rules:

* `NEXT_PUBLIC_*` values are public. **`SUPABASE_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET` are server-only** — never prefix them with `NEXT_PUBLIC_`. `src/lib/supabase/admin.ts` imports `server-only`, so bundling it into client code fails the build.
* Generate `CRON_SECRET`: `openssl rand -hex 32`.
* Real price IDs are **not** env vars: they live in the `plans` table and are set from `/admin/plans`.

## 5. Migrations, seed and RLS verification

```bash
npx supabase db reset            # local: applies migrations/ then seed.sql
npx supabase db push             # hosted: applies migrations only (settings are in migration 4, plans are not seeded in prod)
npx supabase test db             # runs supabase/tests/database/*.test.sql (pgTAP)
```

Migrations: `…01_schema` (tables, constraints, indexes, triggers) · `…02_functions` (access helpers, ledger functions, reporting + admin RPCs, grants) · `…03_rls` (RLS + column-level grants) · `…04_default_settings` · `…05_person_totals`.

**Verify RLS yourself** (Supabase SQL editor or `psql`):
```sql
-- every public table must show rowsecurity = true
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
-- no table privileges for anon beyond plans
select grantee, table_name, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon','authenticated') order by 2,1,3;
```
Then run `npm run test:db` and, with `TEST_SUPABASE_*` pointing at a **throwaway** project, `npm test` (the integration suite creates and deletes users).

**Create the first Super Admin** (no UI/API can do this, by design). After that person signs up and verifies their email:
```sql
update public.profiles set role = 'super_admin' where email = 'you@yourdomain.com';
```
Seed data: `seed.sql` adds **DEV PLACEHOLDER** plans (fake prices, not linked to Stripe — checkout refuses them). `npm run seed:dev` (local only) creates demo users, sample people/transactions, an expired user and an admin.

## 6. Authentication redirects and email

Supabase Dashboard → **Authentication → URL Configuration**:
* **Site URL**: your production URL (e.g. `https://app.example.com`).
* **Redirect URLs**: `https://app.example.com/auth/callback`, `http://localhost:3000/auth/callback`, and your Vercel preview pattern if used.

Email templates use the default PKCE links (`{{ .ConfirmationURL }}`), handled by `/auth/callback`. If you customise templates, link to `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/dashboard` (or `type=recovery&next=/reset-password`) — both forms are supported.

Production email: the built-in Supabase mailer is rate-limited and for testing only. Configure **custom SMTP** (Resend, Postmark, SES…) under **Authentication → SMTP Settings**. Local emails appear in Inbucket at http://localhost:54324.

## 7. Stripe: products, prices, portal, webhook

1. Use **test mode** first. Copy the secret key to `STRIPE_SECRET_KEY`.
2. **Prices**: either create them in the Stripe Dashboard (Product catalog → recurring monthly / yearly in your currency) and paste the `price_…` ids into the plan rows, or simply open **/admin/plans** and press **Save & create in Stripe**, which creates the product and price for you. Prices in Stripe are immutable: changing a price in /admin/plans creates a *new* Price; existing subscribers keep theirs until they change plan.
3. **Customer Portal**: Dashboard → Settings → Billing → **Customer portal** → activate; enable cancel subscription, update payment method, invoice history. (Plan switching in the portal is optional; if enabled, allow only these two prices.)
4. **Webhook endpoint** → `https://<your-domain>/api/webhooks/stripe`, events:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`.
   Copy the signing secret to `STRIPE_WEBHOOK_SECRET`.
5. **Smart Retries / dunning**: Settings → Billing → Subscriptions and emails. The app's past-due grace period (default 3 days, `/admin/settings`) is independent of Stripe's retry schedule.

How billing is secured: the browser success redirect only shows a "confirming…" banner. **Access is granted only after a signature-verified webhook** causes the server to re-read the subscription from Stripe and store it. Duplicate deliveries are ignored (`billing_events` unique on the Stripe event id); failures return HTTP 500 so Stripe retries; a nightly job reconciles local rows with Stripe and recovers customers whose webhook never arrived.

## 8. Local development

```bash
npx supabase start
npm run db:reset
npm run dev                                   # http://localhost:3000
stripe login && npm run stripe:listen         # prints a whsec_… — put it in .env.local as STRIPE_WEBHOOK_SECRET
stripe trigger customer.subscription.created  # sample event (will be recorded; unknown customers are rejected by design)
npm run seed:dev                              # demo users (password printed)
```
To test a real subscription flow: log in as a verified user, go to `/pricing`, subscribe with Stripe test card `4242 4242 4242 4242`; watch `/admin/billing-events`. Test failure: `4000 0000 0000 0341`.

## 9. Tests

```bash
npm test               # Vitest: unit tests (+ live RLS suite if TEST_SUPABASE_* set)
npm run test:db        # pgTAP via Supabase CLI
npm run test:e2e       # Playwright (needs the app + Supabase running; see header of tests/e2e/app.spec.ts)
npm run typecheck && npm run lint && npm run build
```
Never point tests at production. The integration suite refuses to run without explicit `TEST_SUPABASE_*` variables; `seed:dev` refuses non-local URLs.

## 10. Deploy to Vercel

1. Push to Git; **Import** the repo in Vercel (framework: Next.js; defaults are fine).
2. Add **all** variables from `.env.example` in Project Settings → Environment Variables (Production + Preview as needed). Set `NEXT_PUBLIC_APP_URL` to the final https URL.
3. `vercel.json` registers the daily cron `/api/cron/maintenance` (Vercel sends `Authorization: Bearer $CRON_SECRET`). Hobby plans allow daily crons only.
4. Deploy, then update Supabase **Site URL / Redirect URLs** and the Stripe **webhook endpoint** to the production domain; switch Stripe to live keys/prices when ready.
5. **Domain & HTTPS**: Vercel → Domains → add your domain, create the DNS record Vercel shows; HTTPS certificates are automatic. Security headers (HSTS, CSP, frame deny, nosniff, referrer, permissions) are set in `next.config.ts`.

Hardening note: the CSP allows inline scripts/styles (required by Next's bootstrap). For a stricter nonce-based CSP follow Next's "Content Security Policy" guide.

## 11. Database backup and recovery

* **Supabase Pro+**: daily backups and optional **Point-in-Time Recovery** (Project → Database → Backups). Restore from the dashboard; PITR restores to a chosen second.
* **Free tier**: no managed backups. Schedule your own: `pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner -f backup-$(date +%F).dump` (use the pooled/direct connection string from Settings → Database) to encrypted off-site storage.
* **Restore drill** (do this before launch and quarterly): create a scratch project → `pg_restore --clean --if-exists --no-owner -d "$SCRATCH_DB_URL" backup.dump` → run the RLS checks in §5 and log in as a test user.
* Application-level safety net: users can export their complete data at `/dashboard/export`; voided/replaced transactions are never deleted; accounts requested for deletion are retained `account_retention_days` (default 30) before the nightly purge.
* Keep migrations in Git; never edit applied migrations — add a new one.

## 12. Production smoke tests

1. `curl -sI https://your-domain/` → 200 with `strict-transport-security`, `x-frame-options: DENY`.
2. `curl -s -X POST https://your-domain/api/webhooks/stripe -d '{}'` → **400** (unsigned requests rejected).
3. `curl -s -o /dev/null -w '%{http_code}' https://your-domain/api/export/people` → **401**.
4. Sign up with a real inbox → verify email → `/pricing` shows two plans → subscribe (live mode, small real price or 100%-off coupon) → within seconds `/settings/subscription` shows *active* and `/dashboard` opens.
5. Add a person (zero totals) → add received + given → balance & "Owes you / You owe" correct → export PDF/XLSX/CSV open correctly.
6. Second account cannot open the first account's `/dashboard/people/<id>` (404).
7. Stripe → send test webhook from the dashboard → appears **processed** in `/admin/billing-events`.
8. Cancel in the portal → page shows "Access until <date>"; after that date (or using a test clock) access ends and `/subscription-expired` appears; renewing restores it.
9. `/admin` as a normal user redirects to `/dashboard`; as the Super Admin shows stats.
10. Trigger the cron once: `curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/maintenance`.

## 13. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Every page 500s locally | Missing `NEXT_PUBLIC_SUPABASE_URL` / publishable key (middleware needs them). Check `.env.local`, restart `npm run dev`. |
| "Missing or invalid environment variable X" | Server secret not set (or set for the wrong Vercel environment). |
| Verification / reset link goes to the wrong site | Supabase **Site URL** / **Redirect URLs** not updated. |
| Link says "invalid or expired" | Links are single-use and short-lived; request a new one. Corporate mail scanners can pre-open links — use the `token_hash` template flow. |
| Paid but still redirected to pricing | Webhook not delivered: check `/admin/billing-events` (failed?), the endpoint URL, and `STRIPE_WEBHOOK_SECRET` (test vs live differ). Use **Reconcile** on `/admin/subscriptions` or wait for the nightly job. |
| Webhook returns 400 | Signature mismatch: wrong secret, or a proxy altered the body. |
| Webhook event "Unknown Stripe customer" | Subscription belongs to a customer this app did not create (e.g. created manually in Stripe). Create subscriptions only via the app, or insert the mapping into `billing_customers`. |
| "This plan is not connected to billing" | Plan has no `stripe_price_id` — use **Save & create in Stripe** in `/admin/plans`. |
| `permission denied for table …` in app logs | A query hit a table the role has no grant for — by design for protected tables; use the RPC/endpoint instead. |
| People list empty for a subscribed user | `has_app_access()` is false: email unverified, subscription row missing/not active, account suspended or pending deletion. Query `select * from subscriptions where user_id = …`. |
| `subscription_required` on writes | Same as above; check `current_period_end` is in the future (6 h webhook buffer). |
| Export PDF shows `?` characters | Built-in PDF font is Latin-1. Register a Unicode TTF with `doc.registerFont` in `features/exports/pdf.ts` for other scripts. |
| Cron returns 401 | `CRON_SECRET` mismatch between Vercel env and the request header. |
| `supabase test db` fails on `create extension pgtap` | Use the Supabase CLI (≥1.200) local stack; hosted projects don't run pgTAP. |

---

## Business rules reference

* **Ledger**: Total received = Σ valid *received*; Total given = Σ valid *given*; **Outstanding = received − given**, per currency. Positive ⇒ the person owes you; negative ⇒ you owe the person; zero ⇒ settled. Every balance on screen carries that label.
* **Currencies**: each transaction stores its ISO 4217 code; totals are **never combined across currencies** (no conversion in v1). Supported list is editable in `/admin/settings` (seeded INR, USD, EUR, GBP).
* **Corrections**: *Correct* = void original + insert linked replacement; *Void* = stop counting but keep visible. Both need a reason and write before/after snapshots + actor + time.
* **Reporting time zone**: dates are calendar dates; "today" and all timestamps in the UI, exports and statements use the **profile time zone** (default `Asia/Kolkata`, changeable per user and by default in settings).
* **Access policy** (`access-policy.ts`, mirrored in SQL): active/trialing until period end (+6 h buffer for webhook latency; includes scheduled-to-cancel); past_due → grace of N days (default 3) from the first failure; **canceled, unpaid, incomplete, incomplete_expired, paused → no access**; unverified email, suspension or pending deletion → no access. Records are never deleted on expiry.
* **Account deletion**: access blocked immediately, Stripe renewal cancelled, data purged after the retention window (default 30 days) by the nightly job; can be cancelled before then.
* **Exports**: streamed in pages; formulas neutralised in CSV/XLSX; ownership and subscription enforced per request; rate limited.

## Remaining manual steps and external accounts

1. Create a Supabase project and (for production) configure custom SMTP.
2. Create a Stripe account; create monthly & yearly prices (or use `/admin/plans`); enable the Customer Portal; add the webhook endpoint.
3. **Decide real prices** (placeholders are fake) and your currencies. The price sync assumes two-decimal currencies.
4. Create the first Super Admin with the SQL in §5.
5. Run `npm install` and commit the generated `package-lock.json`; then `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, `npm run test:db`, `npm run test:e2e`, and fix anything they surface (this project could not run them when generated).
6. Review items intentionally left as v1 decisions: attachments (not implemented — schema/API have no attachment fields), no FX conversion, PDF font is Latin-1, rate limits are Postgres-backed fixed windows, past-due grace default 3 days.
7. Domain/DNS, Vercel project, environment variables, Supabase and Stripe URL updates (see §10).
8. Legal pages (terms, privacy, refund policy) and Stripe Tax settings if applicable — not included.

## Hi there 👋

<!--
**flytransaction/flytransaction** is a ✨ _special_ ✨ repository because its `README.md` (this file) appears on your GitHub profile.

Here are some ideas to get you started:

- 🔭 I’m currently working on ...
- 🌱 I’m currently learning ...
- 👯 I’m looking to collaborate on ...
- 🤔 I’m looking for help with ...
- 💬 Ask me about ...
- 📫 How to reach me: ...
- 😄 Pronouns: ...
- ⚡ Fun fact: ...
-->
