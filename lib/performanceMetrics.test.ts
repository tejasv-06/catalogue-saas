// Unit tests for lib/performanceMetrics.ts. Milestone C15.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeCtr, computeAtcRate, computeConversionRate, computeNormalizedMetrics } from './performanceMetrics'
import type { CanonicalPerformanceRecord } from './performanceAdapters'

function baseRecord(overrides: Partial<CanonicalPerformanceRecord> = {}): CanonicalPerformanceRecord {
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

// --- 5. CTR calculation ------------------------------------------------------

test('5. computeCtr = clicks / impressions × 100', () => {
  assert.equal(computeCtr(7, 386), (7 / 386) * 100)
  assert.equal(computeCtr(50, 1000), 5)
})

// --- 6. ATC rate calculation --------------------------------------------------

test('6. computeAtcRate = add_to_carts / clicks × 100', () => {
  assert.equal(computeAtcRate(2, 7), (2 / 7) * 100)
  assert.equal(computeAtcRate(5, 20), 25)
})

// --- 7. Conversion calculation -------------------------------------------------

test('7. computeConversionRate = purchases / clicks × 100', () => {
  assert.equal(computeConversionRate(1, 7), (1 / 7) * 100)
  assert.equal(computeConversionRate(3, 30), 10)
})

// --- 8. Zero denominator handling ----------------------------------------------

test('8. every calculated metric returns null (never NaN/Infinity) when its denominator is zero', () => {
  assert.equal(computeCtr(5, 0), null)
  assert.equal(computeAtcRate(5, 0), null)
  assert.equal(computeConversionRate(5, 0), null)
})

test('8. every calculated metric returns null when either input is null', () => {
  assert.equal(computeCtr(null, 100), null)
  assert.equal(computeCtr(5, null), null)
  assert.equal(computeAtcRate(null, 10), null)
  assert.equal(computeConversionRate(5, null), null)
})

test('no calculated metric ever produces NaN or Infinity for any input combination', () => {
  const denominators = [0, -1, null, 1, 1000]
  const numerators = [0, -1, null, 5, 500]
  for (const d of denominators) {
    for (const n of numerators) {
      for (const fn of [computeCtr, computeAtcRate, computeConversionRate]) {
        const result = fn(n, d)
        if (result !== null) {
          assert.ok(Number.isFinite(result), `expected a finite result or null, got ${result} for n=${n}, d=${d}`)
        }
      }
    }
  }
})

// --- Source metric preserved, never overwritten (§8) --------------------------

test('computeNormalizedMetrics preserves a source-supplied conversionRate verbatim — never recalculates over it', () => {
  const record = baseRecord({ purchases: 1, clicks: 7, conversionRate: 14.285714 })
  const normalized = computeNormalizedMetrics(record)
  assert.equal(normalized.conversionRate, 14.285714)
  // Confirm this is NOT what a local recalculation from purchases/clicks
  // would produce a materially different value for, proving the function
  // truly passed the source value through rather than coincidentally
  // recomputing the same number.
  const locallyComputed = computeConversionRate(record.purchases, record.clicks)
  assert.ok(Math.abs(normalized.conversionRate! - locallyComputed!) < 0.001)
})

test('computeNormalizedMetrics computes ctr locally only when the source record has no ctr of its own', () => {
  const record = baseRecord({ clicks: 7, impressions: 386 })
  const normalized = computeNormalizedMetrics(record)
  assert.equal(normalized.ctr, computeCtr(7, 386))
})

test('computeNormalizedMetrics preserves an explicit source ctr instead of recalculating', () => {
  const record = baseRecord({ clicks: 7, impressions: 386, ctr: 99 })
  const normalized = computeNormalizedMetrics(record)
  assert.equal(normalized.ctr, 99)
})

test('computeNormalizedMetrics never fabricates atcRate from anything other than real addToCarts/clicks', () => {
  const record = baseRecord({ addToCarts: null, clicks: 100 })
  assert.equal(computeNormalizedMetrics(record).atcRate, null)
})

test('computeNormalizedMetrics calculates conversionRate from purchases/clicks when the source did not supply one — §8\'s "calculate where raw metrics exist" half, not just the "preserve source" half', () => {
  const record = baseRecord({ purchases: 3, clicks: 30, conversionRate: null })
  const normalized = computeNormalizedMetrics(record)
  assert.equal(normalized.conversionRate, 10)
})
