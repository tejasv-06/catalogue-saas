import { pick, normalizeKey } from '@/lib/csvMapping'
import { parseAccountReportRow, parseAmazonNumber, type AccountReportRow } from '@/lib/accountReportStats'

// Milestone C15 — Seller Performance Intelligence. Marketplace-adapter
// architecture, same shape as lib/marketplaceAdapters.ts's C10 pattern
// (buildAdapter -> Record<Marketplace, Adapter> -> getXAdapter lookup) —
// deliberately not reused directly, since C10's adapters cover listing
// GENERATION for all 4 SUPPORTED_MARKETPLACES, while this covers
// performance ANALYSIS for only Amazon + Myntra. Conflating the two would
// make "add Etsy performance later" require touching the generation
// adapter registry, which is exactly the coupling this file's own
// PERFORMANCE_MARKETPLACES constant avoids.
//
// AUDIT FINDING (documented here so this isn't a silent assumption): there
// is no live Amazon API/SP-API client anywhere in this codebase. The only
// existing Amazon data pathway is components/reports/AccountAuditPanel.tsx
// + lib/accountReportStats.ts — a client-side parser for an uploaded
// Amazon "Detail Page Sales and Traffic by Child Item" Business Report
// CSV, entirely ephemeral (parsed in-browser, never persisted, no
// product linkage). That IS the "existing Amazon infrastructure" this
// milestone reuses: AmazonPerformanceAdapter is a thin transform on top of
// parseAccountReportRow/parseAmazonNumber below, not a new Amazon
// integration and not a rewrite of the existing Account Audit tool (which
// this milestone does not touch at all).

export const PERFORMANCE_MARKETPLACES = ['amazon', 'myntra'] as const
export type PerformanceMarketplace = (typeof PERFORMANCE_MARKETPLACES)[number]

export const PERFORMANCE_MARKETPLACE_LABELS: Record<PerformanceMarketplace, string> = {
  amazon: 'Amazon',
  myntra: 'Myntra'
}

export function isPerformanceMarketplace(value: unknown): value is PerformanceMarketplace {
  return typeof value === 'string' && (PERFORMANCE_MARKETPLACES as readonly string[]).includes(value)
}

export type PerformancePeriodType = 'weekly' | 'monthly'

// The one marketplace-independent shape every adapter produces (§5).
// Nullable wherever a marketplace/report may not supply that metric —
// null means "not available from this source," 0 means "the source
// explicitly reported zero." Never conflate the two (§5's own explicit
// rule) — see computeCtr/computeAtcRate/computeConversionRate in
// lib/performanceMetrics.ts for the same discipline applied to derived
// metrics.
export type CanonicalPerformanceRecord = {
  marketplace: PerformanceMarketplace
  externalProductId: string
  periodStart: string
  periodEnd: string
  periodType: PerformancePeriodType
  impressions: number | null
  clicks: number | null
  addToCarts: number | null
  purchases: number | null
  revenue: number | null
  returns: number | null
  returnRate: number | null
  rating: number | null
  considerationRate: number | null
  conversionRate: number | null
  ctr: number | null
  source: string
  metadata: Record<string, string | number | boolean | null> | null
}

// Milestone C15 UI fix — describes ONE column of the marketplace's OWN
// report, in the report's own order/label, for the import preview table.
// Deliberately separate from CanonicalPerformanceRecord: the canonical
// model renames/reshapes fields (Return % -> returnRate, Style ID ->
// externalProductId, several Myntra columns folded into metadata) for
// storage/calculation purposes, but the import PREVIEW must show the
// report exactly as the seller uploaded it (spec: "Do not rename these
// columns in the raw import preview"). previewColumns is intentionally
// per-adapter (§9: "the table must be adapter-driven... do not force
// Amazon into the Myntra schema").
export type PreviewColumn = {
  key: string
  label: string
  align: 'left' | 'right'
  width: number
}

// The exact, unmodified string each row reported for every previewColumns
// entry (keyed by PreviewColumn.key) — '—' for a column the report simply
// didn't have a value for in this row. Display-only: never used for
// persistence, matching, or calculation, which all still go through
// CanonicalPerformanceRecord exactly as before this UI fix.
export type PreviewValues = Record<string, string>

export type PerformanceImportRowResult =
  | { status: 'valid'; record: CanonicalPerformanceRecord; previewValues: PreviewValues }
  | { status: 'invalid'; reason: string; raw: Record<string, string>; previewValues: PreviewValues }

export type PerformanceAdapter = {
  marketplace: PerformanceMarketplace
  label: string
  source: string
  // The report's own column structure, in the report's own order — used
  // to render the import preview table header (and each row's
  // previewValues, which follow this same key set).
  previewColumns: PreviewColumn[]
  // Parses raw report rows (already CSV-header-parsed into string/string
  // records, e.g. via Papa.parse) into canonical records — one result per
  // input row, valid or invalid, 1:1, so a caller can always reconcile
  // "how many rows did I upload" against "how many results came back."
  // period/periodType are supplied by the caller (the report file itself
  // doesn't self-describe its date range for either marketplace's report
  // shape) — never guessed from row content.
  parseRows: (
    rows: Record<string, string>[],
    period: { periodStart: string; periodEnd: string; periodType: PerformancePeriodType }
  ) => PerformanceImportRowResult[]
}

// --- Shared validation, used by both adapters (never duplicated) --------

function isValidCount(n: number | null): boolean {
  return n === null || (Number.isFinite(n) && n >= 0)
}

function isValidPercent(n: number | null): boolean {
  return n === null || (Number.isFinite(n) && n >= 0 && n <= 100)
}

// Milestone C15 UI fix — builds one row's previewValues from its raw
// report row, using the exact same pick() candidate-header list the
// adapter's own parseRows uses for that column, so the preview can never
// drift from what was actually parsed. '—' (not '') when the report truly
// had no value there, matching every other "not available" display
// convention already used elsewhere (ProductHistory.tsx, ProductPerformance.tsx).
function buildPreviewValues(raw: Record<string, string>, columns: { key: string; candidates: string[] }[]): PreviewValues {
  const values: PreviewValues = {}
  for (const { key, candidates } of columns) {
    values[key] = pick(raw, ...candidates) ?? '—'
  }
  return values
}

// --- Amazon --------------------------------------------------------------

// Reuses parseAccountReportRow (lib/accountReportStats.ts) byte-for-byte —
// the exact same Amazon Business Report parsing the existing Account Audit
// tool already runs, not a second implementation.
//
// Field mapping, and why each does/doesn't map:
//   - clicks = sessions: a "Session" only exists because a shopper reached
//     the product's detail page — the closest honest analog to a
//     click-through this report provides. Amazon's own "impressions" (ad/
//     search placement views) live in a DIFFERENT report (Search Query
//     Performance / Brand Analytics) this codebase has no access to, so
//     impressions stays null rather than being invented from sessions.
//   - purchases = unitsOrdered, revenue = orderedProductSales: direct,
//     already-named equivalents.
//   - conversionRate = unitSessionPercentage: Amazon's OWN pre-calculated
//     conversion definition (units ordered / sessions) — preserved as the
//     SOURCE value per §8, never overwritten by a locally recomputed one.
//   - addToCarts, returns, returnRate, rating, considerationRate: not
//     present in this report at all -> null, never fabricated.
//   - ctr: not computed here — a real CTR needs real impressions, which
//     this report doesn't have; computing clicks/sessions would just be
//     restating sessions as 100%, which is misleading, not a metric.
// The real Amazon "Detail Page Sales and Traffic by Child Item" Business
// Report column set, in the report's own order — same header aliases
// parseAccountReportRow (lib/accountReportStats.ts) already matches
// against, so the preview can never show a value the parser itself
// wouldn't have found.
const AMAZON_PREVIEW_COLUMNS: (PreviewColumn & { candidates: string[] })[] = [
  { key: 'asin', label: 'ASIN', align: 'left', width: 130, candidates: ['Child ASIN', 'ASIN'] },
  { key: 'title', label: 'Title', align: 'left', width: 220, candidates: ['Title', 'Product Title'] },
  { key: 'sku', label: 'SKU', align: 'left', width: 110, candidates: ['SKU'] },
  { key: 'sessions', label: 'Sessions', align: 'right', width: 100, candidates: ['Sessions - Total', 'Sessions'] },
  { key: 'pageViews', label: 'Page Views', align: 'right', width: 110, candidates: ['Page Views - Total', 'Page Views'] },
  { key: 'buyBox', label: 'Buy Box %', align: 'right', width: 100, candidates: ['Featured Offer (Buy Box) Percentage', 'Buy Box Percentage'] },
  { key: 'unitsOrdered', label: 'Units Ordered', align: 'right', width: 120, candidates: ['Units Ordered'] },
  { key: 'unitSessionPct', label: 'Unit Session %', align: 'right', width: 130, candidates: ['Unit Session Percentage'] },
  { key: 'orderedProductSales', label: 'Ordered Product Sales', align: 'right', width: 170, candidates: ['Ordered Product Sales'] },
  { key: 'avgSellingPrice', label: 'Average Selling Price', align: 'right', width: 170, candidates: ['Average Selling Price'] }
]

function parseAmazonRows(
  rows: Record<string, string>[],
  period: { periodStart: string; periodEnd: string; periodType: PerformancePeriodType }
): PerformanceImportRowResult[] {
  return rows.map((raw) => {
    const previewValues = buildPreviewValues(raw, AMAZON_PREVIEW_COLUMNS)
    const parsed = parseAccountReportRow(raw as AccountReportRow)
    if (!parsed) {
      return { status: 'invalid', reason: 'Missing ASIN (Child ASIN / ASIN column)', raw, previewValues }
    }
    if (!isValidCount(parsed.unitsOrdered) || parsed.unitsOrdered < 0) {
      return { status: 'invalid', reason: 'Units Ordered must be a non-negative number', raw, previewValues }
    }
    if (!isValidPercent(parsed.unitSessionPercentage)) {
      return { status: 'invalid', reason: 'Unit Session Percentage out of 0-100 bounds', raw, previewValues }
    }

    const metadata: CanonicalPerformanceRecord['metadata'] = {}
    if (parsed.title) metadata.title = parsed.title
    if (parsed.sku) metadata.sku = parsed.sku
    if (parsed.pageViews !== null) metadata.pageViews = parsed.pageViews
    if (parsed.buyBoxPercentage !== null) metadata.buyBoxPercentage = parsed.buyBoxPercentage
    if (parsed.averageSellingPrice !== null) metadata.averageSellingPrice = parsed.averageSellingPrice

    const record: CanonicalPerformanceRecord = {
      marketplace: 'amazon',
      externalProductId: parsed.asin,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      periodType: period.periodType,
      impressions: null,
      clicks: parsed.sessions,
      addToCarts: null,
      purchases: parsed.unitsOrdered,
      revenue: parsed.orderedProductSales,
      returns: null,
      returnRate: null,
      rating: null,
      considerationRate: null,
      conversionRate: parsed.unitSessionPercentage,
      ctr: null,
      source: 'amazon_business_report',
      metadata: Object.keys(metadata).length > 0 ? metadata : null
    }
    return { status: 'valid', record, previewValues }
  })
}

const AmazonPerformanceAdapter: PerformanceAdapter = {
  marketplace: 'amazon',
  label: 'Amazon',
  source: 'amazon_business_report',
  previewColumns: AMAZON_PREVIEW_COLUMNS.map(({ key, label, align, width }) => ({ key, label, align, width })),
  parseRows: parseAmazonRows
}

// --- Myntra ----------------------------------------------------------------

// New parser (Myntra has no existing report-parsing code in this
// codebase to reuse) for the Impress report structure documented in the
// milestone spec — column names matched via lib/csvMapping.ts's existing
// pick()/normalizeKey() (already header-punctuation/case/spacing
// tolerant, the same helper Amazon's own parser and the C8 CSV product
// importer both already use), not a second ad hoc header-matching scheme.
//
// Field mapping:
//   - impressions/clicks/addToCarts/purchases/rating: direct.
//   - returnRate/considerationRate/conversionRate: Myntra's OWN
//     pre-calculated percentages, preserved as source values (§8) —
//     Return %, Consideration %, Conversion % columns respectively.
//   - revenue: NOT present in the Impress report -> null, never
//     fabricated from Seller MRP × Purchases (MRP is list price, not
//     actual sale price/revenue — that would be a fabricated metric).
//   - ctr: not present as its own column here either; Impress reports
//     Conversion % (purchases/clicks) but not a clicks/impressions ratio
//     — left for lib/performanceMetrics.ts to calculate from the raw
//     impressions/clicks this row DOES provide (a real, disclosed
//     calculation, not a source value pretending to be one).
//   - Style ID/Seller ID/Article Type/Brand/Gender/Seller MRP/Inventory
//     Age/RPLC: not canonical fields — Style ID becomes
//     externalProductId (the matching key, §7), the rest go into
//     metadata as real, bounded, disclosed context.
// The exact Myntra Impress report column set, in the exact report order
// (spec §1) — the import preview table renders these verbatim, never
// renamed to the canonical field names below.
const MYNTRA_PREVIEW_COLUMNS: (PreviewColumn & { candidates: string[] })[] = [
  { key: 'styleId', label: 'Style ID', align: 'left', width: 110, candidates: ['Style ID', 'StyleID'] },
  { key: 'sellerId', label: 'Seller ID', align: 'left', width: 90, candidates: ['Seller ID'] },
  { key: 'articleType', label: 'Article Type', align: 'left', width: 160, candidates: ['Article Type'] },
  { key: 'brand', label: 'Brand', align: 'left', width: 110, candidates: ['Brand'] },
  { key: 'gender', label: 'Gender', align: 'left', width: 90, candidates: ['Gender'] },
  { key: 'sellerMrp', label: 'Seller MRP', align: 'right', width: 100, candidates: ['Seller MRP'] },
  { key: 'inventoryAge', label: 'Inventory Age', align: 'right', width: 110, candidates: ['Inventory Age'] },
  { key: 'rplc', label: 'RPLC', align: 'right', width: 100, candidates: ['RPLC'] },
  { key: 'impressions', label: 'Impressions', align: 'right', width: 110, candidates: ['Impressions'] },
  { key: 'clicks', label: 'Clicks', align: 'right', width: 80, candidates: ['Clicks'] },
  { key: 'addToCarts', label: 'Add to Carts', align: 'right', width: 110, candidates: ['Add to Carts', 'Add To Carts', 'ATC'] },
  { key: 'purchases', label: 'Purchases', align: 'right', width: 100, candidates: ['Purchases'] },
  { key: 'returnPct', label: 'Return %', align: 'right', width: 90, candidates: ['Return %', 'Return Percentage'] },
  { key: 'considerationPct', label: 'Consideration %', align: 'right', width: 130, candidates: ['Consideration %', 'Consideration Percentage'] },
  { key: 'conversionPct', label: 'Conversion %', align: 'right', width: 110, candidates: ['Conversion %', 'Conversion Percentage'] },
  { key: 'rating', label: 'Rating', align: 'right', width: 80, candidates: ['Rating'] }
]

function parseMyntraRows(
  rows: Record<string, string>[],
  period: { periodStart: string; periodEnd: string; periodType: PerformancePeriodType }
): PerformanceImportRowResult[] {
  return rows.map((raw) => {
    const previewValues = buildPreviewValues(raw, MYNTRA_PREVIEW_COLUMNS)
    const styleId = pick(raw, 'Style ID', 'StyleID')
    if (!styleId) {
      return { status: 'invalid', reason: 'Missing Style ID', raw, previewValues }
    }

    const impressions = parseAmazonNumber(pick(raw, 'Impressions'))
    const clicks = parseAmazonNumber(pick(raw, 'Clicks'))
    const addToCarts = parseAmazonNumber(pick(raw, 'Add to Carts', 'Add To Carts', 'ATC'))
    const purchases = parseAmazonNumber(pick(raw, 'Purchases'))
    const returnRate = parseAmazonNumber(pick(raw, 'Return %', 'Return Percentage'))
    const considerationRate = parseAmazonNumber(pick(raw, 'Consideration %', 'Consideration Percentage'))
    const conversionRate = parseAmazonNumber(pick(raw, 'Conversion %', 'Conversion Percentage'))
    const rating = parseAmazonNumber(pick(raw, 'Rating'))

    for (const [label, value] of [
      ['Impressions', impressions],
      ['Clicks', clicks],
      ['Add to Carts', addToCarts],
      ['Purchases', purchases]
    ] as const) {
      if (!isValidCount(value)) {
        return { status: 'invalid', reason: `${label} must be a non-negative number`, raw, previewValues }
      }
    }
    for (const [label, value] of [
      ['Return %', returnRate],
      ['Consideration %', considerationRate],
      ['Conversion %', conversionRate]
    ] as const) {
      if (!isValidPercent(value)) {
        return { status: 'invalid', reason: `${label} must be between 0 and 100`, raw, previewValues }
      }
    }
    if (rating !== null && (rating < 0 || rating > 5)) {
      return { status: 'invalid', reason: 'Rating must be between 0 and 5', raw, previewValues }
    }

    const metadata: CanonicalPerformanceRecord['metadata'] = {}
    const sellerId = pick(raw, 'Seller ID')
    const articleType = pick(raw, 'Article Type')
    const brand = pick(raw, 'Brand')
    const gender = pick(raw, 'Gender')
    const sellerMrp = parseAmazonNumber(pick(raw, 'Seller MRP'))
    const inventoryAge = parseAmazonNumber(pick(raw, 'Inventory Age'))
    const rplc = parseAmazonNumber(pick(raw, 'RPLC'))
    if (sellerId) metadata.sellerId = sellerId
    if (articleType) metadata.articleType = articleType
    if (brand) metadata.brand = brand
    if (gender) metadata.gender = gender
    if (sellerMrp !== null) metadata.sellerMrp = sellerMrp
    if (inventoryAge !== null) metadata.inventoryAge = inventoryAge
    if (rplc !== null) metadata.rplc = rplc

    const record: CanonicalPerformanceRecord = {
      marketplace: 'myntra',
      externalProductId: styleId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      periodType: period.periodType,
      impressions,
      clicks,
      addToCarts,
      purchases,
      revenue: null,
      returns: null,
      returnRate,
      rating,
      considerationRate,
      conversionRate,
      ctr: null,
      source: 'myntra_impress_report',
      metadata: Object.keys(metadata).length > 0 ? metadata : null
    }
    return { status: 'valid', record, previewValues }
  })
}

const MyntraPerformanceAdapter: PerformanceAdapter = {
  marketplace: 'myntra',
  label: 'Myntra',
  source: 'myntra_impress_report',
  previewColumns: MYNTRA_PREVIEW_COLUMNS.map(({ key, label, align, width }) => ({ key, label, align, width })),
  parseRows: parseMyntraRows
}

// --- Registry --------------------------------------------------------------

const PERFORMANCE_ADAPTERS: Record<PerformanceMarketplace, PerformanceAdapter> = {
  amazon: AmazonPerformanceAdapter,
  myntra: MyntraPerformanceAdapter
}

// The one adapter-selection entry point (mirrors C10's
// getMarketplaceAdapter exactly) — undefined for anything not genuinely
// supported (etsy, flipkart, shopify, ...), never a fabricated fallback.
export function getPerformanceAdapter(marketplace: string): PerformanceAdapter | undefined {
  return PERFORMANCE_ADAPTERS[marketplace as PerformanceMarketplace]
}

// Re-exported so callers building a header-matching UI (or normalizeKey-
// based diagnostics) don't need their own import of lib/csvMapping.ts.
export { normalizeKey }

// --- Brand scoping, derived from the report's own data --------------------
// Milestone C15 — brand scoping is read directly from each uploaded
// report's own Brand column, never typed by hand. Myntra's Impress report
// carries a real per-row Brand value (parsed into metadata.brand above);
// a report format with no Brand column at all (Amazon's Business Report
// has none) produces one group with brand: null — the same "unspecified"
// scope lib/performance.ts already treats as real and distinct, never an
// error or a fabricated guess.

export type BrandGroup = { brand: string | null; records: CanonicalPerformanceRecord[] }

// Groups already-VALID records by their own reported Brand value. A file
// with more than one distinct brand splits into that many groups here —
// the caller (PerformanceImportPanel) imports each as its own scoped
// dataset rather than silently blending different brands' numbers
// together, and surfaces that split to the seller before import
// completes. Sorted with the "unspecified" (null) group first, then
// named brands alphabetically — a stable, deterministic order regardless
// of row order in the source file.
export function groupRecordsByReportBrand(records: CanonicalPerformanceRecord[]): BrandGroup[] {
  const map = new Map<string | null, CanonicalPerformanceRecord[]>()
  for (const r of records) {
    const raw = r.metadata?.brand
    const brand = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null
    const list = map.get(brand) ?? []
    list.push(r)
    map.set(brand, list)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a ?? '').localeCompare(b ?? ''))
    .map(([brand, groupRecords]) => ({ brand, records: groupRecords }))
}
