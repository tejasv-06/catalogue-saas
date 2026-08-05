-- Run this in the Supabase SQL editor (Dashboard > SQL Editor) once.
-- This project has no linked Supabase CLI / migrations pipeline (same as the
-- existing guest_usage table), so nothing applies this automatically.

create table if not exists user_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits_remaining integer not null default 10,
  updated_at timestamptz not null default now()
);

alter table user_credits enable row level security;

-- Reads only, and only of your own row — every write goes through server
-- routes using the service_role key (bypasses RLS), never directly from the
-- browser with the anon key, same discipline as guest_usage.
drop policy if exists "select_own_credits" on user_credits;
create policy "select_own_credits" on user_credits
  for select using (auth.uid() = user_id);

-- Atomic decrement: `credits_remaining = credits_remaining - p_amount` is a
-- single row-level UPDATE, so concurrent deductions for the same user can't
-- lose an update the way a read-then-write in application code could.
-- Deliberately has no "enough credits?" guard here — that check already
-- happened in the app before generation started; this just needs to apply
-- the deduction correctly under concurrency, not re-enforce the limit.
create or replace function deduct_credits(p_user_id uuid, p_amount integer)
returns integer
language sql
as $$
  update user_credits
  set credits_remaining = credits_remaining - p_amount,
      updated_at = now()
  where user_id = p_user_id
  returning credits_remaining;
$$;
