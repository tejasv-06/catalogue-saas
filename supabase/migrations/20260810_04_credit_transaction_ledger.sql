-- Milestone 27 (C5 / Roadmap 10F) — turn deduct_credits into an atomic
-- balance-update-plus-ledger-entry, instead of a balance-only update.
-- Run this in the Supabase SQL editor (Dashboard > SQL Editor) once, same
-- manual-apply discipline as the sibling migration files in this folder.
--
-- credit_transactions itself already exists (created in
-- 20260810_02_catalog_foundation.sql) with RLS enabled and a SELECT-only
-- policy for clients — unchanged by this migration. This file only adds a
-- CHECK constraint on `reason` (not present when the table was first
-- created) and replaces the deduct_credits function.
--
-- IMPORTANT — function signature change, not an in-place edit:
-- `create or replace function` only replaces a function whose argument
-- list matches exactly. Adding p_reason as a third parameter (even with a
-- default) would NOT replace the existing two-argument
-- deduct_credits(uuid, integer) — it would create a second, overloaded
-- function alongside it, leaving both live simultaneously. Two functions
-- with the same name is exactly the kind of ambiguity PostgREST's RPC
-- resolution must not be left to guess through, so the old signature is
-- explicitly dropped first.

alter table credit_transactions
  drop constraint if exists credit_transactions_reason_check;
alter table credit_transactions
  add constraint credit_transactions_reason_check
  check (reason in ('generation', 'account_audit', 'refund'));

drop function if exists public.deduct_credits(uuid, integer);

-- Single atomic statement (a multi-CTE query, not two separate statements
-- run back to back) — the ledger insert is sourced FROM the update's own
-- RETURNING output via the `deducted` CTE, so it only ever runs for a row
-- that the update actually touched. If the guard clause (existing user,
-- positive amount, sufficient balance) rejects the update, `deducted` is
-- empty, `logged`'s insert-select selects zero rows, and nothing is
-- written to credit_transactions — satisfying "failed deductions produce
-- no ledger entry" without a separate conditional/plpgsql branch.
--
-- delta is stored as -p_amount (negative) rather than p_amount (positive)
-- — a ledger's delta should be summable to reconstruct the balance, and a
-- deduction reduces it. A future refund (reason = 'refund') would use a
-- positive delta under this same convention; nothing here builds that
-- trigger/UI, per this milestone's explicit non-goal.
create or replace function public.deduct_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text default 'generation'
)
returns integer
language sql
as $function$
  with deducted as (
    update public.user_credits
    set credits_remaining = credits_remaining - p_amount,
        updated_at = now()
    where user_id = p_user_id
      and p_amount > 0
      and credits_remaining >= p_amount
    returning user_id, credits_remaining
  ),
  logged as (
    insert into public.credit_transactions (user_id, delta, reason)
    select user_id, -p_amount, p_reason from deducted
  )
  select credits_remaining from deducted;
$function$;
