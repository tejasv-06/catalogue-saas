-- Milestone 12: restore the missing deduct_credits RPC.
-- Updated: deduct_credits now strictly requires a sufficient balance before
-- deducting (WHERE ... AND p_amount > 0 AND credits_remaining >= p_amount),
-- returning zero rows (null) instead of allowing credits_remaining to go
-- negative. lib/credits.ts's deductCredits() was updated alongside this to
-- treat a null/undefined result as a failed deduction, not a silent success
--: see that file for the corresponding fix.
--
-- Run this in the Supabase SQL editor (Dashboard > SQL Editor) once, same
-- manual-apply discipline as the sibling migration files in this folder.
--
-- CONFIRMED LIVE, empirically, in Milestone 12: a direct POST to
-- /rest/v1/rpc/deduct_credits (service-role key, a nonexistent all-zero
-- p_user_id, p_amount: 0: a call guaranteed to be a safe no-op even if the
-- function existed, since no real user_credits row has that id) returned:
--   404 PGRST202 "Could not find the function public.deduct_credits(p_amount,
--   p_user_id) in the schema cache"
-- This is not an inference from the OpenAPI doc omitting it: it's Postgres
-- itself reporting the function doesn't exist. The bug is entirely that the
-- function was never actually created in the live database
-- (supabase/migrations/user_credits.sql, which defines an earlier,
-- unguarded version of it, carries its own header note that nothing in this
-- project applies migrations automatically: it was evidently never run in
-- full).
--
-- This migration does not change CREDIT_COSTS, does not introduce a
-- transaction ledger (that's Phase F, and credit_transactions from the
-- Milestone 11 migration is intentionally not written to here), and does
-- not touch user_credits' existing columns or RLS policy.

create or replace function public.deduct_credits(
    p_user_id uuid,
    p_amount integer
)
returns integer
language sql
as $function$
    update public.user_credits
    set
        credits_remaining = credits_remaining - p_amount,
        updated_at = now()
    where user_id = p_user_id
      and p_amount > 0
      and credits_remaining >= p_amount
    returning credits_remaining;
$function$;
