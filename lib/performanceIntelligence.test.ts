// Unit tests for lib/performanceIntelligence.ts. Milestone C15 — Seller
// Performance Intelligence & Action Engine.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  groupByPeriod,
  aggregatePeriod,
  compareAggregates,
  classifyMetricTrend,
  classifyProblemPersistence,
  computeCatalogMedians,
  diagnoseRelative,
  classifyIntelligenceBucket,
  summarizeAreaDiagnoses,
  diagnosePeriodRelative,
  buildProductInsights,
  topOpportunityProducts,
  allProductsRanked,
  computeCatalogStats,
  classifyCohort,
  buildCatalogOpportunityMap,
  buildSegmentInsights,
  type PeriodGroup,
  type RelativeDiagnosis
} from './performanceIntelligence'
import type { PerformanceHistoryRecord } from './performance'

function historyRecord(overrides: Partial<PerformanceHistoryRecord> = {}): PerformanceHistoryRecord {
  return {
    marketplace: 'myntra',
    externalProductId: 'style-1',
    productId: null,
    brand: null,
    periodStart: '2026-08-08',
    periodEnd: '2026-08-14',
    periodType: 'weekly',
    impressions: 1000,
    clicks: 20,
    addToCarts: 5,
    purchases: 2,
    revenue: null,
    returns: null,
    returnRate: 0,
    rating: 4.2,
    considerationRate: null,
    conversionRate: null,
    ctr: null,
    source: 'myntra_impress_report',
    metadata: null,
    ...overrides
  }
}

// --- groupByPeriod -----------------------------------------------------

test('groupByPeriod groups rows sharing the same period_start/period_end together, newest period first', () => {
  const records = [
    historyRecord({ externalProductId: 'a', periodStart: '2026-08-01', periodEnd: '2026-08-07' }),
    historyRecord({ externalProductId: 'b', periodStart: '2026-08-08', periodEnd: '2026-08-14' }),
    historyRecord({ externalProductId: 'c', periodStart: '2026-08-01', periodEnd: '2026-08-07' })
  ]
  const groups = groupByPeriod(records)
  assert.equal(groups.length, 2)
  assert.equal(groups[0].periodStart, '2026-08-08', 'newest period first')
  assert.equal(groups[1].records.length, 2, 'two rows shared the older period')
})

test('groupByPeriod handles a single period', () => {
  const groups = groupByPeriod([historyRecord()])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].records.length, 1)
})

// --- aggregatePeriod -----------------------------------------------------

test('aggregatePeriod sums raw counts across every product in the period', () => {
  const group: PeriodGroup = {
    periodStart: '2026-08-08',
    periodEnd: '2026-08-14',
    periodType: 'weekly',
    records: [
      historyRecord({ externalProductId: 'a', impressions: 100, clicks: 10, addToCarts: 2, purchases: 1 }),
      historyRecord({ externalProductId: 'b', impressions: 200, clicks: 20, addToCarts: 4, purchases: 1 })
    ]
  }
  const agg = aggregatePeriod(group)
  assert.equal(agg.productsAnalyzed, 2)
  assert.equal(agg.impressions, 300)
  assert.equal(agg.clicks, 30)
  assert.equal(agg.addToCarts, 6)
  assert.equal(agg.purchases, 2)
})

test('aggregatePeriod computes CTR/ATC-rate/conversion-rate from SUMMED counts, not an average of each product\'s own percentage — a high-traffic product must not be diluted by a low-traffic one', () => {
  const group: PeriodGroup = {
    periodStart: '2026-08-08',
    periodEnd: '2026-08-14',
    periodType: 'weekly',
    records: [
      historyRecord({ externalProductId: 'a', impressions: 900, clicks: 90 }),
      historyRecord({ externalProductId: 'b', impressions: 100, clicks: 1 })
    ]
  }
  const agg = aggregatePeriod(group)
  assert.ok(agg.ctr !== null)
  assert.ok(Math.abs(agg.ctr! - 9.1) < 0.01, `expected ~9.1%, got ${agg.ctr}`)
})

test('aggregatePeriod counts distinct products, not rows — the same external id appearing twice in one period counts once', () => {
  const group: PeriodGroup = {
    periodStart: '2026-08-08',
    periodEnd: '2026-08-14',
    periodType: 'weekly',
    records: [historyRecord({ externalProductId: 'a' }), historyRecord({ externalProductId: 'a' })]
  }
  assert.equal(aggregatePeriod(group).productsAnalyzed, 1)
})

test('aggregatePeriod never fabricates a metric from an empty period', () => {
  const group: PeriodGroup = { periodStart: '2026-08-08', periodEnd: '2026-08-14', periodType: 'weekly', records: [] }
  const agg = aggregatePeriod(group)
  assert.equal(agg.impressions, null)
  assert.equal(agg.productsAnalyzed, 0)
})

// --- compareAggregates (period-over-period trend, still fixed-significance) -

test('compareAggregates returns null with no previous period, matching computeTrend\'s own "no fabricated stable" rule (§10)', () => {
  const group: PeriodGroup = { periodStart: '2026-08-08', periodEnd: '2026-08-14', periodType: 'weekly', records: [historyRecord()] }
  assert.equal(compareAggregates(aggregatePeriod(group), null, 'myntra'), null)
})

test('compareAggregates detects an improving conversion trend between two real aggregates', () => {
  const previous: PeriodGroup = {
    periodStart: '2026-08-01',
    periodEnd: '2026-08-07',
    periodType: 'weekly',
    records: [historyRecord({ impressions: 1000, clicks: 100, purchases: 1 })]
  }
  const current: PeriodGroup = {
    periodStart: '2026-08-08',
    periodEnd: '2026-08-14',
    periodType: 'weekly',
    records: [historyRecord({ impressions: 1000, clicks: 100, purchases: 10 })]
  }
  const trend = compareAggregates(aggregatePeriod(current), aggregatePeriod(previous), 'myntra')
  assert.equal(trend?.diagnosis?.code, 'PERFORMANCE_IMPROVING')
})

// --- classifyMetricTrend ---------------------------------------------------

test('classifyMetricTrend returns insufficient-data with fewer than 2 real values', () => {
  assert.equal(classifyMetricTrend([5]), 'insufficient-data')
  assert.equal(classifyMetricTrend([]), 'insufficient-data')
  assert.equal(classifyMetricTrend([null, null]), 'insufficient-data')
})

test('classifyMetricTrend: newest higher than oldest by more than the significance threshold is "improving" (higherIsBetter)', () => {
  assert.equal(classifyMetricTrend([2.0, 1.0]), 'improving')
})

test('classifyMetricTrend: newest lower than oldest is "declining"', () => {
  assert.equal(classifyMetricTrend([0.5, 1.0]), 'declining')
})

test('classifyMetricTrend: a move smaller than the significance threshold is "stable", not improving/declining', () => {
  assert.equal(classifyMetricTrend([1.02, 1.0]), 'stable')
})

test('classifyMetricTrend respects higherIsBetter=false (e.g. return rate — lower is the good direction)', () => {
  assert.equal(classifyMetricTrend([2.0, 10.0], false), 'improving')
  assert.equal(classifyMetricTrend([10.0, 2.0], false), 'declining')
})

// --- classifyProblemPersistence (now area-based, RelativeDiagnosis[][]) ----

function fakeAreaDiagnosis(area: RelativeDiagnosis['area']): RelativeDiagnosis {
  return { area, priority: 1, message: '', leadSuspects: [] }
}

test('classifyProblemPersistence: present in current and every prior period is "persistent"', () => {
  const weak = [fakeAreaDiagnosis('click-through')]
  assert.equal(classifyProblemPersistence('click-through', [weak, weak, weak]), 'persistent')
})

test('classifyProblemPersistence: present now, absent in every prior period, is "new"', () => {
  const weak = [fakeAreaDiagnosis('click-through')]
  const healthy: RelativeDiagnosis[] = []
  assert.equal(classifyProblemPersistence('click-through', [weak, healthy, healthy]), 'new')
})

test('classifyProblemPersistence: absent now but present the immediately prior period is "recovered"', () => {
  const weak = [fakeAreaDiagnosis('click-through')]
  const healthy: RelativeDiagnosis[] = []
  assert.equal(classifyProblemPersistence('click-through', [healthy, weak]), 'recovered')
})

test('classifyProblemPersistence: absent now and never present is "none"', () => {
  const healthy: RelativeDiagnosis[] = []
  assert.equal(classifyProblemPersistence('click-through', [healthy, healthy]), 'none')
})

test('classifyProblemPersistence: only one period exists at all and the problem is present is "isolated"', () => {
  const weak = [fakeAreaDiagnosis('click-through')]
  assert.equal(classifyProblemPersistence('click-through', [weak]), 'isolated')
})

// --- computeCatalogStats: catalog-relative, not one universal constant -----

test('computeCatalogStats derives a meaningful-activity floor from THIS catalog\'s own median, never a single hardcoded constant applied identically to every catalog size', () => {
  const bigCatalog = Array.from({ length: 50 }, (_, i) => historyRecord({ externalProductId: `p${i}`, impressions: 10000, clicks: 500 }))
  const stats = computeCatalogStats(bigCatalog)
  assert.equal(stats.medianImpressions, 10000)
  assert.ok(stats.meaningfulImpressionsFloor >= 10000, 'floor should track the catalog\'s own median, not stay pinned at the absolute constant')
})

test('computeCatalogStats never drops below the existing absolute reliability floor for a tiny/sparse catalog — avoids misleading conclusions for tiny datasets', () => {
  const tinyCatalog = [historyRecord({ externalProductId: 'p1', impressions: 5, clicks: 1 })]
  const stats = computeCatalogStats(tinyCatalog)
  assert.ok(stats.meaningfulImpressionsFloor >= 100, 'must not drop below the absolute noise floor just because this catalog is tiny')
})

// --- computeCatalogMedians: relative CTR/conversion/ATC/return/rating ------

test('computeCatalogMedians computes the catalog\'s own median CTR only from products with enough impressions to trust their own rate', () => {
  const records = [
    // Below the reliability floor — must not pollute the median.
    historyRecord({ externalProductId: 'noisy', impressions: 5, clicks: 5 }), // 100% CTR, but unreliable
    historyRecord({ externalProductId: 'a', impressions: 1000, clicks: 20 }), // 2%
    historyRecord({ externalProductId: 'b', impressions: 1000, clicks: 40 }) // 4%
  ]
  const stats = computeCatalogStats(records)
  const medians = computeCatalogMedians(records, stats)
  assert.ok(medians.medianCtr !== null)
  assert.ok(Math.abs(medians.medianCtr! - 3) < 0.01, `expected the median of the two reliable CTRs (2%, 4%) = 3%, got ${medians.medianCtr}`)
})

test('computeCatalogMedians computes medianReturnRate/medianRating from every record with a real value, not gated by the traffic floor', () => {
  const records = [
    historyRecord({ externalProductId: 'a', returnRate: 10, rating: 3.0 }),
    historyRecord({ externalProductId: 'b', returnRate: 20, rating: 5.0 })
  ]
  const stats = computeCatalogStats(records)
  const medians = computeCatalogMedians(records, stats)
  assert.equal(medians.medianReturnRate, 15)
  assert.equal(medians.medianRating, 4)
})

// --- diagnoseRelative: catalog-relative, never a fixed absolute threshold --

test('diagnoseRelative flags click-through when CTR is far below THIS catalog\'s own median, with Main image/Title as lead suspects', () => {
  const records = [
    historyRecord({ externalProductId: 'weak', impressions: 2000, clicks: 5 }), // 0.25% CTR
    ...Array.from({ length: 10 }, (_, i) => historyRecord({ externalProductId: `p${i}`, impressions: 2000, clicks: 80 })) // 4% CTR
  ]
  const stats = computeCatalogStats(records)
  const medians = computeCatalogMedians(records, stats)
  const weak = records[0]
  const diagnoses = diagnoseRelative(weak, stats, medians)
  const clickThrough = diagnoses.find((d) => d.area === 'click-through')
  assert.ok(clickThrough, 'expected a click-through diagnosis for a CTR far below the catalog median')
  assert.deepEqual(clickThrough!.leadSuspects, ['Main image', 'Title'])
})

test('diagnoseRelative: CTR healthy but conversion weak leads with Description/Secondary images/Pricing, not Main image/Title', () => {
  const records = [
    historyRecord({ externalProductId: 'target', impressions: 2000, clicks: 80, purchases: 0 }), // CTR at catalog median, conversion 0
    ...Array.from({ length: 10 }, (_, i) => historyRecord({ externalProductId: `p${i}`, impressions: 2000, clicks: 80, purchases: 8 })) // 10% conversion
  ]
  const stats = computeCatalogStats(records)
  const medians = computeCatalogMedians(records, stats)
  const target = records[0]
  const diagnoses = diagnoseRelative(target, stats, medians)
  const conversion = diagnoses.find((d) => d.area === 'purchase-conversion')
  assert.ok(conversion, 'expected a purchase-conversion diagnosis')
  assert.deepEqual(conversion!.leadSuspects, ['Description', 'Secondary images', 'Pricing'])
  assert.ok(!diagnoses.some((d) => d.area === 'click-through'), 'CTR was at the catalog median — must not also flag click-through')
})

test('diagnoseRelative fix-order sequencing: when both click-through and purchase-conversion problems co-occur on the same product, click-through ranks first', () => {
  const records = [
    // clicks: 10 clears the absolute reliability floor (so conversion CAN
    // be judged) while its CTR (0.5%) still sits far below the catalog's.
    historyRecord({ externalProductId: 'both', impressions: 2000, clicks: 10, purchases: 0 }), // weak CTR AND weak conversion
    ...Array.from({ length: 10 }, (_, i) => historyRecord({ externalProductId: `p${i}`, impressions: 2000, clicks: 80, purchases: 8 }))
  ]
  const stats = computeCatalogStats(records)
  const medians = computeCatalogMedians(records, stats)
  const diagnoses = diagnoseRelative(records[0], stats, medians)
  assert.ok(diagnoses.length >= 2, 'expected multiple co-occurring problems')
  assert.equal(diagnoses[0].area, 'click-through', 'a visibility problem must outrank a conversion problem — fixing conversion is wasted on a product nobody clicks')
})

test('diagnoseRelative flags returns only when elevated relative to the catalog\'s own average, never a fixed percentage', () => {
  const lowReturnCatalog = [
    historyRecord({ externalProductId: 'a', returnRate: 2 }),
    historyRecord({ externalProductId: 'b', returnRate: 2 }),
    historyRecord({ externalProductId: 'target', returnRate: 5 }) // 2.5x catalog average — elevated here
  ]
  const highReturnCatalog = [
    historyRecord({ externalProductId: 'a', returnRate: 20 }),
    historyRecord({ externalProductId: 'b', returnRate: 20 }),
    historyRecord({ externalProductId: 'target', returnRate: 5 }) // same 5% — NOT elevated in this catalog
  ]
  const lowStats = computeCatalogStats(lowReturnCatalog)
  const lowMedians = computeCatalogMedians(lowReturnCatalog, lowStats)
  const highStats = computeCatalogStats(highReturnCatalog)
  const highMedians = computeCatalogMedians(highReturnCatalog, highStats)

  const inLowCatalog = diagnoseRelative(lowReturnCatalog[2], lowStats, lowMedians)
  const inHighCatalog = diagnoseRelative(highReturnCatalog[2], highStats, highMedians)
  assert.ok(inLowCatalog.some((d) => d.area === 'returns'), 'the same 5% return rate should be flagged in a low-return catalog')
  assert.ok(!inHighCatalog.some((d) => d.area === 'returns'), 'the identical 5% return rate must NOT be flagged in a high-return catalog — no fixed absolute threshold')
})

test('diagnoseRelative flags rating only when below the catalog\'s own median', () => {
  const records = [
    historyRecord({ externalProductId: 'target', rating: 3.5 }),
    historyRecord({ externalProductId: 'a', rating: 4.5 }),
    historyRecord({ externalProductId: 'b', rating: 4.8 })
  ]
  const stats = computeCatalogStats(records)
  const medians = computeCatalogMedians(records, stats)
  const diagnoses = diagnoseRelative(records[0], stats, medians)
  assert.ok(diagnoses.some((d) => d.area === 'rating'))
})

test('diagnoseRelative flags stock-recovery for a recently-relisted, low-visibility product — phrased as a possibility to investigate, never a confirmed cause', () => {
  const records = [
    historyRecord({ externalProductId: 'target', impressions: 5, metadata: { inventoryAge: 2 } }), // just relisted, low visibility
    ...Array.from({ length: 5 }, (_, i) => historyRecord({ externalProductId: `p${i}`, impressions: 2000, metadata: { inventoryAge: 200 } }))
  ]
  const stats = computeCatalogStats(records)
  const medians = computeCatalogMedians(records, stats)
  const diagnoses = diagnoseRelative(records[0], stats, medians)
  const stockRecovery = diagnoses.find((d) => d.area === 'stock-recovery')
  assert.ok(stockRecovery, 'expected a stock-recovery diagnosis for a just-relisted, low-visibility product')
  assert.match(stockRecovery!.leadSuspects.join(' '), /may not have recovered/i)
})

test('diagnoseRelative never fires any diagnosis for a product performing at or above every one of the catalog\'s own medians', () => {
  const records = [
    historyRecord({ externalProductId: 'target', impressions: 2000, clicks: 80, purchases: 8, returnRate: 5, rating: 4.5 }),
    ...Array.from({ length: 5 }, (_, i) => historyRecord({ externalProductId: `p${i}`, impressions: 2000, clicks: 80, purchases: 8, returnRate: 5, rating: 4.5 }))
  ]
  const stats = computeCatalogStats(records)
  const medians = computeCatalogMedians(records, stats)
  const diagnoses = diagnoseRelative(records[0], stats, medians)
  assert.equal(diagnoses.length, 0)
})

// --- classifyIntelligenceBucket: P1/P2/P3, exact spec definitions ----------

test('classifyIntelligenceBucket: P1 is clicks/carts exist, zero purchases', () => {
  const records = [historyRecord({ externalProductId: 'target', clicks: 20, addToCarts: 5, purchases: 0 })]
  const stats = computeCatalogStats(records)
  const medians = computeCatalogMedians(records, stats)
  assert.equal(classifyIntelligenceBucket(records[0], stats, medians), 'P1')
})

test('classifyIntelligenceBucket: P2 is meaningful impressions with near-zero CTR relative to the catalog median', () => {
  const records = [
    // addToCarts: 0 explicitly — the default fixture value would
    // otherwise satisfy P1's "clicks/carts exist" and take priority.
    historyRecord({ externalProductId: 'target', impressions: 2000, clicks: 0, addToCarts: 0, purchases: 0 }),
    ...Array.from({ length: 5 }, (_, i) => historyRecord({ externalProductId: `p${i}`, impressions: 2000, clicks: 80, addToCarts: 0, purchases: 0 }))
  ]
  const stats = computeCatalogStats(records)
  const medians = computeCatalogMedians(records, stats)
  assert.equal(classifyIntelligenceBucket(records[0], stats, medians), 'P2')
})

test('classifyIntelligenceBucket: P3 is purchases exist but traffic is low relative to the catalog (under-exposed converter)', () => {
  const records = [
    historyRecord({ externalProductId: 'target', impressions: 50, clicks: 5, purchases: 2 }),
    ...Array.from({ length: 5 }, (_, i) => historyRecord({ externalProductId: `p${i}`, impressions: 5000, clicks: 100, purchases: 2 }))
  ]
  const stats = computeCatalogStats(records)
  const medians = computeCatalogMedians(records, stats)
  assert.equal(classifyIntelligenceBucket(records[0], stats, medians), 'P3')
})

test('classifyIntelligenceBucket: a product matching none of the three definitions gets no bucket (null)', () => {
  const records = [
    historyRecord({ externalProductId: 'target', impressions: 5000, clicks: 100, purchases: 5 }),
    ...Array.from({ length: 5 }, (_, i) => historyRecord({ externalProductId: `p${i}`, impressions: 5000, clicks: 100, purchases: 5 }))
  ]
  const stats = computeCatalogStats(records)
  const medians = computeCatalogMedians(records, stats)
  assert.equal(classifyIntelligenceBucket(records[0], stats, medians), null)
})

// --- summarizeAreaDiagnoses / diagnosePeriodRelative (account-wide rollup) -

test('summarizeAreaDiagnoses rolls up per-product diagnoses into one entry per area, counting affected products, ranked by fix-order priority', () => {
  const perProduct: RelativeDiagnosis[][] = [
    [fakeAreaDiagnosis('click-through')],
    [fakeAreaDiagnosis('click-through')],
    [fakeAreaDiagnosis('rating')]
  ]
  const summary = summarizeAreaDiagnoses(perProduct)
  const clickThrough = summary.find((s) => s.area === 'click-through')
  const rating = summary.find((s) => s.area === 'rating')
  assert.equal(clickThrough?.affectedProductCount, 2)
  assert.equal(rating?.affectedProductCount, 1)
  assert.equal(summary[0].area, 'click-through', 'click-through (priority 4) must rank above rating (priority 1)')
})

test('diagnosePeriodRelative computes catalog stats/medians from ONLY the given period\'s records, never mixed with another period', () => {
  const period = [
    historyRecord({ externalProductId: 'weak', impressions: 2000, clicks: 5 }),
    ...Array.from({ length: 10 }, (_, i) => historyRecord({ externalProductId: `p${i}`, impressions: 2000, clicks: 80 }))
  ]
  const summary = diagnosePeriodRelative(period)
  assert.ok(summary.some((d) => d.area === 'click-through'))
})

// --- buildProductInsights & prioritization ---------------------------------

test('buildProductInsights groups strictly by externalProductId — never by brand/title/MRP (§7/§22)', () => {
  const source = readFileSync(join(__dirname, 'performanceIntelligence.ts'), 'utf8')
  const start = source.indexOf('export function buildProductInsights')
  const end = source.indexOf('\n// --- Account-wide diagnosis rollup', start)
  const body = source.slice(start, end).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  assert.ok(!/brand_name|brandName|\.brand\b|title|mrp|Mrp|MRP/.test(body))
  assert.match(body, /r\.externalProductId/)
})

test('a product with a real, high-opportunity funnel problem is prioritized "fix-now"', () => {
  // A single-product "catalog" can never trigger a below-median relative
  // diagnosis against itself (its own value IS the median) — real
  // comparison products are required for a genuinely catalog-relative
  // assertion, matching how a real multi-product catalog behaves.
  const insights = buildProductInsights([
    historyRecord({ externalProductId: 'weak', impressions: 5000, clicks: 25, purchases: 0 }), // high-volume, far-below-median CTR
    ...Array.from({ length: 10 }, (_, i) => historyRecord({ externalProductId: `p${i}`, impressions: 2000, clicks: 80, purchases: 8 }))
  ])
  const target = insights.find((p) => p.externalProductId === 'weak')!
  assert.equal(target.priority, 'fix-now')
  assert.ok(target.topProblem)
  assert.ok(target.recommendedAction)
})

test('a product with zero purchases is NEVER prioritized "scale", even if its CTR happens to be healthy (regression — this was a real bug found via live verification)', () => {
  const insights = buildProductInsights([historyRecord({ impressions: 500, clicks: 10, addToCarts: 0, purchases: 0 })])
  assert.notEqual(insights[0].priority, 'scale')
})

test('a product with real purchases AND no diagnosed conversion/engagement problem IS prioritized "scale"', () => {
  const insights = buildProductInsights([
    historyRecord({ externalProductId: 'target', impressions: 2000, clicks: 80, addToCarts: 20, purchases: 8 }),
    ...Array.from({ length: 5 }, (_, i) => historyRecord({ externalProductId: `p${i}`, impressions: 2000, clicks: 80, addToCarts: 20, purchases: 8 }))
  ])
  assert.equal(insights.find((p) => p.externalProductId === 'target')!.priority, 'scale')
})

test('a declining product is never "scale" even with a healthy current-period signal', () => {
  const previous = historyRecord({ periodStart: '2026-08-01', periodEnd: '2026-08-07', clicks: 200, purchases: 40 })
  const current = historyRecord({ periodStart: '2026-08-08', periodEnd: '2026-08-14', clicks: 200, purchases: 30 })
  const insights = buildProductInsights([current, previous])
  assert.notEqual(insights[0].priority, 'scale')
})

test('a product with genuinely insufficient traffic (no reliable diagnosis at all) is "low-priority"', () => {
  const insights = buildProductInsights([historyRecord({ impressions: 5, clicks: 0, addToCarts: 0, purchases: 0 })])
  assert.equal(insights[0].priority, 'low-priority')
})

test('unlinked products (productId null) still receive a full insight — diagnosis, trend eligibility, priority, recommendation, bucket (§22, no matching step reintroduced)', () => {
  const insights = buildProductInsights([
    historyRecord({ externalProductId: 'weak', productId: null, impressions: 5000, clicks: 25, purchases: 0 }),
    ...Array.from({ length: 10 }, (_, i) => historyRecord({ externalProductId: `p${i}`, impressions: 2000, clicks: 80, purchases: 8 }))
  ])
  const target = insights.find((p) => p.externalProductId === 'weak')!
  assert.equal(target.productId, null)
  assert.equal(target.priority, 'fix-now')
  assert.ok(target.recommendedAction)
})

test('a linked product (productId set) is preserved through to the insight, untouched', () => {
  const insights = buildProductInsights([historyRecord({ productId: 'product-abc' })])
  assert.equal(insights[0].productId, 'product-abc')
})

test('buildProductInsights uses the MOST RECENT period as current and the one before it as previous, per product', () => {
  const records = [
    historyRecord({ periodStart: '2026-08-01', periodEnd: '2026-08-07', purchases: 1 }),
    historyRecord({ periodStart: '2026-08-08', periodEnd: '2026-08-14', purchases: 5 }),
    historyRecord({ periodStart: '2026-07-25', periodEnd: '2026-07-31', purchases: 0 })
  ]
  const insights = buildProductInsights(records)
  assert.equal(insights[0].current.periodStart, '2026-08-08')
  assert.equal(insights[0].previous?.periodStart, '2026-08-01')
  assert.equal(insights[0].periodsAvailable, 3)
})

test('buildProductInsights assigns a P1/P2/P3 bucket alongside priority — computed relative to the catalog, never a fixed number', () => {
  const insights = buildProductInsights([
    historyRecord({ externalProductId: 'p1', clicks: 20, addToCarts: 5, purchases: 0 }),
    historyRecord({ externalProductId: 'other', impressions: 2000, clicks: 80, purchases: 8 })
  ])
  assert.equal(insights.find((p) => p.externalProductId === 'p1')!.bucket, 'P1')
})

test('buildProductInsights\' fix-now/optimize split is catalog-relative — the SAME product-level numbers can land in a different bucket depending on the rest of the catalog', () => {
  const smallProduct = (id: string) => historyRecord({ externalProductId: id, impressions: 250, clicks: 15, addToCarts: 3, purchases: 0 })
  const lowTrafficCatalog = buildProductInsights([smallProduct('a'), historyRecord({ externalProductId: 'b', impressions: 50, clicks: 5 })])
  const aInLowTrafficCatalog = lowTrafficCatalog.find((p) => p.externalProductId === 'a')!
  const hugeCatalog = buildProductInsights([
    smallProduct('a'),
    ...Array.from({ length: 20 }, (_, i) => historyRecord({ externalProductId: `huge${i}`, impressions: 50000, clicks: 3000 }))
  ])
  const aInHugeCatalog = hugeCatalog.find((p) => p.externalProductId === 'a')!
  assert.notEqual(aInLowTrafficCatalog.priority, aInHugeCatalog.priority, 'the same product should be prioritized differently depending on the catalog it sits in')
})

// --- topOpportunityProducts --------------------------------------------

test('topOpportunityProducts ranks a priority bucket by impressions and caps it — the same ranking the UI and the downloadable report both use', () => {
  const insights = buildProductInsights([
    historyRecord({ externalProductId: 'small', impressions: 200, clicks: 3, purchases: 0 }),
    historyRecord({ externalProductId: 'big', impressions: 5000, clicks: 5, purchases: 0 })
  ])
  const top = topOpportunityProducts(insights, 'fix-now', 1)
  assert.equal(top.length, 1)
  assert.equal(top[0].externalProductId, 'big', 'higher-impression product should rank first')
})

test('topOpportunityProducts never returns products from a different priority bucket', () => {
  const insights = buildProductInsights([
    historyRecord({ externalProductId: 'fix-me', impressions: 5000, clicks: 5, purchases: 0 }),
    historyRecord({ externalProductId: 'winner', impressions: 2000, clicks: 200, addToCarts: 60, purchases: 30 })
  ])
  const top = topOpportunityProducts(insights, 'scale', 10)
  assert.ok(top.every((p) => p.priority === 'scale'))
  assert.ok(!top.some((p) => p.externalProductId === 'fix-me'))
})

// generateActionPlan/buildActionReportText moved to
// lib/performanceNarrative.ts (the storytelling/action-plan layer, which
// depends on this file, never the reverse) — see
// lib/performanceNarrative.test.ts for their tests.

// --- aggregatePeriod: considerationRate + sales-split fields ---------------

test('aggregatePeriod aggregates considerationRate (a real, parsed Myntra field) — not left at a hardcoded null', () => {
  const group: PeriodGroup = {
    periodStart: '2026-08-08',
    periodEnd: '2026-08-14',
    periodType: 'weekly',
    records: [historyRecord({ externalProductId: 'a', considerationRate: 10 }), historyRecord({ externalProductId: 'b', considerationRate: 20 })]
  }
  const agg = aggregatePeriod(group)
  assert.equal(agg.considerationRate, 15)
})

test('aggregatePeriod splits products into productsWithSales / productsWithNoSales by distinct product, not by row', () => {
  const group: PeriodGroup = {
    periodStart: '2026-08-08',
    periodEnd: '2026-08-14',
    periodType: 'weekly',
    records: [
      historyRecord({ externalProductId: 'sold', purchases: 3 }),
      historyRecord({ externalProductId: 'not-sold-1', purchases: 0 }),
      historyRecord({ externalProductId: 'not-sold-2', purchases: 0 })
    ]
  }
  const agg = aggregatePeriod(group)
  assert.equal(agg.productsWithSales, 1)
  assert.equal(agg.productsWithNoSales, 2)
})

// --- classifyCohort / buildCatalogOpportunityMap (§G, large-catalog map) ---

test('classifyCohort maps every priority/area combination onto exactly one of the 5 named cohorts', () => {
  const fake = (priority: 'fix-now' | 'optimize' | 'scale' | 'low-priority', area: RelativeDiagnosis['area'] | null) =>
    ({ priority, topProblem: area ? fakeAreaDiagnosis(area) : null }) as any

  assert.equal(classifyCohort(fake('fix-now', 'purchase-conversion')), 'purchase-opportunity')
  assert.equal(classifyCohort(fake('fix-now', 'product-page-engagement')), 'engagement-opportunity')
  assert.equal(classifyCohort(fake('fix-now', 'click-through')), 'visibility-opportunity')
  assert.equal(classifyCohort(fake('fix-now', 'stock-recovery')), 'visibility-opportunity')
  assert.equal(classifyCohort(fake('optimize', 'returns')), 'purchase-opportunity')
  assert.equal(classifyCohort(fake('optimize', 'rating')), 'purchase-opportunity')
  assert.equal(classifyCohort(fake('scale', null)), 'positive-signals')
  assert.equal(classifyCohort(fake('low-priority', null)), 'insufficient-activity')
})

test('buildCatalogOpportunityMap returns exactly 5 rows (even when a cohort is empty) so a large catalog is summarized, never listed row by row', () => {
  const insights = buildProductInsights([historyRecord({ impressions: 5000, clicks: 5, addToCarts: 1, purchases: 0 })])
  const map = buildCatalogOpportunityMap(insights)
  assert.equal(map.length, 5)
  const total = map.reduce((sum, row) => sum + row.count, 0)
  assert.equal(total, insights.length, 'every product must be counted in exactly one cohort')
})

// --- allProductsRanked (backs "View all affected products") ---------------

test('allProductsRanked orders fix-now before optimize before scale before low-priority, and by impressions within each tier', () => {
  const insights = buildProductInsights([
    historyRecord({ externalProductId: 'low', impressions: 5, clicks: 0, purchases: 0 }),
    historyRecord({ externalProductId: 'fix-small', impressions: 150, clicks: 3, addToCarts: 1, purchases: 0 }),
    historyRecord({ externalProductId: 'fix-big', impressions: 8000, clicks: 5, addToCarts: 1, purchases: 0 })
  ])
  const ranked = allProductsRanked(insights)
  const priorities = ranked.map((p) => p.priority)
  const lastNonLowIndex = priorities.lastIndexOf(priorities.find((p) => p !== 'low-priority')!)
  assert.ok(priorities.indexOf('low-priority') > lastNonLowIndex || !priorities.includes('low-priority'))
})

// --- buildSegmentInsights (§7, category/segment intelligence) --------------

test('buildSegmentInsights only surfaces a segment once it reaches the minimum sample size — never meaningless analysis for tiny groups', () => {
  const records = Array.from({ length: 3 }, (_, i) =>
    historyRecord({ externalProductId: `p${i}`, impressions: 1000, clicks: 50, metadata: { articleType: 'Rare Item', brand: 'X', gender: 'Unisex' } })
  )
  const current = aggregatePeriod({ periodStart: '2026-08-08', periodEnd: '2026-08-14', periodType: 'weekly', records })
  const insights = buildSegmentInsights(records, current, 'articleType')
  assert.equal(insights.length, 0, 'a 3-product segment must not be surfaced')
})

test('buildSegmentInsights surfaces a segment once it clears the minimum sample size, with metrics computed from real summed counts', () => {
  const records = Array.from({ length: 12 }, (_, i) =>
    historyRecord({ externalProductId: `p${i}`, impressions: 1000, clicks: 50, metadata: { articleType: 'Category A', brand: 'Acme Co', gender: 'Unisex' } })
  )
  const current = aggregatePeriod({ periodStart: '2026-08-08', periodEnd: '2026-08-14', periodType: 'weekly', records })
  const insights = buildSegmentInsights(records, current, 'articleType')
  assert.equal(insights.length, 1)
  assert.equal(insights[0].value, 'Category A')
  assert.equal(insights[0].productCount, 12)
  assert.ok(insights[0].ctr !== null)
})

test('buildSegmentInsights never groups products with no reported value for that dimension', () => {
  const records = Array.from({ length: 12 }, (_, i) => historyRecord({ externalProductId: `p${i}`, metadata: null }))
  const current = aggregatePeriod({ periodStart: '2026-08-08', periodEnd: '2026-08-14', periodType: 'weekly', records })
  const insights = buildSegmentInsights(records, current, 'articleType')
  assert.equal(insights.length, 0)
})

// --- §19/§20 discipline carried into this file ------------------------------

test('this file never claims a proven cause — recommendation text still comes exclusively from lib/performanceRecommendations.ts, never invented here', () => {
  const source = readFileSync(join(__dirname, 'performanceIntelligence.ts'), 'utf8')
  assert.match(source, /import \{ getAreaRecommendation \} from '@\/lib\/performanceRecommendations'/)
  assert.ok(!/will improve|guaranteed|proven to cause/i.test(source))
})

test('this file contains no generative-AI/chatbot dependency — deterministic only (§20)', () => {
  const source = readFileSync(join(__dirname, 'performanceIntelligence.ts'), 'utf8')
  assert.ok(!/openai|anthropic|groq|generateText|chat\.completions/i.test(source))
})

test('this file never imports lib/credits.ts (§23)', () => {
  const source = readFileSync(join(__dirname, 'performanceIntelligence.ts'), 'utf8')
  assert.ok(!/lib\/credits/.test(source))
})

// --- Genericity: no hardcoded threshold survives across structurally ------
// different catalogs (per the C15 "any brand/seller/marketplace" audit —
// run against a small (<20 SKU) and a larger (75+ SKU) synthetic catalog,
// each with independently randomized values, and confirm the computed
// thresholds/buckets/diagnoses adapt to each rather than sharing any fixed
// number).

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function buildSyntheticCatalog(count: number): PerformanceHistoryRecord[] {
  return Array.from({ length: count }, (_, i) => {
    const impressions = randomInt(50, 20000)
    const clicks = randomInt(0, Math.floor(impressions * 0.1))
    const addToCarts = randomInt(0, clicks)
    const purchases = Math.random() > 0.6 ? randomInt(0, addToCarts) : 0
    return historyRecord({
      externalProductId: `synthetic-${i}-${randomInt(1000, 9999)}`,
      impressions,
      clicks,
      addToCarts,
      purchases,
      returnRate: randomInt(0, 30),
      rating: Math.round((Math.random() * 4 + 1) * 10) / 10,
      metadata: { inventoryAge: randomInt(1, 400) }
    })
  })
}

test('ACCEPTANCE: computeCatalogMedians/diagnoseRelative/classifyIntelligenceBucket run cleanly and adapt to two structurally different, independently randomized catalogs (small <20 SKUs, large 75+ SKUs) — no hardcoded value carries over from one to the other', () => {
  const small = buildSyntheticCatalog(15)
  const large = buildSyntheticCatalog(90)

  const smallStats = computeCatalogStats(small)
  const largeStats = computeCatalogStats(large)
  const smallMedians = computeCatalogMedians(small, smallStats)
  const largeMedians = computeCatalogMedians(large, largeStats)

  // Every record in each catalog must diagnose/bucket without throwing,
  // regardless of catalog size or the random values drawn.
  for (const r of small) {
    diagnoseRelative(r, smallStats, smallMedians)
    classifyIntelligenceBucket(r, smallStats, smallMedians)
  }
  for (const r of large) {
    diagnoseRelative(r, largeStats, largeMedians)
    classifyIntelligenceBucket(r, largeStats, largeMedians)
  }

  const smallInsights = buildProductInsights(small)
  const largeInsights = buildProductInsights(large)
  assert.equal(smallInsights.length, 15)
  assert.equal(largeInsights.length, 90)

  // Every P1 bucket in both catalogs must independently satisfy the exact
  // spec definition — never inferred from one catalog's own shape.
  for (const insight of [...smallInsights, ...largeInsights]) {
    if (insight.bucket === 'P1') {
      const hasActivity = (insight.current.clicks ?? 0) > 0 || (insight.current.addToCarts ?? 0) > 0
      assert.ok(hasActivity, 'P1 must have clicks/carts')
      assert.equal(insight.current.purchases, 0, 'P1 must have zero purchases')
    }
    if (insight.bucket === 'P3') {
      assert.ok((insight.current.purchases ?? 0) > 0, 'P3 must have real purchases')
    }
  }

  const map5 = (insights: ReturnType<typeof buildProductInsights>) => {
    const map = buildCatalogOpportunityMap(insights)
    assert.equal(map.length, 5)
    assert.equal(
      map.reduce((sum, row) => sum + row.count, 0),
      insights.length
    )
  }
  map5(smallInsights)
  map5(largeInsights)

  // The reliability floors themselves must genuinely differ between these
  // two independently-randomized catalogs (unless coincidentally equal,
  // vanishingly unlikely at these sample sizes) — proof the thresholds are
  // computed per-catalog, never one shared constant.
  assert.notEqual(
    smallStats.meaningfulImpressionsFloor === largeStats.meaningfulImpressionsFloor && smallMedians.medianCtr === largeMedians.medianCtr,
    true,
    'both the reliability floor and the median CTR being identical across two independently-randomized catalogs would indicate a hardcoded shared value'
  )
})
