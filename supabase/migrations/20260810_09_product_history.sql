-- Milestone C14 (Milestone 34) — Product History & Timeline.
-- Run this in the Supabase SQL editor (Dashboard > SQL Editor) once, same
-- manual-apply discipline as every sibling migration in this folder.
--
-- Filename note: the spec for this milestone suggested
-- "20260810_10_product_history.sql", written against a timeline where a
-- "09" migration already existed. In the actual current baseline (C13,
-- ending at 20260810_08_credit_purchases.sql) 09 is the real next number,
-- so this file uses that instead — no functional difference, just correct
-- sequencing for this repository's real migration history.
--
-- PURPOSE — an append-only, product-centric audit timeline
-- ("PRODUCT -> PRODUCT EVENTS/HISTORY -> TIMELINE"), additive to every
-- existing table. Does NOT touch catalog_products, catalog_listings,
-- catalog_listing_approvals, catalog_exports, credit_transactions,
-- user_credits, clients, or their RLS policies in any way. C7 Export
-- History (catalog_exports) remains the sole authoritative export record;
-- this table only ever POINTS AT an existing catalog_exports row (via
-- metadata.export_id), never duplicates or replaces it.
--
-- OWNERSHIP — denormalized owner_user_id, same deliberate choice already
-- made for catalog_listings/catalog_listing_approvals in
-- 20260810_02_catalog_foundation.sql ("so its own RLS policies can check
-- ownership directly with no join"). Derived server-side from the
-- authenticated session (lib/productHistory.ts), never accepted as a
-- caller-supplied value — identical discipline to every write in
-- lib/catalog.ts.
--
-- APPEND-ONLY — modeled directly on catalog_exports' own precedent in the
-- same foundation migration: SELECT + INSERT policies only, no UPDATE/
-- DELETE policy for any client role at all. That is what makes this table
-- structurally append-only (Postgres denies a command with no matching
-- policy), not just an application-level convention.

create table if not exists product_history_events (
  id uuid primary key default gen_random_uuid(),
  -- True insertion-order tiebreaker for "same-timestamp" ordering
  -- (created_at alone is not guaranteed unique) — a plain identity
  -- sequence, never exposed as a public-facing id, only used to order rows
  -- deterministically when their created_at values collide.
  seq bigint generated always as identity,
  product_id uuid not null references catalog_products(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'product_created',
    'product_updated',
    'enrichment_started',
    'enrichment_completed',
    'enrichment_failed',
    'listing_generated',
    'listing_edited',
    'listing_approved',
    'listing_rejected',
    'exported'
  )),
  -- Same four-value constraint catalog_listings/catalog_exports already
  -- enforce — marketplace-specific events (e.g. "exported") carry it here
  -- rather than inventing a per-marketplace event_type
  -- (amazon_exported/myntra_exported/...), exactly as the spec requires.
  marketplace text check (marketplace is null or marketplace in ('amazon', 'flipkart', 'myntra', 'etsy')),
  listing_id uuid references catalog_listings(id) on delete set null,
  -- Bounded, JSON-safe context only (e.g. {"source":"manual"},
  -- {"export_id":"...","format":"csv"}) — never a snapshot of generated
  -- content, prompts, or secrets. Enforced in application code
  -- (lib/productHistory.ts), not by the database.
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists product_history_events_product_created_idx
  on product_history_events(product_id, created_at desc, seq desc);
create index if not exists product_history_events_product_type_idx
  on product_history_events(product_id, event_type);
create index if not exists product_history_events_listing_idx
  on product_history_events(listing_id) where listing_id is not null;
create index if not exists product_history_events_owner_idx
  on product_history_events(owner_user_id);

alter table product_history_events enable row level security;

drop policy if exists "product_history_events_owner_select" on product_history_events;
create policy "product_history_events_owner_select" on product_history_events
  for select using (auth.uid() = owner_user_id);

-- WITH CHECK verifies BOTH that the caller is inserting under their own
-- identity (owner_user_id = auth.uid(), never a client-supplied id) AND
-- that product_id genuinely belongs to a product they own — belt-and-
-- suspenders beyond the single-column check every other C1-C13 owner
-- policy uses, since this table's whole purpose is being a trustworthy
-- audit trail (section 15 of the spec marks this CRITICAL).
drop policy if exists "product_history_events_owner_insert" on product_history_events;
create policy "product_history_events_owner_insert" on product_history_events
  for insert with check (
    auth.uid() = owner_user_id
    and exists (
      select 1 from catalog_products cp
      where cp.id = product_history_events.product_id
        and cp.owner_user_id = auth.uid()
    )
  );

-- No update/delete policy for any client role, on purpose — identical
-- reasoning to catalog_exports above: a history event is a historical
-- fact, never meant to be edited or removed after the fact. service_role
-- (used only by scripts/tests, never by the app itself for this table) is
-- unaffected by RLS, same as every other table in this project.
