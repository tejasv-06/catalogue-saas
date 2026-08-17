-- Milestone C15 — brand/seller scoping. A single Tesolute owner can run
-- more than one brand's marketplace presence (separate Myntra seller
-- accounts, separate storefronts) — every uploaded report must be scoped
-- to (owner_user_id, brand, marketplace, period), never just
-- (owner_user_id, marketplace, period). Without this, two different
-- brands' performance rows for the same marketplace are indistinguishable
-- once inserted, and the intelligence layer would silently blend them
-- into one "catalog" that represents neither brand correctly.
--
-- Deliberately NOT applied to catalog_product_external_ids: that table
-- maps a marketplace's external_id to this owner's OWN catalog_products,
-- which has no brand dimension at all (a Tesolute product belongs to the
-- owner, not to one of several sub-brands) — and Style ID/ASIN collisions
-- across a single owner's independent seller accounts are not a
-- realistic risk (marketplaces assign these, not sellers). Scoping that
-- table by brand as well would be a materially larger change (reworking
-- the product-linking UI) for a near-zero-probability edge case, so it's
-- deliberately left as-is: marketplace + external_id, same as before.
--
-- Nullable, not required: existing rows (imported before brand scoping
-- existed) keep working — a NULL brand is its own valid, distinct scope
-- ("unspecified"), never silently merged with a real brand's data. New
-- uploads derive brand automatically from the report's own Brand column
-- (lib/performanceAdapters.ts's groupRecordsByReportBrand) rather than a
-- manual field — a report format with no Brand column at all (e.g.
-- Amazon's Business Report) legitimately writes NULL here too, same
-- disclosed "unspecified" scope, never a fabricated brand name.
alter table marketplace_performance add column if not exists brand text;

create index if not exists marketplace_performance_owner_marketplace_brand_idx
  on marketplace_performance(owner_user_id, marketplace, brand);
