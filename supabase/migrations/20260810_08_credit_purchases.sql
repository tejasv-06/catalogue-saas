-- Milestone C13 (Phase 10N) — Stripe / Credits / Billing.
--
-- Additive only. Does not touch user_credits' existing shape, does not
-- touch deduct_credits() (C5's generation-deduction RPC, untouched), does
-- not weaken any existing RLS policy on any table.
--
-- credit_purchases is the new purchase/payment-transaction record. Every
-- write to it happens server-side (checkout-creation route, webhook route)
-- using the service-role client — same discipline lib/credits.ts already
-- uses for user_credits/credit_transactions, never exposed to the browser.
-- Authenticated users get read-only access to their OWN rows and nothing
-- else: no INSERT/UPDATE/DELETE policy exists for the authenticated role at
-- all, which is what makes "users cannot mark their own purchase
-- paid/fulfilled" true by construction rather than by a nuanced check.
create table if not exists credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Every Checkout Session this app ever creates is unique per attempt
  -- (created fresh by app/api/billing/create-checkout/route.ts) — the
  -- unique constraint below is the first line of duplicate-processing
  -- defense: a webhook retried for the same session can find the existing
  -- row instead of creating a second pending purchase.
  stripe_checkout_session_id text not null,
  stripe_payment_intent_id text,
  -- The specific event id that fulfilled this purchase (checkout.session.
  -- completed) — the second, independent line of duplicate-processing
  -- defense at the event level, since Stripe explicitly documents webhook
  -- delivery as at-least-once, not exactly-once.
  stripe_event_id text,
  stripe_customer_id text,
  -- References lib/creditPackages.ts's server-trusted config, never a
  -- browser-supplied credit/amount value — see that file for why no
  -- pre-created Stripe Price ID is required (price_data is built inline at
  -- Checkout-Session-creation time from this same trusted config).
  package_id text not null,
  credits integer not null check (credits > 0),
  amount integer not null check (amount >= 0), -- smallest currency unit (e.g. cents)
  currency text not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'fulfilled', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  fulfilled_at timestamptz
);

-- Duplicate Checkout session can never create a second purchase row.
create unique index if not exists credit_purchases_checkout_session_idx
  on credit_purchases(stripe_checkout_session_id);

-- Duplicate webhook event can never fulfill a second time (partial index —
-- multiple pending rows legitimately have stripe_event_id still null).
create unique index if not exists credit_purchases_event_idx
  on credit_purchases(stripe_event_id) where stripe_event_id is not null;

create index if not exists credit_purchases_user_idx on credit_purchases(user_id);

alter table credit_purchases enable row level security;

drop policy if exists "credit_purchases_owner_select" on credit_purchases;
create policy "credit_purchases_owner_select" on credit_purchases
  for select using (auth.uid() = user_id);
-- Deliberately no INSERT/UPDATE/DELETE policy for the authenticated role —
-- every write to this table is server-authoritative (service-role, inside
-- the checkout-creation and webhook routes only). This is what makes
-- C13-AC20 ("users cannot mark purchases paid/fulfilled themselves") true
-- structurally, not just enforced by application code that could have a bug.

-- Extends credit_transactions' existing reason CHECK constraint (added in
-- 20260810_04_credit_transaction_ledger.sql for 'generation'/
-- 'account_audit'/'refund') to also allow 'purchase' — additive, does not
-- remove or alter the three existing values, and does not touch
-- deduct_credits() or generation-deduction semantics at all.
alter table credit_transactions
  drop constraint if exists credit_transactions_reason_check;
alter table credit_transactions
  add constraint credit_transactions_reason_check
  check (reason in ('generation', 'account_audit', 'refund', 'purchase'));

-- Milestone C13 — the atomic credit-award counterpart to C5's
-- deduct_credits(). Mirrors its exact structure (a single multi-CTE `sql`
-- function, guard clause in the UPDATE's WHERE, ledger insert sourced from
-- the update's own RETURNING output so it only ever runs when the guard
-- actually passed) rather than a plpgsql function with separate statements
-- — same reasoning deduct_credits' own migration documents: one atomic
-- statement is what makes "credit award + ledger entry + purchase
-- fulfillment" a single indivisible unit, with no window for one to
-- succeed without the others.
--
-- The idempotency guard is `status <> 'fulfilled'` in the purchase-update
-- CTE's WHERE clause — a purchase already fulfilled matches zero rows,
-- which cascades to zero rows in every dependent CTE below it (credited,
-- logged), so a retried webhook call for an already-fulfilled purchase is
-- a guaranteed no-op: no double credit, no duplicate ledger row, no error.
-- service_role is the only caller (app/api/billing/stripe-webhook/route.ts)
-- — never exposed to PostgREST with anon/authenticated privileges beyond
-- that, same as deduct_credits.
create or replace function public.award_purchase_credits(
  p_purchase_id uuid,
  p_user_id uuid,
  p_credits integer
)
returns table (credits_remaining integer, already_fulfilled boolean)
language sql
as $function$
  with fulfilled_purchase as (
    update public.credit_purchases
    set status = 'fulfilled',
        fulfilled_at = now()
    where id = p_purchase_id
      and user_id = p_user_id
      and status <> 'fulfilled'
    returning id, user_id
  ),
  credited as (
    insert into public.user_credits (user_id, credits_remaining)
    select p_user_id, p_credits
    from fulfilled_purchase
    on conflict (user_id) do update
      set credits_remaining = public.user_credits.credits_remaining + p_credits
    returning credits_remaining
  ),
  logged as (
    insert into public.credit_transactions (user_id, delta, reason, reference_id)
    select p_user_id, p_credits, 'purchase', p_purchase_id::text
    from fulfilled_purchase
  )
  select
    (select credits_remaining from credited) as credits_remaining,
    (select count(*) = 0 from fulfilled_purchase) as already_fulfilled;
$function$;
