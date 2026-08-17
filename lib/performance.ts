import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/catalog'
import type { CanonicalPerformanceRecord, PerformanceMarketplace } from '@/lib/performanceAdapters'

// Milestone C15 — data-access layer, same session-aware-wrapper pattern as
// lib/catalog.ts and lib/productHistory.ts: every exported function takes
// an optional trailing `client`, defaulting to the real browser client, so
// the exact same code works from a client component or (if ever needed) a
// server route's session-bound client. No service-role client anywhere in
// this file. Ownership is enforced by the migration's own RLS policies
// (supabase/migrations/20260810_11_performance_intelligence.sql) — this
// module's job is shape validation and orchestration, never a second
// ownership check.

export type ExternalIdMappingRow = {
  id: string
  product_id: string
  owner_user_id: string
  marketplace: PerformanceMarketplace
  external_id: string
  created_at: string
}

export type MarketplacePerformanceRow = {
  id: string
  // Optional (migration 20260810_13) — a performance row is a fact about
  // the uploaded report on its own (external_product_id, Brand, Article
  // Type, and every metric already come from the file). Catalog linkage is
  // a separate, later enrichment, never a precondition for import: null
  // means "performance exists for this external id, not yet linked to a
  // catalog product," not "invalid."
  product_id: string | null
  owner_user_id: string
  // Which of the owner's brands/seller accounts this REPORT belongs to
  // (migration 20260810_14) — distinct from metadata.brand, which is the
  // per-PRODUCT "Brand" column the report itself reports (e.g. one seller
  // account's catalog can carry several product brands). This field scopes
  // which rows are ever analyzed together: two different brands' reports
  // must never blend into one catalog's statistics, even for the same
  // owner and marketplace. Nullable for rows imported before brand
  // scoping existed — a real, distinct "unspecified" scope, never merged
  // with a named brand's data.
  brand: string | null
  marketplace: PerformanceMarketplace
  external_product_id: string
  period_start: string
  period_end: string
  period_type: 'weekly' | 'monthly'
  impressions: number | null
  clicks: number | null
  add_to_carts: number | null
  purchases: number | null
  revenue: number | null
  returns: number | null
  return_rate: number | null
  rating: number | null
  consideration_rate: number | null
  conversion_rate: number | null
  ctr: number | null
  source: string
  import_batch_id: string
  metadata: Record<string, unknown> | null
  created_at: string
}

function rowToRecord(row: MarketplacePerformanceRow): CanonicalPerformanceRecord {
  return {
    marketplace: row.marketplace,
    externalProductId: row.external_product_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    periodType: row.period_type,
    impressions: row.impressions,
    clicks: row.clicks,
    addToCarts: row.add_to_carts,
    purchases: row.purchases,
    revenue: row.revenue,
    returns: row.returns,
    returnRate: row.return_rate,
    rating: row.rating,
    considerationRate: row.consideration_rate,
    conversionRate: row.conversion_rate,
    ctr: row.ctr,
    source: row.source,
    metadata: row.metadata as CanonicalPerformanceRecord['metadata']
  }
}

// --- §7 Product matching ---------------------------------------------------

// Looks up EVERY known (marketplace, external_id) -> product_id mapping
// for the current owner in one query, so a report with many rows doesn't
// issue one lookup per row. Never matches by name/brand/title/MRP (§7) —
// this is the only lookup key that exists.
export async function getExternalIdMappings(
  marketplace: PerformanceMarketplace,
  client: SupabaseClient = createClient()
): Promise<Map<string, string>> {
  await requireUserId(client)
  const { data, error } = await client
    .from('catalog_product_external_ids')
    .select('external_id, product_id')
    .eq('marketplace', marketplace)

  if (error) throw error
  return new Map((data ?? []).map((row: any) => [row.external_id, row.product_id as string]))
}

// Records a new, user-confirmed mapping — the ONLY way an external id
// becomes matchable going forward (never inferred/guessed). Ownership of
// BOTH the product and the mapping row is enforced by RLS's WITH CHECK
// (see the migration), not re-checked here.
export async function createExternalIdMapping(
  productId: string,
  marketplace: PerformanceMarketplace,
  externalId: string,
  client: SupabaseClient = createClient()
): Promise<ExternalIdMappingRow> {
  const ownerUserId = await requireUserId(client)
  const { data, error } = await client
    .from('catalog_product_external_ids')
    .upsert(
      { product_id: productId, owner_user_id: ownerUserId, marketplace, external_id: externalId },
      { onConflict: 'owner_user_id,marketplace,external_id' }
    )
    .select()
    .single()

  if (error) throw error
  return data as ExternalIdMappingRow
}

// Reverse lookup of getExternalIdMappings — this ONE product's own
// mappings across every marketplace, keyed by marketplace. Powers the
// proactive "Marketplace IDs" field on the product drawer, so a seller
// can type in a known Style ID/ASIN before any report is ever uploaded.
// Still strictly (marketplace, external_id) -> product_id — same table,
// same key, just entered by a human ahead of time instead of resolved
// during import.
export async function getProductExternalIds(
  productId: string,
  client: SupabaseClient = createClient()
): Promise<Map<PerformanceMarketplace, string>> {
  await requireUserId(client)
  const { data, error } = await client
    .from('catalog_product_external_ids')
    .select('marketplace, external_id')
    .eq('product_id', productId)

  if (error) throw error
  return new Map((data ?? []).map((row: any) => [row.marketplace as PerformanceMarketplace, row.external_id as string]))
}

// catalog_product_external_ids is a correctable mapping table (unlike
// marketplace_performance's append-only rows) — its own migration grants
// an owner delete policy specifically so a stale/incorrect mapping can be
// removed. Used by setProductExternalId below when a product's id for a
// marketplace changes.
export async function removeExternalIdMapping(
  productId: string,
  marketplace: PerformanceMarketplace,
  client: SupabaseClient = createClient()
): Promise<void> {
  await requireUserId(client)
  const { error } = await client.from('catalog_product_external_ids').delete().eq('product_id', productId).eq('marketplace', marketplace)
  if (error) throw error
}

// The proactive counterpart to createExternalIdMapping (which the import
// flow calls for a brand-new mapping discovered during Confirm Import).
// This one is for the product-side editor: a seller typing a known Style
// ID/ASIN directly onto a product ahead of any upload. If this product
// already had a DIFFERENT external_id for the marketplace, that stale
// row is removed first — a product should only ever map to one
// external_id per marketplace at a time.
export async function setProductExternalId(
  productId: string,
  marketplace: PerformanceMarketplace,
  externalId: string,
  client: SupabaseClient = createClient()
): Promise<void> {
  const trimmed = externalId.trim()
  if (!trimmed) throw new Error('performance: external id is required')

  const existing = await getProductExternalIds(productId, client)
  const current = existing.get(marketplace)
  if (current && current !== trimmed) {
    await removeExternalIdMapping(productId, marketplace, client)
  }
  await createExternalIdMapping(productId, marketplace, trimmed, client)
}

// --- Commit ------------------------------------------------------------

export type CommitImportResult = {
  importBatchId: string
  inserted: MarketplacePerformanceRow[]
}

// The one write path for performance data (§17 append-only — see the
// migration's own comment: no update/delete policy exists at all, so
// there is no "overwrite" method to accidentally call). Every row in one
// call shares one import_batch_id, which is what makes "this whole
// snapshot was imported together" a real, queryable fact (§6/§13).
//
// Final architecture correction: the uploaded report IS the source of
// truth for the row (external_product_id, Brand, Article Type, every
// metric — see lib/performanceAdapters.ts) — importing it never requires
// a product to be chosen first. product_id is looked up opportunistically
// against any mapping the seller has already created (via the product's
// own "Marketplace IDs" field, setProductExternalId) and left null
// otherwise (migration 20260810_13 made the column optional for exactly
// this). This never infers identity from Brand/Article Type/MRP/etc (§7)
// — it's still strictly the same (marketplace, external_id) lookup
// getExternalIdMappings always was, just no longer a precondition for the
// row to be importable.
//
// `brand` is derived by the caller from the report's OWN Brand column
// (lib/performanceAdapters.ts's groupRecordsByReportBrand), never typed
// by hand — every record passed in one call must already share the same
// brand (or genuinely have none). `brand: null` is a real, deliberate
// scope: a report format with no Brand column at all (Amazon's Business
// Report) has nothing to derive, so its rows are scoped "unspecified,"
// the same first-class scope getMarketplacePerformanceHistory/
// getBrandScopesForMarketplace already support — never an error and
// never a fabricated brand name.
export async function commitPerformanceImport(
  marketplace: PerformanceMarketplace,
  brand: string | null,
  records: CanonicalPerformanceRecord[],
  client: SupabaseClient = createClient()
): Promise<CommitImportResult> {
  if (records.length === 0) {
    throw new Error('performance: commitPerformanceImport called with zero rows')
  }
  const trimmedBrand = brand === null ? null : brand.trim()
  if (trimmedBrand === '') {
    throw new Error('performance: brand must not be an empty/whitespace-only string — pass null for the unspecified scope instead')
  }

  const ownerUserId = await requireUserId(client)
  const importBatchId = crypto.randomUUID()
  const mappings = await getExternalIdMappings(marketplace, client)

  const payload = records.map((record) => ({
    product_id: mappings.get(record.externalProductId) ?? null,
    owner_user_id: ownerUserId,
    brand: trimmedBrand,
    marketplace,
    external_product_id: record.externalProductId,
    period_start: record.periodStart,
    period_end: record.periodEnd,
    period_type: record.periodType,
    impressions: record.impressions,
    clicks: record.clicks,
    add_to_carts: record.addToCarts,
    purchases: record.purchases,
    revenue: record.revenue,
    returns: record.returns,
    return_rate: record.returnRate,
    rating: record.rating,
    consideration_rate: record.considerationRate,
    conversion_rate: record.conversionRate,
    ctr: record.ctr,
    source: record.source,
    import_batch_id: importBatchId,
    metadata: record.metadata
  }))

  const { data, error } = await client.from('marketplace_performance').insert(payload).select()
  if (error) throw error

  return { importBatchId, inserted: (data ?? []) as MarketplacePerformanceRow[] }
}

// --- Reads ---------------------------------------------------------------

// Product-scoped only (§17 performance requirement — never the whole
// account's history for one product view), newest period first. Optional
// marketplace filter for a single-marketplace panel.
export async function getProductPerformance(
  productId: string,
  marketplace: PerformanceMarketplace | undefined,
  client: SupabaseClient = createClient()
): Promise<CanonicalPerformanceRecord[]> {
  if (!productId) throw new Error('performance: productId is required')
  await requireUserId(client)

  let query = client
    .from('marketplace_performance')
    .select(
      'marketplace, external_product_id, period_start, period_end, period_type, impressions, clicks, add_to_carts, purchases, revenue, returns, return_rate, rating, consideration_rate, conversion_rate, ctr, source, metadata'
    )
    .eq('product_id', productId)
    .order('period_start', { ascending: false })

  if (marketplace) query = query.eq('marketplace', marketplace)

  const { data, error } = await query
  if (error) throw error
  return ((data ?? []) as MarketplacePerformanceRow[]).map(rowToRecord)
}

// A CanonicalPerformanceRecord plus the two DB-only fields the intelligence
// layer needs that the canonical model deliberately doesn't carry:
// product_id and brand. Structurally still a CanonicalPerformanceRecord
// (extra fields only), so it passes directly into diagnosePerformance/
// computeTrend (lib/performanceDiagnosis.ts) with no adapter needed.
export type PerformanceHistoryRecord = CanonicalPerformanceRecord & { productId: string | null; brand: string | null }

function rowToHistoryRecord(row: MarketplacePerformanceRow): PerformanceHistoryRecord {
  return { ...rowToRecord(row), productId: row.product_id, brand: row.brand }
}

// Account-wide, (marketplace, brand)-scoped history — EVERY row for this
// owner in this marketplace AND this brand, across every product AND
// every period, including unlinked rows (product_id null). Powers
// lib/performanceIntelligence.ts, which needs the full picture (current
// status, historical trend, product prioritization) for ONE brand's
// catalog — never blended with a different brand's reports, even for the
// same owner and marketplace (that's the whole point of brand scoping;
// see migration 20260810_14). Distinct from getProductPerformance above,
// which stays product-scoped and unchanged, still used by
// ProductPerformance.tsx.
// `brand: null` explicitly queries the "unspecified" scope (rows imported
// before brand scoping existed) — a real, distinct scope per migration
// 20260810_14's own comment, never silently merged with a named brand's
// data and never silently dropped either.
export async function getMarketplacePerformanceHistory(
  marketplace: PerformanceMarketplace,
  brand: string | null,
  client: SupabaseClient = createClient()
): Promise<PerformanceHistoryRecord[]> {
  await requireUserId(client)
  let query = client
    .from('marketplace_performance')
    .select(
      'product_id, brand, marketplace, external_product_id, period_start, period_end, period_type, impressions, clicks, add_to_carts, purchases, revenue, returns, return_rate, rating, consideration_rate, conversion_rate, ctr, source, metadata'
    )
    .eq('marketplace', marketplace)
    .order('period_start', { ascending: false })
  query = brand === null ? query.is('brand', null) : query.eq('brand', brand)

  const { data, error } = await query
  if (error) throw error
  return ((data ?? []) as MarketplacePerformanceRow[]).map(rowToHistoryRecord)
}

// Every distinct NAMED brand this owner has already uploaded a report
// for, within one marketplace — powers the upload form's brand
// autocomplete only. Rows imported before brand scoping existed (brand IS
// NULL) are deliberately excluded — there's nothing sensible to prefill
// into a free-text input for "unspecified." See getBrandScopesForMarketplace
// below for the dashboard's brand selector, which DOES need to represent
// that scope (it has to remain choosable, not just typeable).
export async function getBrandsForMarketplace(marketplace: PerformanceMarketplace, client: SupabaseClient = createClient()): Promise<string[]> {
  await requireUserId(client)
  const { data, error } = await client.from('marketplace_performance').select('brand').eq('marketplace', marketplace).not('brand', 'is', null)

  if (error) throw error
  const brands = new Set((data ?? []).map((row: any) => row.brand as string).filter((b): b is string => !!b))
  return Array.from(brands).sort((a, b) => a.localeCompare(b))
}

export type BrandScope = { brand: string | null; label: string }

// Every distinct (marketplace, brand) scope this owner has DATA for,
// including the "unspecified" (brand IS NULL) scope — powers the
// dashboard's brand selector, which must show every scope with real
// data, never silently hide legacy rows just because they predate brand
// scoping. Distinct from getBrandsForMarketplace above (upload-form-only,
// intentionally named-brand-only).
export async function getBrandScopesForMarketplace(marketplace: PerformanceMarketplace, client: SupabaseClient = createClient()): Promise<BrandScope[]> {
  await requireUserId(client)
  const { data, error } = await client.from('marketplace_performance').select('brand').eq('marketplace', marketplace)
  if (error) throw error

  const set = new Set<string | null>((data ?? []).map((row: any) => (row.brand as string | null) ?? null))
  const scopes: BrandScope[] = []
  if (set.has(null)) scopes.push({ brand: null, label: 'Unspecified brand (legacy import)' })
  const named = Array.from(set)
    .filter((b): b is string => b !== null)
    .sort((a, b) => a.localeCompare(b))
  for (const b of named) scopes.push({ brand: b, label: b })
  return scopes
}
