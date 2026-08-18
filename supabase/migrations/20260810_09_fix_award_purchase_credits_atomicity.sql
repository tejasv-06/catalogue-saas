-- Milestone C13 follow-up: fixes a real double-credit bug found during
-- live verification.
--
-- ROOT CAUSE: app/api/billing/stripe-webhook/route.ts called
-- markPurchasePaid() (a plain, unconditional UPDATE setting
-- status = 'paid') immediately before calling the award_purchase_credits()
-- RPC, on EVERY webhook invocation: including replays of an
-- already-fulfilled purchase. That UPDATE had no guard, so it silently
-- reset status from 'fulfilled' back to 'paid', erasing the exact state
-- award_purchase_credits()'s own `status <> 'fulfilled'` idempotency guard
-- depends on. A replayed webhook for an already-fulfilled purchase then
-- saw a non-fulfilled row and, correctly per ITS OWN guard, awarded
-- credits again. Live-verified: two real Stripe webhook deliveries for the
-- same event produced two `credit_transactions` rows (+50 each) for one
-- $5 purchase.
--
-- FIX: fold "record Stripe's payment identifiers" into the SAME atomic
-- statement as the credit award and fulfillment flip, instead of a
-- separate prior UPDATE. There is now exactly one write path from
-- "payment verified" to "credits awarded, ledger recorded, purchase
-- fulfilled, Stripe identifiers captured": no intermediate,
-- unguarded state change sits between the webhook's signature check and
-- the atomic award anymore.
--
-- Signature change (3 args -> 6 args) means CREATE OR REPLACE would create
-- a second overloaded function instead of replacing this one: same
-- lesson C5's own deduct_credits migration already documented: so the
-- old 3-argument signature is dropped explicitly first.
drop function if exists public.award_purchase_credits(uuid, uuid, integer);

create or replace function public.award_purchase_credits(
  p_purchase_id uuid,
  p_user_id uuid,
  p_credits integer,
  p_stripe_payment_intent_id text,
  p_stripe_event_id text,
  p_stripe_customer_id text
)
returns table (credits_remaining integer, already_fulfilled boolean)
language sql
as $function$
  with fulfilled_purchase as (
    update public.credit_purchases
    set status = 'fulfilled',
        paid_at = coalesce(paid_at, now()),
        fulfilled_at = now(),
        stripe_payment_intent_id = p_stripe_payment_intent_id,
        stripe_event_id = p_stripe_event_id,
        stripe_customer_id = p_stripe_customer_id
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
