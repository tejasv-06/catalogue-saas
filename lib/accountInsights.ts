export const ACTION_PLAN_CATEGORIES = ['ppc', 'listing', 'buybox', 'catalog'] as const
export type ActionPlanCategory = (typeof ACTION_PLAN_CATEGORIES)[number]

export type ActionPlanItem = {
  priority: number
  title: string
  detail: string
  category: ActionPlanCategory
}

export type AccountInsights = {
  accountSnapshot: string[]
  keyOperationalFindings: {
    revenueConcentration: string
    conversionBottleneck: string
    volatility: string
  }
  actionPlan: ActionPlanItem[]
  strategicSummary: string
}

export type AccountInsightsResponse = {
  provider: 'groq' | 'claude'
  insights: AccountInsights
  // Currency/percent/thousands-grouped numbers in the model's output that
  // don't appear verbatim in the verified-stats text it was given — a
  // non-fatal signal that the model may have invented or misremembered a
  // figure, surfaced for human review rather than silently trusted.
  verificationWarnings: string[]
}

// Shape check for endpoints (e.g. the .docx export) that accept an
// already-generated narrative rather than producing one themselves.
export function isAccountInsights(body: unknown): body is AccountInsights {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  const findings = b.keyOperationalFindings as Record<string, unknown> | undefined

  return (
    Array.isArray(b.accountSnapshot) &&
    typeof findings === 'object' &&
    findings !== null &&
    typeof findings.revenueConcentration === 'string' &&
    typeof findings.conversionBottleneck === 'string' &&
    typeof findings.volatility === 'string' &&
    Array.isArray(b.actionPlan) &&
    typeof b.strategicSummary === 'string'
  )
}

// category isn't required for the shape check above (older narratives
// generated before this field existed shouldn't hard-fail elsewhere), but
// display code needs a safe fallback for anything missing or outside the enum.
export function normalizeActionPlanCategory(value: unknown): ActionPlanCategory | null {
  return typeof value === 'string' && (ACTION_PLAN_CATEGORIES as readonly string[]).includes(value)
    ? (value as ActionPlanCategory)
    : null
}
