-- Milestone C17.1: Manual Entry: Multi-Image Product Upload.
--
-- One additive, not-null column on catalog_products (created in
-- 20260810_02_catalog_foundation.sql), same style as
-- 20260810_06_product_intelligence.sql's own additive column. Every
-- existing row defaults to '{}' (empty array): no backfill needed, no
-- existing read/write path is broken.
--
-- image_url (the original single-image column) is UNCHANGED and remains the
-- primary/first image, still read directly by every existing consumer that
-- predates this milestone (app/api/generate-single/route.ts,
-- app/api/enrich-product/route.ts, exports, thumbnails): none of those are
-- touched by C17.1. image_urls is additive: the application keeps
-- image_url in sync as image_urls[1] (or null when empty) on every write,
-- so the two never disagree.
--
-- 5-image cap enforced here too (not just client-side) per C17.1 §13 ("do
-- not rely solely on the UI to enforce the limit"): a CHECK constraint,
-- not a trigger, since this is a simple array-length bound with no
-- cross-row logic.
--
-- No RLS policy change. catalog_products already has full owner-scoped
-- SELECT/INSERT/UPDATE/DELETE policies (auth.uid() = owner_user_id) from
-- the original foundation migration, and those policies are not
-- column-scoped: they already cover reads/writes of this new column for
-- exactly the same owner, with no cross-user access.

alter table catalog_products
  add column if not exists image_urls text[] not null default '{}';

alter table catalog_products
  drop constraint if exists catalog_products_image_urls_max_5;

alter table catalog_products
  add constraint catalog_products_image_urls_max_5 check (array_length(image_urls, 1) is null or array_length(image_urls, 1) <= 5);
