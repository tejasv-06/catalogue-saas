-- Milestone C15 — final architecture correction. marketplace_performance
-- previously required product_id at insert time (not null, RLS insert
-- policy required an owned catalog_products match), which forced every
-- report row through a blocking product-selection step before it could be
-- imported at all. That's backwards: the uploaded report IS the
-- marketplace-level performance dataset on its own (Style ID/ASIN, Brand,
-- Article Type, and every metric already come from the file) — Tesolute
-- catalog linkage is a separate, OPTIONAL enrichment, not a precondition
-- for import. product_id now may be null: "performance exists for this
-- external id, not yet linked to a catalog product" is a valid, importable
-- state, not an invalid one.
--
-- Nothing existing is touched: no column dropped, no row deleted, no
-- existing (non-null) product_id relationship altered. This only widens
-- what's allowed going forward.
alter table marketplace_performance alter column product_id drop not null;

-- The insert policy's ownership check must still hold whenever product_id
-- IS provided (a seller can never attach a performance row to someone
-- else's catalog product) — it just no longer requires product_id to be
-- present at all.
drop policy if exists "marketplace_performance_owner_insert" on marketplace_performance;
create policy "marketplace_performance_owner_insert" on marketplace_performance
  for insert with check (
    auth.uid() = owner_user_id
    and (
      product_id is null
      or exists (
        select 1 from catalog_products
        where catalog_products.id = marketplace_performance.product_id
          and catalog_products.owner_user_id = auth.uid()
      )
    )
  );
-- Select/update/delete policies are unaffected by this change (select is
-- owner-scoped only; still deliberately no update/delete policy at all).
