-- Milestone C15: Seller Performance Intelligence (Amazon + Myntra only).
-- Two new, purely additive tables. No existing table's columns, indexes,
-- policies, or data are touched. C1-C14 architecture (catalog_products,
-- catalog_listings, catalog_exports, product_history_events, credits) is
-- completely unaffected.
--
-- catalog_product_external_ids: the product-matching mechanism (§7):
-- Canonical Product -> Marketplace -> External Product ID (Amazon ASIN,
-- Myntra Style ID). This is a plain lookup/mapping table, not a historical
-- record, so unlike marketplace_performance below it CAN be corrected
-- (update/delete) if a seller mis-mapped a report row: remapping a
-- product's external id is not the same thing as mutating a historical
-- performance observation, which stays strictly immutable.
create table if not exists catalog_product_external_ids (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references catalog_products(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  marketplace text not null check (marketplace in ('amazon', 'myntra')),
  external_id text not null,
  created_at timestamptz not null default now(),
  -- One external id maps to exactly one product per seller per marketplace
  --: the same Style ID/ASIN can never be silently attributed to two
  -- different products in one account.
  unique (owner_user_id, marketplace, external_id)
);

create index if not exists catalog_product_external_ids_product_idx
  on catalog_product_external_ids(product_id);
create index if not exists catalog_product_external_ids_lookup_idx
  on catalog_product_external_ids(owner_user_id, marketplace, external_id);

alter table catalog_product_external_ids enable row level security;

drop policy if exists "catalog_product_external_ids_owner_select" on catalog_product_external_ids;
create policy "catalog_product_external_ids_owner_select" on catalog_product_external_ids
  for select using (auth.uid() = owner_user_id);

drop policy if exists "catalog_product_external_ids_owner_insert" on catalog_product_external_ids;
create policy "catalog_product_external_ids_owner_insert" on catalog_product_external_ids
  for insert with check (
    auth.uid() = owner_user_id
    and exists (
      select 1 from catalog_products
      where catalog_products.id = catalog_product_external_ids.product_id
        and catalog_products.owner_user_id = auth.uid()
    )
  );

drop policy if exists "catalog_product_external_ids_owner_update" on catalog_product_external_ids;
create policy "catalog_product_external_ids_owner_update" on catalog_product_external_ids
  for update using (auth.uid() = owner_user_id) with check (
    auth.uid() = owner_user_id
    and exists (
      select 1 from catalog_products
      where catalog_products.id = catalog_product_external_ids.product_id
        and catalog_products.owner_user_id = auth.uid()
    )
  );

drop policy if exists "catalog_product_external_ids_owner_delete" on catalog_product_external_ids;
create policy "catalog_product_external_ids_owner_delete" on catalog_product_external_ids
  for delete using (auth.uid() = owner_user_id);

-- marketplace_performance: the canonical, marketplace-independent
-- performance model (§5), one row per (product, marketplace, period).
-- Nullable metric columns are deliberate: a marketplace/report that
-- doesn't supply a given metric leaves it null, never a fabricated 0 (see
-- lib/performanceAdapters.ts's own header comment for the full rationale).
-- APPEND-ONLY (§17), same structural enforcement as product_history_events
-- in 20260810_10_product_history.sql: SELECT + INSERT policies only, no
-- UPDATE/DELETE policy for any client role at all: a report imported
-- incorrectly is corrected via a new, superseding import (a new row, new
-- import_batch_id), never by editing history in place.
create table if not exists marketplace_performance (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references catalog_products(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  marketplace text not null check (marketplace in ('amazon', 'myntra')),
  external_product_id text not null,
  period_start date not null,
  period_end date not null,
  period_type text not null check (period_type in ('weekly', 'monthly')),
  impressions integer check (impressions is null or impressions >= 0),
  clicks integer check (clicks is null or clicks >= 0),
  add_to_carts integer check (add_to_carts is null or add_to_carts >= 0),
  purchases integer check (purchases is null or purchases >= 0),
  revenue numeric check (revenue is null or revenue >= 0),
  returns integer check (returns is null or returns >= 0),
  return_rate numeric check (return_rate is null or (return_rate >= 0 and return_rate <= 100)),
  rating numeric check (rating is null or (rating >= 0 and rating <= 5)),
  consideration_rate numeric check (consideration_rate is null or (consideration_rate >= 0 and consideration_rate <= 100)),
  conversion_rate numeric check (conversion_rate is null or (conversion_rate >= 0 and conversion_rate <= 100)),
  ctr numeric check (ctr is null or (ctr >= 0 and ctr <= 100)),
  -- Which report/source produced this row (e.g. 'myntra_impress_report',
  -- 'amazon_business_report'): not a marketplace duplicate, since one
  -- marketplace could eventually have more than one report type.
  source text not null,
  -- Groups every row committed from the same uploaded report together:
  -- the historical-snapshot identity (§6/§13): "this whole snapshot was
  -- imported on this date, from this file."
  import_batch_id uuid not null,
  -- Bounded, JSON-safe context only (mirrors product_history_events'
  -- metadata convention): e.g. raw source-reported fields with no
  -- canonical column (Style ID's Article Type/Gender/Seller MRP/Inventory
  -- Age/RPLC), never a full-row dump of sensitive data.
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists marketplace_performance_product_period_idx
  on marketplace_performance(product_id, period_start desc, period_end desc);
create index if not exists marketplace_performance_owner_idx
  on marketplace_performance(owner_user_id);
create index if not exists marketplace_performance_batch_idx
  on marketplace_performance(import_batch_id);

alter table marketplace_performance enable row level security;

drop policy if exists "marketplace_performance_owner_select" on marketplace_performance;
create policy "marketplace_performance_owner_select" on marketplace_performance
  for select using (auth.uid() = owner_user_id);

drop policy if exists "marketplace_performance_owner_insert" on marketplace_performance;
create policy "marketplace_performance_owner_insert" on marketplace_performance
  for insert with check (
    auth.uid() = owner_user_id
    and exists (
      select 1 from catalog_products
      where catalog_products.id = marketplace_performance.product_id
        and catalog_products.owner_user_id = auth.uid()
    )
  );
-- Deliberately no update/delete policy: see the header comment above.
