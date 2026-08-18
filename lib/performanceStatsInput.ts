// Milestone C15: Performance Intelligence "Generate AI Insights" step.
// This is the WIRE SHAPE the client sends to app/api/generate-performance-insights.
// Deliberately a distilled, purpose-built subset of already-computed data
// (lib/performanceIntelligence.ts's AggregateSnapshot/ProductInsight/
// AreaDiagnosisSummary/CohortSummary): never the full ProductInsight
// objects (which embed raw PerformanceHistoryRecord rows via
// .current/.previous) and never raw report rows. Every string field here
// is already-formatted, human-readable evidence text, not a number the
// model could misread as something to recompute.

export type VerifiedProductSummary = {
  externalProductId: string
  bucket: 'P1' | 'P2' | 'P3' | null
  evidence: string
  topProblemArea: string | null
  topProblemMessage: string | null
  recommendedAction: string | null
}

export type VerifiedAreaDiagnosis = {
  area: string
  affectedProductCount: number
  message: string
}

export type VerifiedCohort = { label: string; count: number; description: string }

export type PerformanceStatsInput = {
  marketplaceLabel: string
  periodStart: string
  periodEnd: string
  periodsAvailable: number
  productsAnalyzed: number | null
  impressions: number | null
  clicks: number | null
  ctr: number | null
  addToCarts: number | null
  atcRate: number | null
  purchases: number | null
  conversionRate: number | null
  returnRate: number | null
  rating: number | null
  productsWithSales: number | null
  productsWithNoSales: number | null
  previous: {
    impressions: number | null
    clicks: number | null
    ctr: number | null
    addToCarts: number | null
    purchases: number | null
  } | null
  problemAreas: VerifiedAreaDiagnosis[]
  cohortMap: VerifiedCohort[]
  fixNowTop: VerifiedProductSummary[]
  scaleTop: VerifiedProductSummary[]
}

function isVerifiedProductSummary(v: unknown): v is VerifiedProductSummary {
  if (!v || typeof v !== 'object') return false
  const p = v as Record<string, unknown>
  return typeof p.externalProductId === 'string' && typeof p.evidence === 'string'
}

function isVerifiedAreaDiagnosis(v: unknown): v is VerifiedAreaDiagnosis {
  if (!v || typeof v !== 'object') return false
  const d = v as Record<string, unknown>
  return typeof d.area === 'string' && typeof d.affectedProductCount === 'number' && typeof d.message === 'string'
}

function isVerifiedCohort(v: unknown): v is VerifiedCohort {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return typeof c.label === 'string' && typeof c.count === 'number' && typeof c.description === 'string'
}

export function isPerformanceStatsInput(body: unknown): body is PerformanceStatsInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const b = body as Record<string, unknown>
  return (
    typeof b.marketplaceLabel === 'string' &&
    typeof b.periodStart === 'string' &&
    typeof b.periodEnd === 'string' &&
    typeof b.periodsAvailable === 'number' &&
    Array.isArray(b.problemAreas) &&
    b.problemAreas.every(isVerifiedAreaDiagnosis) &&
    Array.isArray(b.cohortMap) &&
    b.cohortMap.every(isVerifiedCohort) &&
    Array.isArray(b.fixNowTop) &&
    b.fixNowTop.every(isVerifiedProductSummary) &&
    Array.isArray(b.scaleTop) &&
    b.scaleTop.every(isVerifiedProductSummary)
  )
}
