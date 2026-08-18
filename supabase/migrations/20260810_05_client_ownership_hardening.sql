-- Milestone 28 (C6 / Roadmap 10G): harden clients/Brand Voice ownership.
--
-- clients.user_id (uuid, FK -> auth.users, nullable) already exists: this
-- is the "existing equivalent" of owner_user_id the milestone brief asks
-- for; no new or renamed column is introduced.
--
-- RLS on clients was found ALREADY LIVE and correctly enforcing
-- auth.uid() = user_id for SELECT/INSERT/UPDATE: verified fresh this
-- milestone via real authenticated-session probes (not assumed from any
-- prior report): the real signed-in user's SELECT returns only their own
-- rows, an INSERT/UPDATE attempting to set/change user_id to a different
-- value is rejected with a 42501 RLS violation, and attempting to
-- UPDATE/DELETE another row by its known id affects zero rows. Nobody
-- knows when or by whom these three policies were added: they predate
-- every migration file in this repository. This migration does NOT
-- recreate or touch SELECT/INSERT/UPDATE. It adds exactly the two things
-- verified missing:
--
-- 1. An owner-scoped DELETE policy. Verified live that NO ONE: not even
--    a row's own owner: can currently delete a clients row (RLS enabled,
--    zero policies for DELETE: an authenticated owner's DELETE by known id
--    affected zero rows). The milestone brief explicitly asks for
--    owner-scoped DELETE; ClientSelector.tsx has no delete UI and none is
--    added here (out of scope: "do not redesign the UI"), but the
--    capability now exists at the RLS layer for if/when a delete UI is
--    ever built.
--
-- 2. A guarded backfill for real, pre-existing rows with user_id IS NULL
--    (found live during this milestone's audit: two rows, "MECC" and
--    "VYOM"). Because auth.uid() = user_id can never be true against NULL,
--    these rows are currently invisible to everyone, including whoever
--    created them: exactly the orphaning C6-AC9 calls out. There is no
--    reliable signal anywhere in this schema identifying who created them.
--    The only user this project currently has is the sole row in
--    user_credits, so the backfill is guarded to run ONLY when exactly one
--    user_credits row exists; if that's no longer true by the time this is
--    applied, the block intentionally does nothing rather than guessing,
--    and any remaining NULL rows are left exactly as found for a human to
--    resolve explicitly.

alter table clients enable row level security;

drop policy if exists "clients_owner_delete" on clients;
create policy "clients_owner_delete" on clients
  for delete using (auth.uid() = user_id);

do $$
declare
  v_user_count integer;
  v_sole_user_id uuid;
begin
  select count(*) into v_user_count from user_credits;
  if v_user_count = 1 then
    select user_id into v_sole_user_id from user_credits limit 1;
    update clients
    set user_id = v_sole_user_id
    where user_id is null;
  end if;
end $$;
