// Milestone C15: Performance Intelligence "Generate AI Insights" step,
// output shape. Mirrors lib/accountInsights.ts's pattern exactly (same
// established, working shape for a verified-stats-only narrative).

export const PERFORMANCE_ACTION_AREAS = [
  'click-through',
  'product-page-engagement',
  'purchase-conversion',
  'returns',
  'rating',
  'stock-recovery'
] as const
export type PerformanceActionArea = (typeof PERFORMANCE_ACTION_AREAS)[number]

export type PerformanceActionPlanItem = {
  priority: number
  title: string
  detail: string
  area: PerformanceActionArea
}

export type PerformanceAIInsights = {
  summary: string[]
  keyFindings: {
    biggestOpportunity: string
    catalogHealth: string
    trendSignal: string
  }
  actionPlan: PerformanceActionPlanItem[]
  strategicSummary: string
}

export type PerformanceAIInsightsResponse = {
  insights: PerformanceAIInsights
  // Percent/thousands-grouped numbers in the model's output that don't
  // appear verbatim in the verified-stats text it was given: a
  // non-fatal signal the model may have invented or misremembered a
  // figure, surfaced for human review rather than silently trusted.
  verificationWarnings: string[]
}

export function isPerformanceAIInsights(body: unknown): body is PerformanceAIInsights {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  const findings = b.keyFindings as Record<string, unknown> | undefined

  return (
    Array.isArray(b.summary) &&
    typeof findings === 'object' &&
    findings !== null &&
    typeof findings.biggestOpportunity === 'string' &&
    typeof findings.catalogHealth === 'string' &&
    typeof findings.trendSignal === 'string' &&
    Array.isArray(b.actionPlan) &&
    typeof b.strategicSummary === 'string'
  )
}

export function normalizePerformanceActionArea(value: unknown): PerformanceActionArea | null {
  return typeof value === 'string' && (PERFORMANCE_ACTION_AREAS as readonly string[]).includes(value) ? (value as PerformanceActionArea) : null
}
