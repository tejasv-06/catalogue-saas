import type { PerformanceStatsInput } from '@/lib/performanceStatsInput'

// Milestone C15 — Performance Intelligence "Generate AI Insights" step.
// The exact, pre-formatted text the Groq prompt is built from — same
// discipline as lib/formatAccountStats.ts's buildVerifiedStatsSummary:
// every number the model is allowed to mention already exists here,
// pre-rounded and pre-formatted, so "copy it verbatim" is an enforceable
// rule rather than a request.
//
// Numbers are grouped Western-style (toLocaleString('en-US'), e.g.
// "123,456") rather than this app's usual Indian grouping ("1,23,456") —
// deliberately, because lib/formatAccountStats.ts's extractStatTokens
// (reused as-is below for verification) only recognizes comma groups of
// exactly 3 digits. A catalog-wide impression/click total can run well
// into 6+ digits, so this keeps large aggregate counts verifiable instead
// of silently falling outside the regex both when building the allowed
// list and when checking the model's output.
function fmtNum(value: number | null): string {
  if (value === null) return 'not available'
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmtPct(value: number | null, digits = 2): string {
  if (value === null) return 'not available'
  return `${value.toFixed(digits)}%`
}

export function buildVerifiedPerformanceStatsSummary(input: PerformanceStatsInput): string {
  const lines: string[] = []

  lines.push(`Marketplace: ${input.marketplaceLabel}`)
  lines.push(`Reporting period: ${input.periodStart} to ${input.periodEnd}`)
  lines.push(`Reports analyzed: ${input.periodsAvailable}`)
  lines.push(`Products analyzed: ${fmtNum(input.productsAnalyzed)}`)
  lines.push(`Impressions: ${fmtNum(input.impressions)}`)
  lines.push(`Clicks: ${fmtNum(input.clicks)}`)
  lines.push(`CTR: ${fmtPct(input.ctr)}`)
  lines.push(`Add to carts: ${fmtNum(input.addToCarts)}`)
  lines.push(`Cart rate: ${fmtPct(input.atcRate)}`)
  lines.push(`Purchases: ${fmtNum(input.purchases)}`)
  lines.push(`Purchase conversion: ${fmtPct(input.conversionRate)}`)
  lines.push(`Return rate: ${fmtPct(input.returnRate)}`)
  lines.push(`Average rating: ${input.rating !== null ? input.rating.toFixed(1) : 'not available'}`)
  lines.push(`Products with sales: ${fmtNum(input.productsWithSales)}`)
  lines.push(`Products with no sales: ${fmtNum(input.productsWithNoSales)}`)

  if (input.previous) {
    lines.push('')
    lines.push('Change vs previous period (this is the ONLY period comparison available - do not imply a longer trend than this):')
    lines.push(`  Impressions: ${fmtNum(input.previous.impressions)} -> ${fmtNum(input.impressions)}`)
    lines.push(`  Clicks: ${fmtNum(input.previous.clicks)} -> ${fmtNum(input.clicks)}`)
    lines.push(`  CTR: ${fmtPct(input.previous.ctr)} -> ${fmtPct(input.ctr)}`)
    lines.push(`  Add to carts: ${fmtNum(input.previous.addToCarts)} -> ${fmtNum(input.addToCarts)}`)
    lines.push(`  Purchases: ${fmtNum(input.previous.purchases)} -> ${fmtNum(input.purchases)}`)
  } else {
    lines.push('')
    lines.push('No previous period available - this is the first snapshot, there is no trend data.')
  }

  lines.push('')
  lines.push("Problem areas this period, already computed relative to this catalog's own median (ranked by fix-order priority, most urgent first):")
  if (input.problemAreas.length === 0) {
    lines.push('  None identified - no catalog-relative problem area crossed this report\'s own thresholds.')
  } else {
    for (const d of input.problemAreas) {
      lines.push(`  - ${d.area}: ${d.affectedProductCount} product(s) affected. ${d.message}`)
    }
  }

  lines.push('')
  lines.push('Catalog Opportunity Map:')
  for (const row of input.cohortMap) {
    lines.push(`  - ${row.label}: ${row.count} products - ${row.description}`)
  }

  lines.push('')
  lines.push(`Highest-priority products (fix-now), ${input.fixNowTop.length} shown:`)
  if (input.fixNowTop.length === 0) {
    lines.push('  None identified this period.')
  }
  for (const p of input.fixNowTop) {
    const problem = p.topProblemArea ? `${p.topProblemArea}: ${p.topProblemMessage}` : 'no specific problem area identified'
    lines.push(`  - ${p.externalProductId}${p.bucket ? ` [${p.bucket}]` : ''}: ${p.evidence} Top problem: ${problem}`)
  }

  lines.push('')
  lines.push(`Positive performers, ${input.scaleTop.length} shown:`)
  if (input.scaleTop.length === 0) {
    lines.push('  None identified this period.')
  }
  for (const p of input.scaleTop) {
    lines.push(`  - ${p.externalProductId}: ${p.evidence}`)
  }

  return lines.join('\n')
}
