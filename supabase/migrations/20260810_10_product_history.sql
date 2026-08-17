-- Milestone C14 — Product History & Timeline. A new, append-only,
-- product-centric audit log — NOT a rebuild of C7's catalog_exports/export
-- history (that table, its RLS, and lib/catalog.ts's recordExport/
-- getExportHistory are all untouched by this migration). This table only
-- ever POINTS AT an existing catalog_exports row for export events
-- (metadata.export_id), never duplicates one.
--
-- Purely additive: no existing table's columns, indexes, or policies are
-- touched. Reversible in concept via `drop table if exists
-- product_history_events` — no other object depends on it.

create table if not exists product_history_events (
  id uuid primary key default gen_random_uuid(),
  -- A monotonically increasing tiebreaker for deterministic ordering when
  -- two events share the same created_at (same millisecond) — created_at
  -- alone isn't a stable sort key at insert-heavy moments (e.g. a batch
  -- export recording several events back to back).
  seq bigint generated always as identity,
  product_id uuid not null references catalog_products(id) on delete cascade,
  -- Denormalized, same deliberate pattern as catalog_listings.owner_user_id
  -- in the C1 foundation migration (also derivable via product_id ->
  -- catalog_products.owner_user_id) — lets RLS check ownership on this
  -- table directly, without a join, for both read and write policies.
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
  -- Optional — most event types have no marketplace. Marketplace-specific
  -- events (exported, listing_generated, etc.) carry it here, never as a
  -- separate event_type per marketplace (event_type stays a small, fixed
  -- vocabulary; marketplace is data, not identity).
  marketplace text check (marketplace is null or marketplace in ('amazon', 'flipkart', 'myntra', 'etsy')),
  listing_id uuid references catalog_listings(id) on delete set null,
  -- Bounded, JSON-safe context only (e.g. {"source": "manual"},
  -- {"export_id": "...", "format": "csv"}) — never a full listing payload,
  -- an AI prompt, or a secret. Enforced in application code
  -- (lib/productHistory.ts), not by a jsonb CHECK constraint (Postgres
  -- can't easily express "flat object of primitives only").
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

-- INSERT only — deliberately no UPDATE or DELETE policy for any client
-- role, at all. Postgres denies a verb entirely when no policy grants it,
-- regardless of ownership, which is what makes this table structurally
-- append-only rather than "append-only by convention." The WITH CHECK
-- verifies BOTH that the caller's own session owns the row it's about to
-- insert (auth.uid() = owner_user_id) AND that the referenced product_id
-- genuinely belongs to that same session — a caller cannot attach a
-- history event to a product it doesn't own, even if it supplied its own
-- correct owner_user_id.
drop policy if exists "product_history_events_owner_insert" on product_history_events;
create policy "product_history_events_owner_insert" on product_history_events
  for insert with check (
    auth.uid() = owner_user_id
    and exists (
      select 1 from catalog_products
      where catalog_products.id = product_history_events.product_id
        and catalog_products.owner_user_id = auth.uid()
    )
  );
