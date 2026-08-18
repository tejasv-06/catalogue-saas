// Unit tests for lib/performanceDiagnosis.ts. Milestone C15.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { diagnosePerformance, computeTrend, PERFORMANCE_THRESHOLDS } from './performanceDiagnosis'
import type { CanonicalPerformanceRecord } from './performanceAdapters'

function record(overrides: Partial<CanonicalPerformanceRecord> = {}): CanonicalPerformanceRecord {
  return {
    marketplace: 'myntra',
    externalProductId: '1',
    periodStart: '2026-08-01',
    periodEnd: '2026-08-07',
    periodType: 'weekly',
    impressions: null,
    clicks: null,
    addToCarts: null,
    purchases: null,
    revenue: null,
    returns: null,
    returnRate: null,
    rating: null,
    considerationRate: null,
    conversionRate: null,
    ctr: null,
    source: 'myntra_impress_report',
    metadata: null,
    ...overrides
  }
}

function codes(diagnoses: { code: string }[]): string[] {
  return diagnoses.map((d) => d.code)
}

// --- §20 mandatory: diagnosis engine is marketplace-independent ------------

test('the diagnosis engine source contains no marketplace branching at all (mandatory, §20)', () => {
  const source = readFileSync(join(__dirname, 'performanceDiagnosis.ts'), 'utf8')
  // Comment lines legitimately name the forbidden pattern for context
  // (this file's own header explains the rule): only real code lines
  // must never contain it.
  const codeOnly = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n')
  assert.ok(!/marketplace\s*===\s*['"]amazon['"]/.test(codeOnly))
  assert.ok(!/marketplace\s*===\s*['"]myntra['"]/.test(codeOnly))
  assert.ok(!/\.marketplace\b/.test(codeOnly), 'diagnosePerformance/computeTrend must never read record.marketplace at all')
})

test('diagnosePerformance produces byte-identical diagnoses for an amazon record and a myntra record with the same numbers', () => {
  const amazon = record({ marketplace: 'amazon', impressions: 1000, clicks: 3, purchases: 1 })
  const myntra = record({ marketplace: 'myntra', impressions: 1000, clicks: 3, purchases: 1 })
  assert.deepEqual(codes(diagnosePerformance(amazon)), codes(diagnosePerformance(myntra)))
})

// --- §9 centralized, documented thresholds -----------------------------------

test('thresholds are centralized in one exported, documented config: not scattered magic numbers', () => {
  assert.ok(PERFORMANCE_THRESHOLDS.CTR_WEAK_BELOW_PERCENT > 0)
  assert.ok(PERFORMANCE_THRESHOLDS.CONVERSION_WEAK_BELOW_PERCENT > 0)
  assert.ok(PERFORMANCE_THRESHOLDS.RETURN_RATE_HIGH_AT_OR_ABOVE_PERCENT > 0)
})

// --- 21. Insufficient-data diagnosis -----------------------------------------

test('21. INSUFFICIENT_DATA when impressions and clicks are both below their minimum thresholds', () => {
  const r = record({ impressions: 5, clicks: 1 })
  const diagnoses = diagnosePerformance(r)
  assert.ok(codes(diagnoses).includes('INSUFFICIENT_DATA'))
})

test('no other diagnosis fires when there is truly no data at all', () => {
  const r = record()
  const diagnoses = diagnosePerformance(r)
  assert.deepEqual(codes(diagnoses), ['INSUFFICIENT_DATA'])
})

// --- 18. Weak discoverability / CTR diagnosis --------------------------------

test('18. DISCOVERABILITY_WEAK + CTR_WEAK: high impressions, low click-through (§9\'s own worked example)', () => {
  const r = record({ impressions: 10000, clicks: 20 }) // 0.2% CTR
  const diagnoses = diagnosePerformance(r)
  assert.ok(codes(diagnoses).includes('CTR_WEAK'))
  assert.ok(codes(diagnoses).includes('DISCOVERABILITY_WEAK'))
})

test('CTR_HEALTHY + TRAFFIC_HEALTHY when click-through is strong', () => {
  const r = record({ impressions: 1000, clicks: 50 }) // 5% CTR
  const diagnoses = diagnosePerformance(r)
  assert.ok(codes(diagnoses).includes('CTR_HEALTHY'))
  assert.ok(codes(diagnoses).includes('TRAFFIC_HEALTHY'))
})

// --- 19. Weak conversion diagnosis -------------------------------------------

test('19. CONVERSION_WEAK: healthy clicks, low purchases (§9\'s own worked example)', () => {
  const r = record({ impressions: 2000, clicks: 100, purchases: 1 }) // 1% conversion
  const diagnoses = diagnosePerformance(r)
  assert.ok(codes(diagnoses).includes('CONVERSION_WEAK'))
})

test('CONVERSION_HEALTHY when clicks convert well: "strong listing performance" per §9', () => {
  const r = record({ impressions: 2000, clicks: 100, purchases: 15 }) // 15% conversion
  const diagnoses = diagnosePerformance(r)
  assert.ok(codes(diagnoses).includes('CONVERSION_HEALTHY'))
})

test('ATC_WEAK + CONVERSION_WEAK distinguished from high-ATC-but-low-purchase friction (§9\'s own worked example)', () => {
  // High ATC, low purchases -> checkout/offer friction signal specifically.
  const friction = record({ impressions: 2000, clicks: 100, addToCarts: 30, purchases: 1 })
  const diagnoses = diagnosePerformance(friction)
  assert.ok(codes(diagnoses).includes('CONVERSION_WEAK'))
  assert.ok(codes(diagnoses).includes('ATC_HEALTHY'))
})

// --- 20. High return diagnosis -----------------------------------------------

test('20. RETURNS_HIGH when return rate is at/above the documented threshold', () => {
  const r = record({ impressions: 2000, clicks: 100, purchases: 10, returnRate: 25 })
  const diagnoses = diagnosePerformance(r)
  assert.ok(codes(diagnoses).includes('RETURNS_HIGH'))
})

test('no RETURNS_HIGH when return rate is low', () => {
  const r = record({ returnRate: 2 })
  assert.ok(!codes(diagnosePerformance(r)).includes('RETURNS_HIGH'))
})

test('RATING_WEAK fires only for a genuinely low, genuinely reported rating (0 = "no rating data" is excluded, not treated as 0-star)', () => {
  const weak = record({ rating: 2.5 })
  assert.ok(codes(diagnosePerformance(weak)).includes('RATING_WEAK'))
  const noRatingYet = record({ rating: 0 })
  assert.ok(!codes(diagnosePerformance(noRatingYet)).includes('RATING_WEAK'))
})

// --- 15/16/17. Trend calculation, improving/declining ------------------------

test('15. computeTrend returns null when there is no previous period: never fabricates a trend from one data point', () => {
  const current = record({ purchases: 10 })
  assert.equal(computeTrend(current, null), null)
})

test('15. computeTrend calculates percent change for count/rate metrics', () => {
  const previous = record({ impressions: 10000, clicks: 100 })
  const current = record({ impressions: 6000, clicks: 100 })
  const trend = computeTrend(current, previous)!
  assert.equal(trend.impressions.changePercent, -40)
})

test('16. PERFORMANCE_IMPROVING when conversion improves significantly period-over-period', () => {
  const previous = record({ impressions: 5000, clicks: 100, purchases: 2 }) // 2% conversion
  const current = record({ impressions: 5000, clicks: 100, purchases: 4 }) // 4% conversion (+100%)
  const trend = computeTrend(current, previous)!
  assert.equal(trend.diagnosis?.code, 'PERFORMANCE_IMPROVING')
})

test('17. PERFORMANCE_DECLINING when conversion drops significantly period-over-period', () => {
  const previous = record({ impressions: 5000, clicks: 100, purchases: 10 }) // 10% conversion
  const current = record({ impressions: 5000, clicks: 100, purchases: 2 }) // 2% conversion
  const trend = computeTrend(current, previous)!
  assert.equal(trend.diagnosis?.code, 'PERFORMANCE_DECLINING')
})

test('a small, insignificant change produces no improving/declining diagnosis (noise filtering)', () => {
  const previous = record({ impressions: 5000, clicks: 100, purchases: 10 }) // 10%
  const current = record({ impressions: 5000, clicks: 100, purchases: 11 }) // 11% (+10%, below the 15% threshold)
  const trend = computeTrend(current, previous)!
  assert.equal(trend.diagnosis, null)
})

test('rating trend is a plain delta, not a percent (a 0-5 scale has no meaningful "% change")', () => {
  const previous = record({ rating: 3.0 })
  const current = record({ rating: 4.0 })
  const trend = computeTrend(current, previous)!
  assert.equal(trend.rating.changePercent, 1.0)
})

test('a percent change from a previous value of exactly zero is null, never Infinity', () => {
  const previous = record({ impressions: 0 })
  const current = record({ impressions: 500 })
  const trend = computeTrend(current, previous)!
  assert.equal(trend.impressions.changePercent, null)
})
