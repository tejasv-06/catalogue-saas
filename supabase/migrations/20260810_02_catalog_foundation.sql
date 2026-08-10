-- Milestone 11 — Schema foundation for the future persistent catalog.
-- Run this in the Supabase SQL editor (Dashboard > SQL Editor) once, same
-- manual-apply discipline as the sibling migration files in this folder.
--
-- NOTHING in the current application reads or writes these tables yet. They
-- exist so a future milestone (Phase C+) has real, RLS-protected storage to
-- write to — this migration only creates the tables, it does not wire
-- generate-single, CatalogueWorkspace.tsx, or the export flow to them.
--
-- NAMING DECISION: a legacy `products` table already exists (see the sibling
-- baseline migration) with a completely different shape (no owner, one row
-- per product with no marketplace concept). Reusing the name `products` for
-- the new, user-owned, marketplace-aware entity would collide and would be
-- ambiguous in every future query. New tables are prefixed `catalog_` to
-- keep them clearly, permanently distinguishable from the legacy
-- products/clients/guest_usage/user_credits tables at a glance, while still
-- following the project's existing plain-snake_case naming style.
--
-- OWNERSHIP: catalog_products is owned directly by auth.users.id
-- (owner_user_id), NOT via the `clients` table. The future direction is
-- User -> Brand -> Product -> Listing -> Listing Approval, but `clients`
-- (the future "Brand") has no enforced per-user ownership yet — fixing that
-- is Phase G, explicitly out of scope here. catalog_products.client_id is
-- included as an OPTIONAL, nullable link to an existing `clients` row (so a
-- product can reference a brand-voice profile once one is eventually
-- selected), but nothing about `clients` itself is modified, and nothing
-- requires this column to be set.
--
-- catalog_listings.owner_user_id is a deliberate denormalization (also
-- derivable via catalog_listings.product_id -> catalog_products.owner_user_id)
-- so its own RLS policies can check ownership directly with no join —
-- simpler and cheaper to evaluate on every row than a subquery per check.

create table if not exists catalog_products (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  brand_name text,
  description text,
  category text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists catalog_products_owner_idx on catalog_products(owner_user_id);
create index if not exists catalog_products_client_idx on catalog_products(client_id);

-- One row per (product, marketplace) — the entity that does not exist at
-- all in the current architecture, where a "listing" is only ever a key
-- inside a client-side generatedContent map (lib/types.ts). marketplace is
-- constrained to the same four values SUPPORTED_MARKETPLACES defines in
-- lib/platformShapers.ts today — no marketplace is invented here beyond
-- what the current TypeScript model already supports.
--
-- shaped_content mirrors generatedContent[marketplace] (the marketplace-
-- shaped object shapeForPlatform() produces — its exact per-marketplace
-- fields already vary and are already untyped `any` on the client, so jsonb
-- is a direct, non-lossy lift, not a new source of looseness).
-- generation_meta mirrors generationMeta[marketplace] (lib/listingHealth.ts's
-- GenerationMeta, already a well-typed, JSON-serializable shape).
-- generation_error mirrors generationError[marketplace] (a plain string).
create table if not exists catalog_listings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references catalog_products(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  marketplace text not null check (marketplace in ('amazon', 'flipkart', 'myntra', 'etsy')),
  shaped_content jsonb,
  generation_meta jsonb,
  generation_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, marketplace)
);

create index if not exists catalog_listings_product_idx on catalog_listings(product_id);
create index if not exists catalog_listings_owner_idx on catalog_listings(owner_user_id);

-- 1:1 with catalog_listings — mirrors today's client-only
-- approved[marketplace] boolean, but as a real, timestamped, attributable
-- record (today's version has no "who" or "when" at all). Preparation for
-- Phase D; the current client-side approval system is not changed by this
-- migration.
create table if not exists catalog_listing_approvals (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references catalog_listings(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  approved boolean not null default false,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id)
);

create index if not exists catalog_listing_approvals_listing_idx on catalog_listing_approvals(listing_id);
create index if not exists catalog_listing_approvals_owner_idx on catalog_listing_approvals(owner_user_id);

-- One row per export action. Today's export is already grouped one-CSV-per-
-- marketplace (lib/exportShapers.ts / performExport in CatalogueWorkspace.tsx),
-- so one Export row per marketplace-batch matches the real current shape.
-- A plain listing_ids array is used instead of a separate ExportItem join
-- table — an export batch is written once and never queried/joined against
-- individual line items elsewhere in the current design, so a join table
-- would add schema surface with no current read pattern to justify it.
create table if not exists catalog_exports (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  marketplace text not null check (marketplace in ('amazon', 'flipkart', 'myntra', 'etsy')),
  listing_ids uuid[] not null default '{}',
  item_count integer not null default 0,
  file_name text,
  created_at timestamptz not null default now()
);

create index if not exists catalog_exports_owner_idx on catalog_exports(owner_user_id);

-- Append-only ledger. user_credits.credits_remaining stays the fast-path
-- balance (untouched by this migration, deduct_credits RPC untouched); this
-- table exists only so a future milestone can start recording individual
-- transactions alongside it without a schema change at that point. Nothing
-- writes to this table yet.
create table if not exists credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  reason text not null,
  reference_id text,
  created_at timestamptz not null default now()
);

create index if not exists credit_transactions_user_idx on credit_transactions(user_id);

-- RLS — every table above is user-owned and must deny cross-user access by
-- default. Policies below are scoped strictly to `auth.uid() = owner_user_id`
-- (or `= user_id` for credit_transactions) — never a client-supplied value,
-- and never a blanket "authenticated can do anything" policy. service_role
-- is unaffected by RLS (Postgres/Supabase default) so future server-side
-- write paths (Phase C+) will work without any policy change here.

alter table catalog_products enable row level security;
drop policy if exists "catalog_products_owner_select" on catalog_products;
create policy "catalog_products_owner_select" on catalog_products
  for select using (auth.uid() = owner_user_id);
drop policy if exists "catalog_products_owner_insert" on catalog_products;
create policy "catalog_products_owner_insert" on catalog_products
  for insert with check (auth.uid() = owner_user_id);
drop policy if exists "catalog_products_owner_update" on catalog_products;
create policy "catalog_products_owner_update" on catalog_products
  for update using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
drop policy if exists "catalog_products_owner_delete" on catalog_products;
create policy "catalog_products_owner_delete" on catalog_products
  for delete using (auth.uid() = owner_user_id);

alter table catalog_listings enable row level security;
drop policy if exists "catalog_listings_owner_select" on catalog_listings;
create policy "catalog_listings_owner_select" on catalog_listings
  for select using (auth.uid() = owner_user_id);
drop policy if exists "catalog_listings_owner_insert" on catalog_listings;
create policy "catalog_listings_owner_insert" on catalog_listings
  for insert with check (auth.uid() = owner_user_id);
drop policy if exists "catalog_listings_owner_update" on catalog_listings;
create policy "catalog_listings_owner_update" on catalog_listings
  for update using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
drop policy if exists "catalog_listings_owner_delete" on catalog_listings;
create policy "catalog_listings_owner_delete" on catalog_listings
  for delete using (auth.uid() = owner_user_id);

alter table catalog_listing_approvals enable row level security;
drop policy if exists "catalog_listing_approvals_owner_select" on catalog_listing_approvals;
create policy "catalog_listing_approvals_owner_select" on catalog_listing_approvals
  for select using (auth.uid() = owner_user_id);
drop policy if exists "catalog_listing_approvals_owner_insert" on catalog_listing_approvals;
create policy "catalog_listing_approvals_owner_insert" on catalog_listing_approvals
  for insert with check (auth.uid() = owner_user_id);
drop policy if exists "catalog_listing_approvals_owner_update" on catalog_listing_approvals;
create policy "catalog_listing_approvals_owner_update" on catalog_listing_approvals
  for update using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
drop policy if exists "catalog_listing_approvals_owner_delete" on catalog_listing_approvals;
create policy "catalog_listing_approvals_owner_delete" on catalog_listing_approvals
  for delete using (auth.uid() = owner_user_id);

alter table catalog_exports enable row level security;
drop policy if exists "catalog_exports_owner_select" on catalog_exports;
create policy "catalog_exports_owner_select" on catalog_exports
  for select using (auth.uid() = owner_user_id);
drop policy if exists "catalog_exports_owner_insert" on catalog_exports;
create policy "catalog_exports_owner_insert" on catalog_exports
  for insert with check (auth.uid() = owner_user_id);
-- No update/delete policy: an export record is a historical event, not
-- meant to be edited after the fact. Deliberately absent, not an oversight.

alter table credit_transactions enable row level security;
drop policy if exists "credit_transactions_owner_select" on credit_transactions;
create policy "credit_transactions_owner_select" on credit_transactions
  for select using (auth.uid() = user_id);
-- No insert/update/delete policy for any client role: this ledger is
-- intended to be written only by server-side, service-role code (Phase F),
-- the same discipline user_credits already uses for its own writes.
