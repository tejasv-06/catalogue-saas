// Unit tests for lib/performanceNarrative.ts. Milestone C15: Seller
// Performance Intelligence & Action Engine, the storytelling/action-plan
// layer built on top of lib/performanceIntelligence.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { aggregatePeriod, diagnosePeriodRelative, buildProductInsights, buildSegmentInsights, type PeriodGroup } from './performanceIntelligence'
import {
  describeSituation,
  describeFunnelStory,
  describeFunnelStages,
  describeWhatChanged,
  describeMultiPeriodStory,
  describePersistentProblems,
  buildAttentionItems,
  buildTopActions,
  describeWhyPrioritized,
  describeSegmentInsights,
  generateActionPlan,
  describeMeasurementPlan,
  buildActionReportText
} from './performanceNarrative'
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

function period(records: PerformanceHistoryRecord[], periodStart = '2026-08-08', periodEnd = '2026-08-14'): PeriodGroup {
  return { periodStart, periodEnd, periodType: 'weekly', records }
}

// A single-record "catalog" can never trigger a relative diagnosis (its
// own value IS the catalog median, so nothing can be "below" it): every
// test below that needs a diagnosis to actually fire builds a real,
// multi-product catalog: one target plus a baseline of otherwise-healthy
// comparison products, matched to the target everywhere EXCEPT the one
// dimension the test is exercising.
function baselineCatalog(count = 8, overrides: Partial<PerformanceHistoryRecord> = {}): PerformanceHistoryRecord[] {
  // "baseline-N", never a string containing "healthy": these IDs can
  // surface verbatim in report text (e.g. Positive Performers), and the
  // word "healthy" is exactly what several tests below assert never leaks
  // into the narrative.
  return Array.from({ length: count }, (_, i) =>
    historyRecord({ externalProductId: `baseline-${i}`, impressions: 2000, clicks: 80, addToCarts: 20, purchases: 8, returnRate: 5, rating: 4.5, ...overrides })
  )
}

// --- Severity is presentation-neutral: no emoji anywhere -----------------

test('this file never contains an emoji character: severity is returned as a typed enum, presentation decides the icon', () => {
  const source = readFileSync(join(__dirname, 'performanceNarrative.ts'), 'utf8')
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]/u.test(source))
})

test('describeSituation returns a severity enum (critical/warning/positive/info), never an icon/emoji string', () => {
  const records = [historyRecord({ impressions: 8556, clicks: 87, addToCarts: 8, purchases: 0 })]
  const current = aggregatePeriod(period(records))
  const diagnoses = diagnosePeriodRelative(records)
  const situation = describeSituation(current, diagnoses)
  assert.ok(['critical', 'warning', 'positive', 'info'].includes(situation.severity))
})

// --- B. describeSituation (Executive Status) --------------------------

test('describeSituation: a purchase-conversion problem produces the correct headline and primary opportunity, grounded in real numbers', () => {
  // CTR (4%) and ATC rate (25%) match the baseline exactly: only
  // conversion (0% vs the baseline's 10%) is weak, isolating the branch.
  const target = historyRecord({ externalProductId: 'target', impressions: 2000, clicks: 80, addToCarts: 20, purchases: 0 })
  const records = [target, ...baselineCatalog()]
  const current = aggregatePeriod(period(records))
  const diagnoses = diagnosePeriodRelative(records)
  const situation = describeSituation(current, diagnoses)
  assert.match(situation.headline, /converting shopper activity into purchases/i)
  assert.match(situation.primaryOpportunity, /Add to Cart.*Purchase/)
  assert.ok(situation.funnelLine.includes('impressions'))
  assert.equal(situation.severity, 'critical')
})

test('describeSituation: a click-through problem produces the "being shown" headline with a warning severity, not critical', () => {
  const target = historyRecord({ externalProductId: 'target', impressions: 5000, clicks: 25, addToCarts: 0, purchases: 0 })
  const records = [target, ...baselineCatalog()]
  const current = aggregatePeriod(period(records))
  const diagnoses = diagnosePeriodRelative(records)
  const situation = describeSituation(current, diagnoses)
  assert.match(situation.headline, /being shown/i)
  assert.equal(situation.severity, 'warning')
})

test('describeSituation: no weak diagnosis and real purchases produces a positive, non-fabricated headline', () => {
  // A single-record "catalog" can never diagnose itself as below its own
  // median: the cleanest way to guarantee zero diagnoses while still
  // reflecting real, reported purchase activity.
  const records = [historyRecord({ impressions: 3000, clicks: 300, addToCarts: 100, purchases: 60 })]
  const current = aggregatePeriod(period(records))
  const diagnoses = diagnosePeriodRelative(records)
  const situation = describeSituation(current, diagnoses)
  assert.equal(situation.severity, 'positive')
})

test('describeSituation: insufficient data never fabricates a problem or a win', () => {
  const records = [historyRecord({ impressions: 5, clicks: 0, addToCarts: 0, purchases: 0 })]
  const current = aggregatePeriod(period(records))
  const diagnoses = diagnosePeriodRelative(records)
  const situation = describeSituation(current, diagnoses)
  assert.equal(situation.severity, 'info')
})

test('describeSituation never uses the word "healthy": business language only, per the spec', () => {
  const target = historyRecord({ externalProductId: 'target', impressions: 2000, clicks: 80, addToCarts: 20, purchases: 0 })
  const records = [target, ...baselineCatalog()]
  const current = aggregatePeriod(period(records))
  const diagnoses = diagnosePeriodRelative(records)
  const situation = describeSituation(current, diagnoses)
  const allText = `${situation.headline} ${situation.explanation} ${situation.implication}`
  assert.ok(!/healthy/i.test(allText))
})

// --- describeFunnelStory / describeFunnelStages ---------------------------

test('describeFunnelStory names the correct opportunity for a purchase-conversion problem, with critical severity', () => {
  const target = historyRecord({ externalProductId: 'target', impressions: 2000, clicks: 80, addToCarts: 20, purchases: 0 })
  const records = [target, ...baselineCatalog()]
  const diagnoses = diagnosePeriodRelative(records)
  const funnel = describeFunnelStory(diagnoses)
  assert.match(funnel.gapLine, /Add to Cart.*Purchase/)
  assert.equal(funnel.severity, 'critical')
})

test('describeFunnelStages returns exactly 4 stages (Visibility/Engagement/Purchase intent/Conversion), each with an explanation', () => {
  const current = aggregatePeriod(period([historyRecord({ purchases: 0 })]))
  const stages = describeFunnelStages(current)
  assert.equal(stages.length, 4)
  for (const s of stages) assert.ok(s.explanation.length > 5)
})

// --- describeWhatChanged: never a bare arrow, includes a changeLabel ------

test('describeWhatChanged always pairs a value with a human explanation and a change label: never a bare percentage/arrow alone', () => {
  const current = aggregatePeriod(period([historyRecord({ impressions: 8556, clicks: 87, addToCarts: 8, purchases: 0 })], '2026-08-08', '2026-08-14'))
  const previous = aggregatePeriod(period([historyRecord({ impressions: 12541, clicks: 83, addToCarts: 6, purchases: 1 })], '2026-08-01', '2026-08-07'))
  const trend = {
    impressions: { current: 8556, previous: 12541, changePercent: -31.8 },
    clicks: { current: 87, previous: 83, changePercent: 4.8 },
    ctr: { current: current.ctr, previous: previous.ctr, changePercent: 50 },
    addToCarts: { current: 8, previous: 6, changePercent: 33 },
    purchases: { current: 0, previous: 1, changePercent: -100 },
    conversionRate: { current: 0, previous: 1.2, changePercent: -100 },
    returns: { current: null, previous: null, changePercent: null },
    rating: { current: null, previous: null, changePercent: null },
    diagnosis: null
  } as any

  const lines = describeWhatChanged(current, previous, trend)
  assert.equal(lines.length, 5)
  for (const line of lines) {
    assert.ok(line.value.length > 0)
    assert.ok(line.explanation.length > 10, `explanation too short/missing for ${line.label}`)
  }
  const purchasesLine = lines.find((l) => l.label === 'Purchases')!
  assert.match(purchasesLine.explanation, /fewer shoppers completed a purchase/i)
})

// --- describeMultiPeriodStory ---------------------------------------------

test('describeMultiPeriodStory returns null with fewer than 3 periods: never fabricates historical confidence', () => {
  assert.equal(describeMultiPeriodStory([period([historyRecord()])]), null)
})

test('describeMultiPeriodStory: CTR improving across periods with purchases stuck at zero produces the right narrative', () => {
  const periods = [
    period([historyRecord({ impressions: 1000, clicks: 30, purchases: 0 })], '2026-08-15', '2026-08-21'),
    period([historyRecord({ impressions: 1000, clicks: 20, purchases: 0 })], '2026-08-08', '2026-08-14'),
    period([historyRecord({ impressions: 1000, clicks: 10, purchases: 0 })], '2026-08-01', '2026-08-07')
  ]
  const story = describeMultiPeriodStory(periods)
  assert.match(story!, /purchases remained at zero/i)
})

// --- describePersistentProblems --------------------------------------------

test('describePersistentProblems returns nothing with fewer than 2 periods', () => {
  const records = [historyRecord({ impressions: 5000, clicks: 300, purchases: 0 })]
  assert.deepEqual(describePersistentProblems([diagnosePeriodRelative(records)]), [])
})

test('describePersistentProblems surfaces a problem present in EVERY available period, not one that appeared once', () => {
  const target = historyRecord({ externalProductId: 'target', impressions: 2000, clicks: 80, addToCarts: 20, purchases: 0 })
  const chronic = [target, ...baselineCatalog()]
  const diagnosesByPeriod = [diagnosePeriodRelative(chronic), diagnosePeriodRelative(chronic), diagnosePeriodRelative(chronic)]
  const notes = describePersistentProblems(diagnosesByPeriod)
  assert.ok(notes.some((n) => n.area === 'purchase-conversion'))
  assert.equal(notes.find((n) => n.area === 'purchase-conversion')?.periodsPersistent, 3)
})

test('describePersistentProblems does not claim persistence for a problem only present in the current period', () => {
  const target = historyRecord({ externalProductId: 'target', impressions: 2000, clicks: 80, addToCarts: 20, purchases: 0 })
  const problemNow = [target, ...baselineCatalog()]
  const fineBefore = baselineCatalog() // no diagnosed target at all in the prior period
  const diagnosesByPeriod = [diagnosePeriodRelative(problemNow), diagnosePeriodRelative(fineBefore)]
  const notes = describePersistentProblems(diagnosesByPeriod)
  assert.ok(!notes.some((n) => n.area === 'purchase-conversion'))
})

// --- buildAttentionItems ---------------------------------------------------

test('buildAttentionItems numbers items by rank with the correct severity, priority, and investigate list', () => {
  const target = historyRecord({ externalProductId: 'target', impressions: 2000, clicks: 80, addToCarts: 20, purchases: 0 })
  const records = [target, ...baselineCatalog()]
  const current = aggregatePeriod(period(records))
  const diagnoses = diagnosePeriodRelative(records)
  const items = buildAttentionItems(diagnoses, current)
  assert.ok(items.length > 0)
  assert.equal(items[0].rank, 1)
  assert.equal(items[0].severity, 'critical')
  assert.equal(items[0].priority, 'HIGH')
  assert.ok(items[0].investigate.includes('Selling price'))
})

test('buildAttentionItems never claims a confirmed cause', () => {
  const target = historyRecord({ externalProductId: 'target', impressions: 2000, clicks: 80, addToCarts: 20, purchases: 0 })
  const records = [target, ...baselineCatalog()]
  const current = aggregatePeriod(period(records))
  const diagnoses = diagnosePeriodRelative(records)
  const items = buildAttentionItems(diagnoses, current)
  for (const item of items) assert.ok(!/caused|because your price|the reason is/i.test(item.headline))
})

// --- buildTopActions (§H) ---------------------------------------------

test('buildTopActions returns the full structure §H requires: priority, affected count, why, investigate, measure-next, and references products by ID only (no duplicated evidence dump)', () => {
  const target = historyRecord({ externalProductId: 'p1', impressions: 5000, clicks: 25, purchases: 0 })
  const insights = buildProductInsights([target, ...baselineCatalog()])
  const fixNow = insights.filter((p) => p.priority === 'fix-now')
  const actions = buildTopActions(fixNow, [], [])
  assert.ok(actions.length > 0)
  const a = actions[0]
  assert.equal(a.rank, 1)
  assert.ok(a.affectedProductCount > 0)
  assert.ok(a.productIds.includes('p1'))
  assert.ok(a.why.length > 0)
  assert.ok(a.investigate.length > 0)
  assert.ok(a.measureNext.length > 0)
  assert.ok(!('evidence' in a), 'TopAction must not carry a duplicated raw-evidence field: full evidence lives once, in Products to Work On First')
})

test('buildTopActions never returns more than 3 actions, even with problems in every named area plus a scale group', () => {
  const conversionTarget = historyRecord({ externalProductId: 'conversion-weak', impressions: 2000, clicks: 80, addToCarts: 20, purchases: 0 })
  const engagementTarget = historyRecord({ externalProductId: 'engagement-weak', impressions: 2000, clicks: 80, addToCarts: 2, purchases: 8 })
  const clickThroughTarget = historyRecord({ externalProductId: 'click-weak', impressions: 5000, clicks: 25, addToCarts: 20, purchases: 8 })
  const records = [conversionTarget, engagementTarget, clickThroughTarget, ...baselineCatalog(10)]
  const insights = buildProductInsights(records)
  const fixNow = insights.filter((p) => p.priority === 'fix-now')
  const optimize = insights.filter((p) => p.priority === 'optimize')
  const scale = insights.filter((p) => p.priority === 'scale')
  const actions = buildTopActions(fixNow, optimize, scale)
  assert.ok(actions.length <= 3)
})

// --- describeWhyPrioritized -------------------------------------------------

test('describeWhyPrioritized for a purchase-conversion product cites real ATC/click numbers, not generic text', () => {
  const target = historyRecord({ externalProductId: 'p1', impressions: 2000, clicks: 80, addToCarts: 20, purchases: 0 })
  const insights = buildProductInsights([target, ...baselineCatalog()])
  const why = describeWhyPrioritized(insights.find((p) => p.externalProductId === 'p1')!)
  assert.match(why, /20 add-to-cart/)
  assert.match(why, /80 clicks/)
})

test('describeWhyPrioritized never falls back to the raw diagnosis message for ANY problem area: the word "healthy" must never leak through (regression, found via live verification)', () => {
  const scenarios: Partial<PerformanceHistoryRecord>[] = [
    { impressions: 2000, clicks: 80, addToCarts: 20, purchases: 0 }, // conversion
    { impressions: 5000, clicks: 25, addToCarts: 20, purchases: 8 }, // click-through
    { impressions: 2000, clicks: 80, addToCarts: 2, purchases: 8 }, // engagement
    { impressions: 2000, clicks: 80, addToCarts: 20, purchases: 8, rating: 2.0 }, // rating
    { impressions: 2000, clicks: 80, addToCarts: 20, purchases: 8, returnRate: 30 }, // returns
    { impressions: 5, clicks: 0, purchases: 0 } // insufficient data
  ]
  for (const [i, overrides] of scenarios.entries()) {
    const target = historyRecord({ externalProductId: `target-${i}`, ...overrides })
    const insights = buildProductInsights([target, ...baselineCatalog()])
    const why = describeWhyPrioritized(insights.find((p) => p.externalProductId === `target-${i}`)!)
    assert.ok(!/healthy/i.test(why), `scenario ${i} leaked "healthy": "${why}"`)
  }
})

// --- describeSegmentInsights -------------------------------------------

test('describeSegmentInsights only surfaces a segment when the CTR deviation from catalog average is material', () => {
  const records = Array.from({ length: 12 }, (_, i) =>
    historyRecord({ externalProductId: `p${i}`, impressions: 1000, clicks: 15, metadata: { articleType: 'Category A', brand: 'Acme Co', gender: 'Unisex' } })
  )
  const current = aggregatePeriod({ periodStart: '2026-08-08', periodEnd: '2026-08-14', periodType: 'weekly', records })
  const segInsights = buildSegmentInsights(records, current, 'articleType')
  const narratives = describeSegmentInsights(segInsights)
  assert.equal(narratives.length, 0)
})

test('describeSegmentInsights never claims causality: only a descriptive comparison against the catalog average', () => {
  const highCtrRecords = Array.from({ length: 12 }, (_, i) => historyRecord({ externalProductId: `hi${i}`, impressions: 1000, clicks: 50, metadata: { articleType: 'Category A' } }))
  const lowCtrRecords = Array.from({ length: 12 }, (_, i) => historyRecord({ externalProductId: `lo${i}`, impressions: 1000, clicks: 2, metadata: { articleType: 'Category B' } }))
  const allRecords = [...highCtrRecords, ...lowCtrRecords]
  const current = aggregatePeriod({ periodStart: '2026-08-08', periodEnd: '2026-08-14', periodType: 'weekly', records: allRecords })
  const segInsights = buildSegmentInsights(allRecords, current, 'articleType')
  const narratives = describeSegmentInsights(segInsights)
  assert.ok(narratives.length > 0)
  for (const n of narratives) assert.ok(!/because|caused by|due to/i.test(n.sentence))
})

// --- generateActionPlan (day/week phases by problem area) ------------------

test('generateActionPlan\'s 15-day plan is organized by problem area with the exact phase focuses from the spec', () => {
  const target = historyRecord({ externalProductId: 'p1', impressions: 2000, clicks: 80, addToCarts: 20, purchases: 0 })
  const insights = buildProductInsights([target, ...baselineCatalog()])
  const plan = generateActionPlan(insights)
  assert.equal(plan.fifteenDay.length, 4)
  assert.match(plan.fifteenDay[0].label, /Days 1-3.*high-intent products with cart activity/i)
  assert.match(plan.fifteenDay[1].label, /Days 4-7.*high-click, low-cart/i)
  assert.match(plan.fifteenDay[2].label, /Days 8-10.*high-impression, low-click/i)
  assert.match(plan.fifteenDay[3].label, /Days 11-15.*[Mm]easure/i)
  assert.match(plan.fifteenDay[0].items[0].title, /p1/)
})

test('generateActionPlan\'s 30-day plan has 4 weeks matching the spec\'s own structure', () => {
  const plan = generateActionPlan([])
  assert.equal(plan.thirtyDay.length, 4)
  assert.match(plan.thirtyDay[0].label, /Week 1.*highest-intent/i)
  assert.match(plan.thirtyDay[1].label, /Week 2.*engagement/i)
  assert.match(plan.thirtyDay[2].label, /Week 3.*[Aa]pply learnings/i)
  assert.match(plan.thirtyDay[3].label, /Week 4.*[Mm]easure and reprioritize/i)
})

test('generateActionPlan never outputs generic filler: every real item names a specific product', () => {
  const target = historyRecord({ externalProductId: 'style-99', impressions: 2000, clicks: 80, addToCarts: 20, purchases: 0 })
  const insights = buildProductInsights([target, ...baselineCatalog()])
  const plan = generateActionPlan(insights)
  const allText = [...plan.fifteenDay, ...plan.thirtyDay].flatMap((p) => p.items).map((i) => `${i.title} ${i.detail}`).join(' ')
  assert.match(allText, /style-99/)
  assert.ok(!/improve your listings/i.test(allText))
})

// --- describeMeasurementPlan (§O) --------------------------------------

test('describeMeasurementPlan ties each measurement statement to a specific top action', () => {
  const target = historyRecord({ externalProductId: 'p1', impressions: 5000, clicks: 25, purchases: 0 })
  const insights = buildProductInsights([target, ...baselineCatalog()])
  const fixNow = insights.filter((p) => p.priority === 'fix-now')
  const actions = buildTopActions(fixNow, [], [])
  const plan = describeMeasurementPlan(actions)
  assert.equal(plan.length, actions.length)
  assert.match(plan[0], new RegExp(actions[0].title))
})

test('describeMeasurementPlan gives an honest fallback when there are no top actions', () => {
  const plan = describeMeasurementPlan([])
  assert.match(plan[0], /continue monitoring/i)
})

// --- buildActionReportText: the 14-section structure (§11) -----------------

function buildTestReport(insights: ReturnType<typeof buildProductInsights>, records: PerformanceHistoryRecord[]) {
  const current = aggregatePeriod({ periodStart: '2026-08-08', periodEnd: '2026-08-14', periodType: 'weekly', records })
  const accountDiagnoses = diagnosePeriodRelative(records)
  const plan = generateActionPlan(insights)
  return buildActionReportText({
    marketplaceLabel: 'Myntra',
    current,
    previous: null,
    periodsAvailable: 1,
    accountDiagnoses,
    trend: null,
    productInsights: insights,
    actionPlan: plan,
    multiPeriodStory: null,
    segmentNarratives: []
  })
}

test('buildActionReportText includes all 14 required sections (§11)', () => {
  const target = historyRecord({ externalProductId: 'target', impressions: 2000, clicks: 80, addToCarts: 20, purchases: 0 })
  const records = [target, ...baselineCatalog()]
  const text = buildTestReport(buildProductInsights(records), records)

  for (const section of [
    '1. EXECUTIVE SUMMARY',
    '2. CURRENT KPI SNAPSHOT',
    '3. CURRENT PERFORMANCE DIAGNOSIS',
    '4. WHERE SHOPPERS ARE BEING LOST',
    '5. WHAT CHANGED',
    '6. CATALOG OPPORTUNITY MAP',
    '7. TOP 3 PRIORITIES',
    '8. PRODUCTS TO WORK ON FIRST',
    '9. POSITIVE PERFORMERS',
    '10. PRODUCTS NOT YET WORTH PRIORITIZING',
    '11. 15-DAY ACTION PLAN',
    '12. 30-DAY ACTION PLAN',
    '13. WHAT TO MEASURE NEXT',
    '14. DATA LIMITATIONS'
  ]) {
    assert.ok(text.includes(section), `missing section: ${section}`)
  }
})

test('buildActionReportText\'s Data Limitations section names what the report does NOT know (§2)', () => {
  const records = [historyRecord()]
  const text = buildTestReport(buildProductInsights(records), records)
  const limitations = text.slice(text.indexOf('14. DATA LIMITATIONS'))
  assert.match(limitations, /advertising performance/i)
  assert.match(limitations, /ROAS/)
  assert.match(limitations, /revenue/i)
  assert.match(limitations, /not confirmed causes/i)
})

test('buildActionReportText caps "Products to Work On First" at 5: never a dump of every product (§I)', () => {
  const targets = Array.from({ length: 20 }, (_, i) =>
    historyRecord({ externalProductId: `style-${i}`, impressions: 5000 - i, clicks: 25, addToCarts: 20, purchases: 0 })
  )
  const records = [...targets, ...baselineCatalog()]
  const text = buildTestReport(buildProductInsights(records), records)
  const section = text.slice(text.indexOf('8. PRODUCTS TO WORK ON FIRST'), text.indexOf('9. POSITIVE PERFORMERS'))
  const mentioned = new Set(section.match(/style-\d+/g) ?? [])
  assert.ok(mentioned.size <= 15, `expected a bounded product list (top 5 + up to 10 optimize), got ${mentioned.size}`)
})

test('buildActionReportText never uses the word "healthy" anywhere in the document', () => {
  const target = historyRecord({ externalProductId: 'target', impressions: 2000, clicks: 80, addToCarts: 20, purchases: 0 })
  const records = [target, ...baselineCatalog()]
  const text = buildTestReport(buildProductInsights(records), records)
  assert.ok(!/healthy/i.test(text))
})

test('buildActionReportText is honest about a single-report account: no fabricated trend', () => {
  const text = buildTestReport([], [historyRecord()])
  assert.match(text, /first performance snapshot/i)
  assert.match(text, /Not enough history yet/i)
})

test('buildActionReportText includes the catalog opportunity map with exactly 5 cohort rows', () => {
  const target = historyRecord({ externalProductId: 'target', impressions: 2000, clicks: 80, addToCarts: 20, purchases: 0 })
  const records = [target, ...baselineCatalog()]
  const text = buildTestReport(buildProductInsights(records), records)
  const section = text.slice(text.indexOf('6. CATALOG OPPORTUNITY MAP'), text.indexOf('7. TOP 3 PRIORITIES'))
  for (const label of ['Purchase Opportunity', 'Engagement Opportunity', 'Visibility Opportunity', 'Positive Signals', 'Insufficient Activity']) {
    assert.ok(section.includes(label), `missing cohort row: ${label}`)
  }
})

test('buildActionReportText\'s "See:" reference in Top 3 Priorities never repeats the full evidence line already shown in section 8 (§ no cross-section repetition)', () => {
  const target = historyRecord({ externalProductId: 'target', impressions: 2000, clicks: 80, addToCarts: 20, purchases: 0 })
  const records = [target, ...baselineCatalog()]
  const text = buildTestReport(buildProductInsights(records), records)
  const topPriorities = text.slice(text.indexOf('7. TOP 3 PRIORITIES'), text.indexOf('8. PRODUCTS TO WORK ON FIRST'))
  assert.ok(!/Evidence:/.test(topPriorities), 'Top 3 Priorities must reference products by ID (See:), not repeat a raw Evidence: line')
})

// --- §19/§20/§23 discipline carried into this file --------------------------

test('this file never claims a proven cause: no "will improve"/"guaranteed"/"caused by" language anywhere', () => {
  const source = readFileSync(join(__dirname, 'performanceNarrative.ts'), 'utf8')
  assert.ok(!/will improve|guaranteed|proven to cause|caused by/i.test(source))
})

test('this file contains no generative-AI/chatbot dependency: deterministic only (§20)', () => {
  const source = readFileSync(join(__dirname, 'performanceNarrative.ts'), 'utf8')
  assert.ok(!/openai|anthropic|groq|generateText|chat\.completions/i.test(source))
})

test('this file never imports lib/credits.ts (§23)', () => {
  const source = readFileSync(join(__dirname, 'performanceNarrative.ts'), 'utf8')
  assert.ok(!/lib\/credits/.test(source))
})

test('this file depends on lib/performanceIntelligence.ts, never the reverse (no circular import)', () => {
  const narrativeSource = readFileSync(join(__dirname, 'performanceNarrative.ts'), 'utf8')
  const intelligenceSource = readFileSync(join(__dirname, 'performanceIntelligence.ts'), 'utf8')
  assert.match(narrativeSource, /from '@\/lib\/performanceIntelligence'/)
  const intelligenceCodeOnly = intelligenceSource
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n')
  assert.ok(!/performanceNarrative/.test(intelligenceCodeOnly), 'performanceIntelligence.ts must never import from performanceNarrative.ts')
})
