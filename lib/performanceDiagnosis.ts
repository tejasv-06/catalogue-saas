import type { CanonicalPerformanceRecord } from '@/lib/performanceAdapters'
import { computeNormalizedMetrics, type NormalizedMetrics } from '@/lib/performanceMetrics'

// Milestone C15 — §9/§10 Deterministic Diagnosis + Trend Engine.
//
// MARKETPLACE-INDEPENDENT BY CONSTRUCTION: every function below reads only
// CanonicalPerformanceRecord/NormalizedMetrics fields — never
// record.marketplace in a branch. Marketplace-specific knowledge (how to
// get to these canonical numbers in the first place) lives exclusively in
// lib/performanceAdapters.ts; this file must never grow an
// `if (marketplace === 'amazon')` (§20, mandatory).
//
// §9 explicitly requires centralized, documented thresholds instead of
// scattered magic numbers. These are reasonable, disclosed starting
// points (general e-commerce click-through/conversion/return-rate
// benchmarks), NOT derived from this account's own historical data — no
// such baseline exists yet. Revisit once enough real Tesolute performance
// history accumulates to calibrate against actual seller outcomes.
export const PERFORMANCE_THRESHOLDS = {
  // Below this many impressions, a CTR conclusion is statistically noisy
  // (a single extra click swings the percentage wildly) — INSUFFICIENT_DATA
  // instead of a real verdict.
  MIN_IMPRESSIONS_FOR_CTR_JUDGMENT: 100,
  // Below this many clicks, ATC-rate/conversion conclusions are similarly
  // unreliable.
  MIN_CLICKS_FOR_RATE_JUDGMENT: 10,
  CTR_WEAK_BELOW_PERCENT: 0.5,
  CTR_HEALTHY_AT_OR_ABOVE_PERCENT: 1.0,
  CONVERSION_WEAK_BELOW_PERCENT: 5,
  CONVERSION_HEALTHY_AT_OR_ABOVE_PERCENT: 10,
  ATC_WEAK_BELOW_PERCENT: 5,
  ATC_HEALTHY_AT_OR_ABOVE_PERCENT: 15,
  RETURN_RATE_HIGH_AT_OR_ABOVE_PERCENT: 10,
  RATING_WEAK_BELOW: 3.5,
  // A period-over-period move smaller than this is treated as noise, not
  // a real improving/declining signal.
  TREND_SIGNIFICANT_CHANGE_PERCENT: 15
} as const

export type DiagnosisCode =
  | 'DISCOVERABILITY_WEAK'
  | 'TRAFFIC_HEALTHY'
  | 'CTR_WEAK'
  | 'CTR_HEALTHY'
  | 'CONVERSION_WEAK'
  | 'CONVERSION_HEALTHY'
  | 'ATC_WEAK'
  | 'ATC_HEALTHY'
  | 'RETURNS_HIGH'
  | 'RATING_WEAK'
  | 'PERFORMANCE_IMPROVING'
  | 'PERFORMANCE_DECLINING'
  | 'INSUFFICIENT_DATA'

export type Diagnosis = {
  code: DiagnosisCode
  // Higher = more actionable/urgent, used only to order multiple
  // simultaneous diagnoses for display — never changes which codes apply.
  priority: number
  message: string
}

// §9's own worked examples, applied literally:
//   high impressions + low CTR -> weak discoverability/click-through
//   healthy clicks + low purchases -> weak conversion
//   healthy clicks + healthy conversion -> strong listing performance
//   high ATC + low purchases -> checkout/purchase friction
//   high return rate -> expectation/quality mismatch signal
//   insufficient impressions -> insufficient data for conversion conclusions
export function diagnosePerformance(record: CanonicalPerformanceRecord): Diagnosis[] {
  const t = PERFORMANCE_THRESHOLDS
  const normalized = computeNormalizedMetrics(record)
  const diagnoses: Diagnosis[] = []

  const hasEnoughImpressions = record.impressions !== null && record.impressions >= t.MIN_IMPRESSIONS_FOR_CTR_JUDGMENT
  const hasEnoughClicks = record.clicks !== null && record.clicks >= t.MIN_CLICKS_FOR_RATE_JUDGMENT

  if (!hasEnoughImpressions && !hasEnoughClicks) {
    diagnoses.push({
      code: 'INSUFFICIENT_DATA',
      priority: 0,
      message: 'Not enough traffic data yet to draw a reliable performance conclusion for this period.'
    })
  }

  // --- CTR / discoverability ---
  if (hasEnoughImpressions && normalized.ctr !== null) {
    if (normalized.ctr < t.CTR_WEAK_BELOW_PERCENT) {
      diagnoses.push({
        code: 'CTR_WEAK',
        priority: 3,
        message: 'High impressions but low click-through — the listing is being shown but not drawing clicks.'
      })
      diagnoses.push({
        code: 'DISCOVERABILITY_WEAK',
        priority: 3,
        message: 'Weak click-through suggests a discoverability or presentation issue.'
      })
    } else if (normalized.ctr >= t.CTR_HEALTHY_AT_OR_ABOVE_PERCENT) {
      diagnoses.push({
        code: 'CTR_HEALTHY',
        priority: 1,
        message: 'Click-through rate is healthy for the traffic this listing is receiving.'
      })
      diagnoses.push({
        code: 'TRAFFIC_HEALTHY',
        priority: 1,
        message: 'Traffic is converting into clicks at a healthy rate.'
      })
    }
  }

  // --- Add-to-cart ---
  if (hasEnoughClicks && normalized.atcRate !== null) {
    if (normalized.atcRate < t.ATC_WEAK_BELOW_PERCENT) {
      diagnoses.push({
        code: 'ATC_WEAK',
        priority: 2,
        message: 'Clicks are not translating into add-to-carts — shoppers view the listing but rarely add it.'
      })
    } else if (normalized.atcRate >= t.ATC_HEALTHY_AT_OR_ABOVE_PERCENT) {
      diagnoses.push({
        code: 'ATC_HEALTHY',
        priority: 1,
        message: 'A healthy share of clicks are turning into add-to-carts.'
      })
    }
  }

  // --- Conversion ---
  if (hasEnoughClicks && normalized.conversionRate !== null) {
    if (normalized.conversionRate < t.CONVERSION_WEAK_BELOW_PERCENT) {
      diagnoses.push({
        code: 'CONVERSION_WEAK',
        priority: 3,
        message: 'Clicks are healthy but purchases are low relative to clicks.'
      })
      // §9's own explicit example: high ATC + low purchases -> friction.
      if (normalized.atcRate !== null && normalized.atcRate >= t.ATC_HEALTHY_AT_OR_ABOVE_PERCENT) {
        diagnoses.push({
          code: 'CONVERSION_WEAK',
          priority: 4,
          message: 'Shoppers are adding this to cart but not completing the purchase — possible checkout, pricing, or offer friction.'
        })
      }
    } else if (normalized.conversionRate >= t.CONVERSION_HEALTHY_AT_OR_ABOVE_PERCENT) {
      diagnoses.push({
        code: 'CONVERSION_HEALTHY',
        priority: 1,
        message: 'Conversion is healthy — clicks are turning into purchases at a strong rate.'
      })
    }
  }

  // --- Returns ---
  if (record.returnRate !== null && record.returnRate >= t.RETURN_RATE_HIGH_AT_OR_ABOVE_PERCENT) {
    diagnoses.push({
      code: 'RETURNS_HIGH',
      priority: 3,
      message: 'Return rate is unusually high for this period.'
    })
  }

  // --- Rating ---
  if (record.rating !== null && record.rating > 0 && record.rating < t.RATING_WEAK_BELOW) {
    diagnoses.push({
      code: 'RATING_WEAK',
      priority: 2,
      message: 'Product rating is below a healthy threshold.'
    })
  }

  // Deduplicate identical codes (CONVERSION_WEAK can be pushed twice above
  // — once generically, once with the friction-specific message — keep
  // only the more specific/higher-priority one).
  const byCode = new Map<DiagnosisCode, Diagnosis>()
  for (const d of diagnoses) {
    const existing = byCode.get(d.code)
    if (!existing || d.priority > existing.priority) byCode.set(d.code, d)
  }

  return Array.from(byCode.values()).sort((a, b) => b.priority - a.priority)
}

// --- §10 Trend analysis ---------------------------------------------------

export type MetricChange = {
  current: number | null
  previous: number | null
  // Percent change for count/rate metrics; a plain delta for rating
  // (a 0-5 scale, where "% change" isn't a meaningful concept). null
  // whenever either side is null or the previous value is exactly 0 (a
  // percent change from zero is undefined, not "infinite%").
  changePercent: number | null
}

// Exported (not just used internally by computeTrend below) so
// lib/performanceIntelligence.ts's account-wide/multi-period comparisons
// reuse this exact percent-change math instead of a second copy of it.
export function computeChange(current: number | null, previous: number | null): MetricChange {
  if (current === null || previous === null || previous === 0) {
    return { current, previous, changePercent: null }
  }
  return { current, previous, changePercent: ((current - previous) / previous) * 100 }
}

export function computeDelta(current: number | null, previous: number | null): MetricChange {
  if (current === null || previous === null) return { current, previous, changePercent: null }
  return { current, previous, changePercent: current - previous }
}

export type TrendResult = {
  impressions: MetricChange
  clicks: MetricChange
  ctr: MetricChange
  addToCarts: MetricChange
  purchases: MetricChange
  conversionRate: MetricChange
  returns: MetricChange
  rating: MetricChange
  diagnosis: Diagnosis | null
}

// §10 — "Do not call something 'improving' or 'declining' unless
// sufficient historical data exists." Requires a genuine previous period;
// returns null (not a fabricated "stable") when there isn't one.
export function computeTrend(current: CanonicalPerformanceRecord, previous: CanonicalPerformanceRecord | null): TrendResult | null {
  if (!previous) return null

  const currentNormalized = computeNormalizedMetrics(current)
  const previousNormalized = computeNormalizedMetrics(previous)

  const trend: Omit<TrendResult, 'diagnosis'> = {
    impressions: computeChange(current.impressions, previous.impressions),
    clicks: computeChange(current.clicks, previous.clicks),
    ctr: computeChange(currentNormalized.ctr, previousNormalized.ctr),
    addToCarts: computeChange(current.addToCarts, previous.addToCarts),
    purchases: computeChange(current.purchases, previous.purchases),
    conversionRate: computeChange(currentNormalized.conversionRate, previousNormalized.conversionRate),
    returns: computeChange(current.returns, previous.returns),
    rating: computeDelta(current.rating, previous.rating)
  }

  const t = PERFORMANCE_THRESHOLDS.TREND_SIGNIFICANT_CHANGE_PERCENT
  // The single most decision-relevant signal — conversion and purchases
  // are weighted over impressions/clicks, matching §10's own example
  // ("Discoverability declined, but conversion improved" — purchases/
  // conversion is the headline, traffic is supporting context).
  const conversionChange = trend.conversionRate.changePercent
  const purchasesChange = trend.purchases.changePercent

  let diagnosis: Diagnosis | null = null
  if (conversionChange !== null && conversionChange >= t) {
    diagnosis = { code: 'PERFORMANCE_IMPROVING', priority: 2, message: 'Conversion improved compared with the previous period.' }
  } else if (conversionChange !== null && conversionChange <= -t) {
    diagnosis = { code: 'PERFORMANCE_DECLINING', priority: 2, message: 'Conversion declined compared with the previous period.' }
  } else if (purchasesChange !== null && purchasesChange >= t) {
    diagnosis = { code: 'PERFORMANCE_IMPROVING', priority: 1, message: 'Purchases increased compared with the previous period.' }
  } else if (purchasesChange !== null && purchasesChange <= -t) {
    diagnosis = { code: 'PERFORMANCE_DECLINING', priority: 1, message: 'Purchases decreased compared with the previous period.' }
  }

  return { ...trend, diagnosis }
}
