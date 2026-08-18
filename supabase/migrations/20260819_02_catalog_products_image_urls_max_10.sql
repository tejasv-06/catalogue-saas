-- Milestone C18 (Photos Only Product Grouping + Credit Accounting): widens
-- catalog_products' image_urls cap from 5 to 10.
--
-- Why: Photos Only's new "Create Single Product" action (see
-- components/CatalogueWorkspace.tsx's startSingleProductFromStaged) can
-- combine up to MAX_IMAGE_GROUPING_BATCH (10, lib/imageGrouping.ts) staged
-- photos into ONE product's image_urls: above the 5-image ceiling
-- 20260810_15_catalog_products_multi_image.sql set for Manual Entry
-- (MAX_MANUAL_IMAGES, lib/types.ts) and CSV bulk upload (C17.2, 5 numbered
-- image columns). Without this, a seller combining 6-10 photos into one
-- Photos Only product would have that INSERT/UPDATE rejected outright by
-- the old catalog_products_image_urls_max_5 constraint.
--
-- This is a ceiling widening only: Manual Entry's and Bulk Upload's own
-- client-side caps (MAX_MANUAL_IMAGES = 5) are UNCHANGED and continue to
-- stop a seller from adding a 6th photo in those flows; nothing about their
-- behavior changes. Only Photos Only's new up-to-10 case is newly able to
-- persist without hitting this constraint.
--
-- Run this in the Supabase SQL editor (Dashboard > SQL Editor) once, same
-- manual-apply discipline as every other migration file in this folder.

alter table catalog_products
  drop constraint if exists catalog_products_image_urls_max_5;

alter table catalog_products
  add constraint catalog_products_image_urls_max_10
  check (array_length(image_urls, 1) is null or array_length(image_urls, 1) <= 10);
