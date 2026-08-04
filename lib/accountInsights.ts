export type ActionPlanItem = {
  priority: number
  title: string
  detail: string
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
