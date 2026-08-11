-- Milestone C12 (Phase 10M) — Brand & Client Management.
--
-- The existing `clients` table (created before any migration file in this
-- repo, hardened for ownership in 20260810_05_client_ownership_hardening.sql)
-- already IS the canonical Brand/Client record C12 asks for — this
-- migration only extends it additively. No new table, because:
--   - catalog_products.client_id already references clients(id)
--     on delete set null (20260810_02_catalog_foundation.sql) — the
--     product<->brand relationship C12 needs already exists.
--   - clients already has full owner-scoped RLS (SELECT/INSERT/UPDATE/
--     DELETE, all auth.uid() = user_id) from C6 — those policies are not
--     column-scoped, so they already cover every column added here with
--     zero new policy statements, exactly the same reasoning C9's
--     product_intelligence column addition used on catalog_products.
--
-- Column choices (per the milestone's own "prefer structured JSONB only
-- where the data is genuinely structured" instruction):
--   - brand_identity, brand_voice, target_audience, positioning: plain
--     text, matching the existing brand_guidelines column's own shape —
--     these are prose descriptions, not structured/enumerable data, and
--     nothing in the repository defines a taxonomy for them to be
--     validated against (inventing one would violate the project's
--     standing "do not fabricate unverified structure" rule, e.g.
--     lib/marketplaceRules.ts's verified/unverified split).
--   - product_categories: text[] — genuinely a flat list, no nesting,
--     native Postgres array is simpler than JSONB for this shape and
--     PostgREST already reads/writes it natively.
--   - marketplace_preferences: jsonb, keyed by marketplace id
--     (amazon/flipkart/myntra/etsy — Shopify explicitly excluded per this
--     milestone). Each entry is intentionally minimal —
--     { enabled: boolean, notes: string } — since no marketplace-specific
--     preference fields beyond "does this brand use this marketplace" and
--     "free-form notes" are defined anywhere in the existing C10 adapter
--     architecture; C10's own rules (lib/marketplaceRules.ts) remain the
--     only source of actual marketplace requirements, this is
--     configuration/context only, per the milestone's explicit C10
--     integration boundary.
--   - updated_at: added for the same reason every other table in this
--     schema has one (catalog_products, catalog_listings, ...) — trivial,
--     standard, and lets the UI show/rely on a real last-saved timestamp.

alter table clients
  add column if not exists brand_identity text,
  add column if not exists brand_voice text,
  add column if not exists target_audience text,
  add column if not exists product_categories text[],
  add column if not exists positioning text,
  add column if not exists marketplace_preferences jsonb,
  add column if not exists updated_at timestamptz not null default now();

-- No RLS change. clients' existing SELECT/INSERT/UPDATE/DELETE policies
-- (auth.uid() = user_id, from 20260810_05_client_ownership_hardening.sql)
-- already cover every column on this table, including all of the above.
