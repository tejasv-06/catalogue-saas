import type { CanonicalPerformanceRecord } from '@/lib/performanceAdapters'

// Milestone C15: §8 Calculated Metrics. Pure functions only, each with
// exactly one job: turn two raw counts into a percentage, or return null
// when that would be undefined/misleading. Never NaN, never Infinity,
// never a fabricated 0 for "no data" (see each function's own comment).

// clicks / impressions × 100
export function computeCtr(clicks: number | null, impressions: number | null): number | null {
  if (clicks === null || impressions === null || impressions <= 0) return null
  return (clicks / impressions) * 100
}

// add_to_carts / clicks × 100
export function computeAtcRate(addToCarts: number | null, clicks: number | null): number | null {
  if (addToCarts === null || clicks === null || clicks <= 0) return null
  return (addToCarts / clicks) * 100
}

// purchases / clicks × 100
export function computeConversionRate(purchases: number | null, clicks: number | null): number | null {
  if (purchases === null || clicks === null || clicks <= 0) return null
  return (purchases / clicks) * 100
}

export type NormalizedMetrics = {
  ctr: number | null
  atcRate: number | null
  conversionRate: number | null
}

// §8: "if the source already supplies a metric... preserve the source
// value. Do not blindly overwrite source metrics with a locally
// calculated value." Every field here follows the same rule: prefer the
// record's own already-set value (Myntra's real Conversion %, Amazon's
// real Unit Session %, either adapter's real ctr if one is ever added) and
// only fall back to a local calculation when the source genuinely didn't
// supply one: never the reverse. `??` (not `||`) so a real, source-
// reported 0 is preserved as 0, never treated as "missing" and
// recalculated over.
export function computeNormalizedMetrics(record: CanonicalPerformanceRecord): NormalizedMetrics {
  return {
    ctr: record.ctr ?? computeCtr(record.clicks, record.impressions),
    atcRate: computeAtcRate(record.addToCarts, record.clicks),
    conversionRate: record.conversionRate ?? computeConversionRate(record.purchases, record.clicks)
  }
}
