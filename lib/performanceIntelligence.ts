import type { CanonicalPerformanceRecord, PerformanceMarketplace, PerformancePeriodType } from '@/lib/performanceAdapters'
import { computeCtr, computeAtcRate, computeConversionRate } from '@/lib/performanceMetrics'
import { computeTrend, computeChange, PERFORMANCE_THRESHOLDS, type TrendResult } from '@/lib/performanceDiagnosis'
import type { PerformanceHistoryRecord } from '@/lib/performance'
import { getAreaRecommendation } from '@/lib/performanceRecommendations'

// Milestone C15: Seller Performance Intelligence & Action Engine. Pure,
// deterministic functions only (§20: "the underlying diagnosis must be
// deterministic and data-grounded": no generative AI here, and no fixed
// absolute threshold either: "good CTR" varies by category/business
// size, so every weak/strong judgment below is computed relative to THAT
// SPECIFIC UPLOAD's own catalog median, never a hardcoded percentage).
//
// This file intentionally does NOT reuse lib/performanceDiagnosis.ts's
// diagnosePerformance/PERFORMANCE_THRESHOLDS for CTR/ATC/conversion/
// return-rate weak-vs-strong judgments: those are fixed, absolute
// percentages by original design, correct for the separate per-product
// panel (components/ProductPerformance.tsx, untouched by this file) but
// wrong for a seller-facing intelligence report that must generalize
// across any brand, category, or catalog size with zero tuning. The
// relative engine below (computeCatalogMedians/diagnoseRelative) is this
// file's own, computed fresh from each upload's own data. computeTrend
// (period-over-period significance, a different question: "is this
// change big enough to matter," not "is this value good") is still
// reused as-is; that one was never category-dependent.
//
// §19 discipline carries through every string this file produces:
// recommendations name what to INVESTIGATE, never a proven cause.

// --- Period grouping ---------------------------------------------------

export type PeriodGroup = {
  periodStart: string
  periodEnd: string
  periodType: PerformancePeriodType
  records: PerformanceHistoryRecord[]
}

// Groups every row (every product, linked or not) into the distinct
// uploaded periods they belong to, newest period first. Multiple rows can
// share one period: one weekly report typically covers many products.
export function groupByPeriod(records: PerformanceHistoryRecord[]): PeriodGroup[] {
  const map = new Map<string, PeriodGroup>()
  for (const r of records) {
    const key = `${r.periodStart}_${r.periodEnd}`
    let group = map.get(key)
    if (!group) {
      group = { periodStart: r.periodStart, periodEnd: r.periodEnd, periodType: r.periodType, records: [] }
      map.set(key, group)
    }
    group.records.push(r)
  }
  return Array.from(map.values()).sort((a, b) => (a.periodStart < b.periodStart ? 1 : a.periodStart > b.periodStart ? -1 : -0))
}

// --- Account-wide aggregate snapshot (one period, every product) -------

export type AggregateSnapshot = {
  periodStart: string
  periodEnd: string
  periodType: PerformancePeriodType
  productsAnalyzed: number
  impressions: number | null
  clicks: number | null
  addToCarts: number | null
  purchases: number | null
  returnRate: number | null
  rating: number | null
  considerationRate: number | null
  ctr: number | null
  atcRate: number | null
  conversionRate: number | null
  productsWithSales: number
  productsWithNoSales: number
}

function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null)
  if (present.length === 0) return null
  return present.reduce((a, b) => a + b, 0)
}

function averageOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null)
  if (present.length === 0) return null
  return present.reduce((a, b) => a + b, 0) / present.length
}

// Combines every product's row within one period into a single
// account-wide snapshot. Counts (impressions/clicks/ATC/purchases) sum
// directly. CTR/ATC-rate/conversion-rate are recomputed from those SUMMED
// counts (via the existing computeCtr/computeAtcRate/computeConversionRate
//: never re-derived) rather than averaging each product's own
// percentage, which would silently over-weight low-traffic products.
// returnRate/rating have no raw counts to sum in this report (Myntra
// reports them as pre-computed percentages/scores per product, never a
// raw returns count): a straight average across products with a
// reported value is the only non-fabricated way to represent them here,
// and is disclosed as such rather than hidden behind false precision.
export function aggregatePeriod(group: PeriodGroup): AggregateSnapshot {
  const byProduct = new Map<string, PerformanceHistoryRecord[]>()
  for (const r of group.records) {
    const list = byProduct.get(r.externalProductId) ?? []
    list.push(r)
    byProduct.set(r.externalProductId, list)
  }
  let productsWithSales = 0
  for (const rows of byProduct.values()) {
    if (rows.some((r) => (r.purchases ?? 0) > 0)) productsWithSales++
  }

  const impressions = sumOrNull(group.records.map((r) => r.impressions))
  const clicks = sumOrNull(group.records.map((r) => r.clicks))
  const addToCarts = sumOrNull(group.records.map((r) => r.addToCarts))
  const purchases = sumOrNull(group.records.map((r) => r.purchases))

  return {
    periodStart: group.periodStart,
    periodEnd: group.periodEnd,
    periodType: group.periodType,
    productsAnalyzed: byProduct.size,
    impressions,
    clicks,
    addToCarts,
    purchases,
    returnRate: averageOrNull(group.records.map((r) => r.returnRate)),
    rating: averageOrNull(group.records.map((r) => r.rating)),
    considerationRate: averageOrNull(group.records.map((r) => r.considerationRate)),
    ctr: computeCtr(clicks, impressions),
    atcRate: computeAtcRate(addToCarts, clicks),
    conversionRate: computeConversionRate(purchases, clicks),
    productsWithSales,
    productsWithNoSales: byProduct.size - productsWithSales
  }
}

// Turns an AggregateSnapshot into the same CanonicalPerformanceRecord
// shape diagnosePerformance/computeTrend already understand: no second
// diagnosis engine. externalProductId/source are placeholders (an
// aggregate isn't one product), never read by either function.
function aggregateToRecord(snapshot: AggregateSnapshot, marketplace: PerformanceMarketplace): CanonicalPerformanceRecord {
  return {
    marketplace,
    externalProductId: '__account_aggregate__',
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    periodType: snapshot.periodType,
    impressions: snapshot.impressions,
    clicks: snapshot.clicks,
    addToCarts: snapshot.addToCarts,
    purchases: snapshot.purchases,
    revenue: null,
    returns: null,
    returnRate: snapshot.returnRate,
    rating: snapshot.rating,
    considerationRate: snapshot.considerationRate,
    conversionRate: snapshot.conversionRate,
    ctr: snapshot.ctr,
    source: 'aggregate',
    metadata: null
  }
}

export function compareAggregates(
  current: AggregateSnapshot,
  previous: AggregateSnapshot | null,
  marketplace: PerformanceMarketplace
): TrendResult | null {
  if (!previous) return null
  return computeTrend(aggregateToRecord(current, marketplace), aggregateToRecord(previous, marketplace))
}

// --- Multi-period metric trend (3+ periods) -----------------------------

export type MetricTrendDirection = 'improving' | 'declining' | 'stable' | 'insufficient-data'

// Compares the NEWEST value in the series against the OLDEST available
// one, using the same TREND_SIGNIFICANT_CHANGE_PERCENT threshold every
// other trend judgment in this codebase already uses (§10): a smaller
// move is noise, not a real signal, regardless of how many periods it
// spans. `series` is newest-first (same order groupByPeriod produces).
export function classifyMetricTrend(series: (number | null)[], higherIsBetter = true): MetricTrendDirection {
  const present = series.filter((v): v is number => v !== null)
  if (present.length < 2) return 'insufficient-data'
  const newest = present[0]
  const oldest = present[present.length - 1]
  const change = computeChange(newest, oldest)
  if (change.changePercent === null) return 'insufficient-data'
  const t = PERFORMANCE_THRESHOLDS.TREND_SIGNIFICANT_CHANGE_PERCENT
  if (Math.abs(change.changePercent) < t) return 'stable'
  const movedUp = change.changePercent > 0
  const isImprovement = higherIsBetter ? movedUp : !movedUp
  return isImprovement ? 'improving' : 'declining'
}

// --- Problem persistence across periods ---------------------------------

export type ProblemPersistence = 'persistent' | 'new' | 'recovered' | 'isolated' | 'none'

// areaDiagnosesByPeriod is newest-first, one RelativeDiagnosis[] per
// period: the already-rolled-up account-wide summary for that period
// (see summarizeAreaDiagnoses below), never raw per-product diagnoses.
// Classifies whether `area` is a persistent, new, recovered, or isolated
// problem across however many periods are actually available: never
// assumes a fixed history length (§2/§5).
export function classifyProblemPersistence(area: Exclude<ProblemArea, null>, areaDiagnosesByPeriod: RelativeDiagnosis[][]): ProblemPersistence {
  if (areaDiagnosesByPeriod.length === 0) return 'none'
  const presentByPeriod = areaDiagnosesByPeriod.map((diagnoses) => diagnoses.some((d) => d.area === area))
  const currentlyPresent = presentByPeriod[0]
  const priorPeriods = presentByPeriod.slice(1)

  if (!currentlyPresent) {
    // Was it present last period specifically? That's a recovery signal,
    // not just "not currently a problem."
    if (priorPeriods.length > 0 && priorPeriods[0]) return 'recovered'
    return 'none'
  }
  if (priorPeriods.length === 0) return 'isolated' // only one period exists at all
  if (priorPeriods.every(Boolean)) return 'persistent'
  if (priorPeriods.every((p) => !p)) return 'new'
  return 'persistent' // present now and at least once before: still an ongoing, unresolved issue
}

// --- Catalog-relative statistics ------------------------------------------
// §6/§12 of the seller intelligence spec: opportunity sizing must scale
// with the catalog's own size/distribution, not one universal hardcoded
// number ("100 impressions") applied identically to a 5-product catalog
// and a 50,000-product one. meaningfulXFloor is the larger of (a) this
// catalog's own median for that metric and (b) the existing absolute
// reliability floor diagnosePerformance already requires
// (PERFORMANCE_THRESHOLDS): so a huge catalog's floor rises with its own
// median, while a tiny/sparse catalog never drops below the same noise
// floor the rest of the diagnosis engine already trusts (avoids
// misleading conclusions for tiny datasets, per spec).

export type CatalogStats = {
  productCount: number
  medianImpressions: number
  medianClicks: number
  medianAddToCarts: number
  meaningfulImpressionsFloor: number
  meaningfulClicksFloor: number
  // The "big fish" bar for opportunity SIZING (distinct from the
  // reliability floor above, which only asks "is there enough data to
  // trust a diagnosis at all"). Top-quartile-or-better within this
  // catalog's own distribution, never below the absolute reliability
  // floor. Deliberately membership-based (>= p75), not "N times the
  // median": a multiplier-of-median bar is mathematically uncrossable in
  // a 1-2 product catalog (median IS the value, so 2x it always exceeds
  // it): percentile membership degrades gracefully instead, since a
  // catalog's own top product(s) always sit at or above its own p75.
  highOpportunityImpressions: number
  highOpportunityClicks: number
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * (sortedAsc.length - 1))))
  return sortedAsc[idx]
}

// `currentRecords` should be ONE record per product (each product's most
// recent period): the same population buildProductInsights derives
// internally and passes here.
export function computeCatalogStats(currentRecords: PerformanceHistoryRecord[]): CatalogStats {
  const impressions = currentRecords.map((r) => r.impressions ?? 0).sort((a, b) => a - b)
  const clicks = currentRecords.map((r) => r.clicks ?? 0).sort((a, b) => a - b)
  const addToCarts = currentRecords.map((r) => r.addToCarts ?? 0).sort((a, b) => a - b)
  const medianImpressions = percentile(impressions, 0.5)
  const medianClicks = percentile(clicks, 0.5)
  const meaningfulImpressionsFloor = Math.max(medianImpressions, PERFORMANCE_THRESHOLDS.MIN_IMPRESSIONS_FOR_CTR_JUDGMENT)
  const meaningfulClicksFloor = Math.max(medianClicks, PERFORMANCE_THRESHOLDS.MIN_CLICKS_FOR_RATE_JUDGMENT)

  return {
    productCount: currentRecords.length,
    medianImpressions,
    medianClicks,
    medianAddToCarts: percentile(addToCarts, 0.5),
    meaningfulImpressionsFloor,
    meaningfulClicksFloor,
    highOpportunityImpressions: Math.max(percentile(impressions, 0.75), meaningfulImpressionsFloor),
    highOpportunityClicks: Math.max(percentile(clicks, 0.75), meaningfulClicksFloor)
  }
}

// --- Catalog-relative medians (CTR/conversion/ATC/returns/rating/inventory) -
// The core of the relative diagnosis engine below: "good CTR" for THIS
// catalog, computed fresh from this specific upload, never a fixed
// percentage. Medians are computed only from products with enough volume
// to trust their own rate (the same reliability floor computeCatalogStats
// already establishes): a median polluted by near-zero-traffic noise
// would defeat the entire point of being "relative."

export type CatalogMedians = {
  medianCtr: number | null
  medianConversionRate: number | null
  medianAtcRate: number | null
  medianReturnRate: number | null
  medianRating: number | null
  medianInventoryAge: number | null
}

function medianOrNull(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function metadataNumber(record: PerformanceHistoryRecord, key: string): number | null {
  const raw = record.metadata?.[key]
  return typeof raw === 'number' ? raw : null
}

export function computeCatalogMedians(currentRecords: PerformanceHistoryRecord[], catalogStats: CatalogStats): CatalogMedians {
  const reliableForCtr = currentRecords.filter((r) => (r.impressions ?? 0) >= catalogStats.meaningfulImpressionsFloor)
  const reliableForRates = currentRecords.filter((r) => (r.clicks ?? 0) >= catalogStats.meaningfulClicksFloor)

  const ctrs = reliableForCtr.map((r) => computeCtr(r.clicks, r.impressions)).filter((v): v is number => v !== null)
  const conversionRates = reliableForRates.map((r) => computeConversionRate(r.purchases, r.clicks)).filter((v): v is number => v !== null)
  const atcRates = reliableForRates.map((r) => computeAtcRate(r.addToCarts, r.clicks)).filter((v): v is number => v !== null)
  const returnRates = currentRecords.map((r) => r.returnRate).filter((v): v is number => v !== null)
  const ratings = currentRecords.map((r) => r.rating).filter((v): v is number => v !== null && v > 0)
  const inventoryAges = currentRecords.map((r) => metadataNumber(r, 'inventoryAge')).filter((v): v is number => v !== null)

  return {
    medianCtr: medianOrNull(ctrs),
    medianConversionRate: medianOrNull(conversionRates),
    medianAtcRate: medianOrNull(atcRates),
    medianReturnRate: medianOrNull(returnRates),
    medianRating: medianOrNull(ratings),
    medianInventoryAge: medianOrNull(inventoryAges)
  }
}

// --- Problem area classification (now includes stock-recovery) -----------
// The business-language "area" a seller would actually investigate. No
// DiagnosisCode indirection anymore: RelativeDiagnosis carries its area
// directly (see below).
export type ProblemArea = 'purchase-conversion' | 'product-page-engagement' | 'click-through' | 'returns' | 'rating' | 'stock-recovery' | null

// --- Relative diagnosis engine ---------------------------------------------
// Every judgment below is computed against catalogMedians (THIS upload's
// own catalog), never a fixed percentage. Fix-order sequencing is encoded
// directly in `priority`: visibility (click-through) outranks
// product-page-engagement, which outranks purchase-conversion: a
// conversion fix is wasted on a product nobody's clicking, and an
// engagement fix is wasted on a product nobody's reaching. Returns/rating/
// stock-recovery are quality-risk flags, not funnel-sequenced against the
// above, but still ranked below unresolved funnel problems.
export type RelativeDiagnosis = {
  area: Exclude<ProblemArea, null>
  priority: number
  message: string
  leadSuspects: string[]
}

// "Near-zero relative to median": bottom quarter of this catalog's own
// median CTR: a disclosed fraction, not an absolute percentage-point gap
// (a 0.3% CTR is a crisis in a catalog whose median is 3%, and completely
// unremarkable in one whose median is 0.4%).
const CTR_NEAR_ZERO_FRACTION = 0.25
// "Elevated relative to catalog average": 50%+ above this catalog's own
// average return rate: a disclosed multiple, not a fixed 10%/15%/etc.
const RETURN_RATE_ELEVATED_MULTIPLE = 1.5
// A recently-relisted item (bottom quarter of this catalog's own median
// inventory age) still showing low visibility may not have recovered its
// search ranking yet: a possibility to investigate, never a proven cause.
const RECENT_LISTING_FRACTION = 0.25

const AREA_FIX_ORDER_PRIORITY: Record<Exclude<ProblemArea, null>, number> = {
  'click-through': 4,
  'product-page-engagement': 3,
  'purchase-conversion': 2,
  returns: 2,
  rating: 1,
  'stock-recovery': 1
}

export function diagnoseRelative(record: PerformanceHistoryRecord, catalogStats: CatalogStats, medians: CatalogMedians): RelativeDiagnosis[] {
  const diagnoses: RelativeDiagnosis[] = []
  // Reliability gate for judging THIS record's own rate: the absolute
  // floor only (never catalogStats.meaningfulXFloor, which is inflated by
  // the catalog's own median and exists for a different purpose: which
  // products are trustworthy enough to feed INTO that median, and the
  // "big fish" opportunity-sizing bar below). Gating an individual
  // record's diagnosis on the median-inflated floor would make roughly
  // half of any catalog (everything below its own median) permanently
  // undiagnosable regardless of how much real traffic it has.
  const hasEnoughImpressions = (record.impressions ?? 0) >= PERFORMANCE_THRESHOLDS.MIN_IMPRESSIONS_FOR_CTR_JUDGMENT
  const hasEnoughClicks = (record.clicks ?? 0) >= PERFORMANCE_THRESHOLDS.MIN_CLICKS_FOR_RATE_JUDGMENT

  const ctr = computeCtr(record.clicks, record.impressions)
  const ctrBelowMedian = hasEnoughImpressions && ctr !== null && medians.medianCtr !== null && medians.medianCtr > 0 && ctr <= medians.medianCtr * CTR_NEAR_ZERO_FRACTION

  if (ctrBelowMedian) {
    diagnoses.push({
      area: 'click-through',
      priority: AREA_FIX_ORDER_PRIORITY['click-through'],
      message: `CTR (${ctr!.toFixed(2)}%) is far below this catalog's own median (${medians.medianCtr!.toFixed(2)}%).`,
      leadSuspects: ['Main image', 'Title']
    })
  }

  const atcRate = computeAtcRate(record.addToCarts, record.clicks)
  if (hasEnoughClicks && atcRate !== null && medians.medianAtcRate !== null && atcRate < medians.medianAtcRate) {
    diagnoses.push({
      area: 'product-page-engagement',
      priority: AREA_FIX_ORDER_PRIORITY['product-page-engagement'],
      message: `Add-to-cart rate (${atcRate.toFixed(2)}%) is below this catalog's own median (${medians.medianAtcRate.toFixed(2)}%).`,
      leadSuspects: ['Images', 'Product information', 'Specifications']
    })
  }

  // "If CTR is healthy but conversion is weak, lead with description/
  // secondary images/pricing": the lead suspect changes based on whether
  // CTR is ALSO a problem; the conversion diagnosis itself fires either way.
  const conversionRate = computeConversionRate(record.purchases, record.clicks)
  if (hasEnoughClicks && conversionRate !== null && medians.medianConversionRate !== null && conversionRate < medians.medianConversionRate) {
    diagnoses.push({
      area: 'purchase-conversion',
      priority: AREA_FIX_ORDER_PRIORITY['purchase-conversion'],
      message: `Conversion rate (${conversionRate.toFixed(2)}%) is below this catalog's own median (${medians.medianConversionRate.toFixed(2)}%).`,
      leadSuspects: ctrBelowMedian ? ['Main image', 'Title'] : ['Description', 'Secondary images', 'Pricing']
    })
  }

  if (record.returnRate !== null && medians.medianReturnRate !== null && medians.medianReturnRate > 0 && record.returnRate > medians.medianReturnRate * RETURN_RATE_ELEVATED_MULTIPLE) {
    diagnoses.push({
      area: 'returns',
      priority: AREA_FIX_ORDER_PRIORITY.returns,
      message: `Return rate (${record.returnRate.toFixed(2)}%) is elevated relative to this catalog's own average (${medians.medianReturnRate.toFixed(2)}%).`,
      leadSuspects: ['Color/sizing accuracy', 'Product images', 'Specifications']
    })
  }

  if (record.rating !== null && record.rating > 0 && medians.medianRating !== null && record.rating < medians.medianRating) {
    diagnoses.push({
      area: 'rating',
      priority: AREA_FIX_ORDER_PRIORITY.rating,
      message: `Rating (${record.rating.toFixed(1)}) is below this catalog's own median (${medians.medianRating.toFixed(1)}).`,
      leadSuspects: ['Recent reviews', 'Product-quality consistency']
    })
  }

  const inventoryAge = metadataNumber(record, 'inventoryAge')
  if (
    inventoryAge !== null &&
    medians.medianInventoryAge !== null &&
    medians.medianInventoryAge > 0 &&
    inventoryAge <= medians.medianInventoryAge * RECENT_LISTING_FRACTION &&
    !hasEnoughImpressions
  ) {
    diagnoses.push({
      area: 'stock-recovery',
      priority: AREA_FIX_ORDER_PRIORITY['stock-recovery'],
      message: `Inventory age (${inventoryAge} days) is well below this catalog's own median (${medians.medianInventoryAge.toFixed(0)} days), and visibility is currently low.`,
      leadSuspects: ['Recent stock-out: ranking may not have recovered yet']
    })
  }

  return diagnoses.sort((a, b) => b.priority - a.priority)
}

// --- P1/P2/P3 bucketing (§ intelligence spec, exact definitions) -----------
// P1: clicks/carts exist, zero purchases.
// P2: meaningful impressions, near-zero CTR relative to this catalog's
//     own median.
// P3: purchases exist, low relative traffic (a converting product that's
//     currently under-exposed).
export type IntelligenceBucket = 'P1' | 'P2' | 'P3' | null

export function classifyIntelligenceBucket(record: PerformanceHistoryRecord, catalogStats: CatalogStats, medians: CatalogMedians): IntelligenceBucket {
  const hasActivity = (record.clicks ?? 0) > 0 || (record.addToCarts ?? 0) > 0
  const zeroPurchases = (record.purchases ?? 0) === 0
  if (hasActivity && zeroPurchases) return 'P1'

  // Absolute floor, same reasoning as diagnoseRelative above: not
  // catalogStats.meaningfulImpressionsFloor, which would exclude anything
  // below the catalog's own median impressions from ever qualifying.
  const hasEnoughImpressions = (record.impressions ?? 0) >= PERFORMANCE_THRESHOLDS.MIN_IMPRESSIONS_FOR_CTR_JUDGMENT
  const ctr = computeCtr(record.clicks, record.impressions)
  if (hasEnoughImpressions && ctr !== null && medians.medianCtr !== null && medians.medianCtr > 0 && ctr <= medians.medianCtr * CTR_NEAR_ZERO_FRACTION) {
    return 'P2'
  }

  const hasPurchases = (record.purchases ?? 0) > 0
  if (hasPurchases && (record.impressions ?? 0) < catalogStats.medianImpressions) return 'P3'

  return null
}

// --- Per-product insights & prioritization ------------------------------

export type ProductPriority = 'fix-now' | 'optimize' | 'scale' | 'low-priority'

export type ProductInsight = {
  externalProductId: string
  productId: string | null
  current: PerformanceHistoryRecord
  previous: PerformanceHistoryRecord | null
  periodsAvailable: number
  diagnoses: RelativeDiagnosis[]
  trend: TrendResult | null
  priority: ProductPriority
  topProblem: RelativeDiagnosis | null
  bucket: IntelligenceBucket
  evidence: string
  recommendedAction: string | null
}

function formatEvidence(r: PerformanceHistoryRecord): string {
  const parts: string[] = []
  if (r.impressions !== null) parts.push(`${r.impressions} impressions`)
  if (r.clicks !== null) parts.push(`${r.clicks} clicks`)
  if (r.addToCarts !== null) parts.push(`${r.addToCarts} add-to-carts`)
  if (r.purchases !== null) parts.push(`${r.purchases} purchases`)
  return parts.length > 0 ? parts.join(', ') + ' this period.' : 'No metrics reported this period.'
}

// Groups a marketplace's full history by external id (Style ID/ASIN:
// the one durable identity a product's rows share across periods,
// present whether or not product_id is linked), builds one insight per
// product, and assigns a priority. Never groups/matches by
// brand/title/MRP (§7/§22): externalProductId is the only key.
export function buildProductInsights(history: PerformanceHistoryRecord[]): ProductInsight[] {
  const byExternalId = new Map<string, PerformanceHistoryRecord[]>()
  for (const r of history) {
    const list = byExternalId.get(r.externalProductId) ?? []
    list.push(r)
    byExternalId.set(r.externalProductId, list)
  }

  // Two passes: first resolve every product's own current/previous
  // record (needed regardless of catalog size), then compute this
  // catalog's own statistics from that "current" population before
  // assigning any priority: opportunity sizing below is relative to
  // THIS catalog, not a universal constant (§6/§12).
  const perProduct = Array.from(byExternalId.entries()).map(([externalId, records]) => {
    const sorted = [...records].sort((a, b) => (a.periodStart < b.periodStart ? 1 : a.periodStart > b.periodStart ? -1 : 0))
    return { externalId, sorted }
  })
  const catalogStats = computeCatalogStats(perProduct.map((p) => p.sorted[0]))
  const catalogMedians = computeCatalogMedians(perProduct.map((p) => p.sorted[0]), catalogStats)

  const insights: ProductInsight[] = []
  for (const { externalId, sorted } of perProduct) {
    const current = sorted[0]
    const previous = sorted[1] ?? null
    const diagnoses = diagnoseRelative(current, catalogStats, catalogMedians)
    const trend = computeTrend(current, previous)
    const bucket = classifyIntelligenceBucket(current, catalogStats, catalogMedians)

    const hasWeak = diagnoses.length > 0
    // Deliberately narrower than "no diagnosed problem": a real winner
    // needs actual purchase evidence and enough clicks to trust the
    // conversion/engagement rates weren't diagnosed simply for lack of
    // data (§10: "gets clicks, generates ATCs, converts").
    const hasEnoughClicksForJudgment = (current.clicks ?? 0) >= catalogStats.meaningfulClicksFloor
    const hasConversionOrEngagementProblem = diagnoses.some((d) => d.area === 'purchase-conversion' || d.area === 'product-page-engagement')
    const hasHealthyConversionSignal = hasEnoughClicksForJudgment && !hasConversionOrEngagementProblem
    const hasRealPurchases = (current.purchases ?? 0) > 0
    const isDeclining = trend?.diagnosis?.code === 'PERFORMANCE_DECLINING'

    // "Fix now" vs "optimize" both have a real, catalog-relative problem
    // (diagnoseRelative already required enough impressions/clicks before
    // flagging anything). The split is opportunity size, relative to THIS
    // catalog's own distribution (catalogStats.meaningfulXFloor: see
    // computeCatalogStats above), not a flat multiple of one universal
    // constant: top-quartile membership within THIS catalog
    // (catalogStats.highOpportunityX, see computeCatalogStats above).
    const highOpportunity =
      (current.impressions ?? 0) >= catalogStats.highOpportunityImpressions ||
      (current.clicks ?? 0) >= catalogStats.highOpportunityClicks ||
      diagnoses.length >= 2

    let priority: ProductPriority
    if (hasWeak) priority = highOpportunity ? 'fix-now' : 'optimize'
    else if (hasHealthyConversionSignal && hasRealPurchases && !isDeclining) priority = 'scale'
    else priority = 'low-priority'

    const topProblem = diagnoses[0] ?? null
    const recommendedAction = topProblem ? getAreaRecommendation(topProblem.area) : null

    insights.push({
      externalProductId: externalId,
      productId: current.productId,
      current,
      previous,
      periodsAvailable: sorted.length,
      diagnoses,
      trend,
      priority,
      topProblem,
      bucket,
      evidence: formatEvidence(current),
      recommendedAction
    })
  }

  return insights
}

// --- Account-wide diagnosis rollup -----------------------------------------
// Replaces the old fixed-threshold diagnoseAggregate(aggregateToRecord(...))
// path: an account-wide "what's the biggest problem right now" signal, and
// the per-period input classifyProblemPersistence needs, now has to come
// from the SAME relative, per-product diagnoses everything else in this
// file already computes: never a separate blended-aggregate judgment
// (blending metrics away is exactly what defeats a catalog-relative median
// in the first place).
export type AreaDiagnosisSummary = RelativeDiagnosis & { affectedProductCount: number }

export function summarizeAreaDiagnoses(perProductDiagnoses: RelativeDiagnosis[][]): AreaDiagnosisSummary[] {
  const byArea = new Map<Exclude<ProblemArea, null>, { diagnosis: RelativeDiagnosis; count: number }>()
  for (const diagnoses of perProductDiagnoses) {
    for (const d of diagnoses) {
      const existing = byArea.get(d.area)
      if (existing) existing.count += 1
      else byArea.set(d.area, { diagnosis: d, count: 1 })
    }
  }
  return Array.from(byArea.values())
    .map(({ diagnosis, count }) => ({ ...diagnosis, affectedProductCount: count }))
    .sort((a, b) => b.priority - a.priority || b.affectedProductCount - a.affectedProductCount)
}

// One period's worth of records -> its own account-wide diagnosis rollup.
// Computes catalog stats/medians from THAT period alone (never mixed with
// another period's distribution): the per-period input
// classifyProblemPersistence compares across periods.
export function diagnosePeriodRelative(periodRecords: PerformanceHistoryRecord[]): AreaDiagnosisSummary[] {
  const catalogStats = computeCatalogStats(periodRecords)
  const medians = computeCatalogMedians(periodRecords, catalogStats)
  const perProductDiagnoses = periodRecords.map((r) => diagnoseRelative(r, catalogStats, medians))
  return summarizeAreaDiagnoses(perProductDiagnoses)
}

// Ranks a priority bucket by opportunity size (impressions: the same
// volume proxy already used above) and caps it. The seller-facing action
// report explicitly must NOT list every product (§7: "top 3-5", §8: "Limit
// to top 5" / "top 5-10"): this is the one shared place that ranking
// happens, so the UI and the downloadable report can never disagree about
// which products are "the top ones."
export function topOpportunityProducts(insights: ProductInsight[], priority: ProductPriority, limit: number): ProductInsight[] {
  return insights
    .filter((p) => p.priority === priority)
    .sort((a, b) => (b.current.impressions ?? 0) - (a.current.impressions ?? 0))
    .slice(0, limit)
}

// All insights, ranked by opportunity across every bucket: backs the
// "View all affected products" detail table (paginated client-side, never
// truly rendering thousands of DOM rows at once; §12's large-catalog
// requirement is about the render surface, not withholding the data).
export function allProductsRanked(insights: ProductInsight[]): ProductInsight[] {
  const order: Record<ProductPriority, number> = { 'fix-now': 0, optimize: 1, scale: 2, 'low-priority': 3 }
  return [...insights].sort((a, b) => order[a.priority] - order[b.priority] || (b.current.impressions ?? 0) - (a.current.impressions ?? 0))
}

// --- Catalog Opportunity Map (large-catalog summary, §G) -------------------
// For a 10,000-product catalog, the main report must never list every
// product (§12): this cohorts every product into exactly the 5 groups
// the spec names, so the report can show one small summary table instead.

export type CohortName = 'purchase-opportunity' | 'engagement-opportunity' | 'visibility-opportunity' | 'positive-signals' | 'insufficient-activity'

export function classifyCohort(insight: ProductInsight): CohortName {
  if (insight.priority === 'scale') return 'positive-signals'
  if (insight.priority === 'low-priority') return 'insufficient-activity'
  const area = insight.topProblem?.area ?? null
  if (area === 'product-page-engagement') return 'engagement-opportunity'
  // A stock-recovery flag is fundamentally a visibility problem (low
  // impressions/clicks post-restock): folds into the same cohort as
  // click-through rather than inventing a 6th bucket the spec doesn't name.
  if (area === 'click-through' || area === 'stock-recovery') return 'visibility-opportunity'
  // 'purchase-conversion', 'returns', and 'rating' problems are all,
  // fundamentally, reasons a sale isn't happening or being trusted: the
  // spec names exactly 5 cohorts, so returns/rating-only problems fold
  // into "Purchase Opportunity" rather than inventing a 6th bucket.
  return 'purchase-opportunity'
}

export type CohortSummary = { cohort: CohortName; label: string; count: number; description: string }

const COHORT_META: Record<CohortName, { label: string; description: string }> = {
  'purchase-opportunity': { label: 'Purchase Opportunity', description: 'Cart or engagement activity without sufficient purchases' },
  'engagement-opportunity': { label: 'Engagement Opportunity', description: 'Click activity without sufficient cart activity' },
  'visibility-opportunity': { label: 'Visibility Opportunity', description: 'Significant visibility without corresponding clicks' },
  'positive-signals': { label: 'Positive Signals', description: 'Products showing useful purchase/engagement signals' },
  'insufficient-activity': { label: 'Insufficient Activity', description: 'Not enough evidence to prioritize' }
}

export function buildCatalogOpportunityMap(insights: ProductInsight[]): CohortSummary[] {
  const counts = new Map<CohortName, number>()
  for (const insight of insights) {
    const cohort = classifyCohort(insight)
    counts.set(cohort, (counts.get(cohort) ?? 0) + 1)
  }
  const order: CohortName[] = ['purchase-opportunity', 'engagement-opportunity', 'visibility-opportunity', 'positive-signals', 'insufficient-activity']
  return order.map((cohort) => ({ cohort, label: COHORT_META[cohort].label, count: counts.get(cohort) ?? 0, description: COHORT_META[cohort].description }))
}

// --- Category / segment intelligence (§7) -----------------------------------
// Article Type / Brand / Gender come through as metadata on every Myntra
// record (lib/performanceAdapters.ts's parseMyntraRows): real, reported
// values, never inferred. Only surfaced when a segment has enough
// products to mean something (MIN_SEGMENT_SAMPLE_SIZE): "avoid
// meaningless analysis for tiny groups," per spec.

export type SegmentDimension = 'articleType' | 'brand' | 'gender'

export type SegmentInsight = {
  dimension: SegmentDimension
  value: string
  productCount: number
  ctr: number | null
  atcRate: number | null
  conversionRate: number | null
  ctrDeltaVsCatalog: number | null
  atcRateDeltaVsCatalog: number | null
  conversionRateDeltaVsCatalog: number | null
}

const MIN_SEGMENT_SAMPLE_SIZE = 10

export function buildSegmentInsights(currentRecords: PerformanceHistoryRecord[], catalogAggregate: AggregateSnapshot, dimension: SegmentDimension): SegmentInsight[] {
  const groups = new Map<string, PerformanceHistoryRecord[]>()
  for (const r of currentRecords) {
    const raw = r.metadata?.[dimension]
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (!value) continue
    const list = groups.get(value) ?? []
    list.push(r)
    groups.set(value, list)
  }

  const insights: SegmentInsight[] = []
  for (const [value, records] of groups) {
    if (records.length < MIN_SEGMENT_SAMPLE_SIZE) continue
    const impressions = sumOrNull(records.map((r) => r.impressions))
    const clicks = sumOrNull(records.map((r) => r.clicks))
    const addToCarts = sumOrNull(records.map((r) => r.addToCarts))
    const purchases = sumOrNull(records.map((r) => r.purchases))
    const ctr = computeCtr(clicks, impressions)
    const atcRate = computeAtcRate(addToCarts, clicks)
    const conversionRate = computeConversionRate(purchases, clicks)

    insights.push({
      dimension,
      value,
      productCount: records.length,
      ctr,
      atcRate,
      conversionRate,
      ctrDeltaVsCatalog: ctr !== null && catalogAggregate.ctr !== null ? ctr - catalogAggregate.ctr : null,
      atcRateDeltaVsCatalog: atcRate !== null && catalogAggregate.atcRate !== null ? atcRate - catalogAggregate.atcRate : null,
      conversionRateDeltaVsCatalog: conversionRate !== null && catalogAggregate.conversionRate !== null ? conversionRate - catalogAggregate.conversionRate : null
    })
  }

  return insights.sort((a, b) => b.productCount - a.productCount)
}
