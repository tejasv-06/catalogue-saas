import type { AccountReportStats } from '@/lib/accountReportStats'

const LAKH = 100_000
const CRORE = 10_000_000

// Indian numbering convention: amounts of 1 crore+ read as "₹X.XX crore",
// 1 lakh+ as "₹X.XX lakh", and anything smaller as a plain ₹ amount with
// Indian digit grouping (which is identical to Western grouping below 1
// lakh, so this only visibly diverges right where lakh/crore takes over).
export function formatCurrency(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (abs >= CRORE) {
    return `${sign}₹${(abs / CRORE).toFixed(2)} crore`
  }
  if (abs >= LAKH) {
    return `${sign}₹${(abs / LAKH).toFixed(2)} lakh`
  }
  return value.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`
}

// The exact, pre-formatted text the Groq prompt is built from. Every number
// the model is allowed to mention appears here already rounded and
// formatted, so it never has to do its own arithmetic — it only ever copies
// a string that already exists, which is what makes the "never invent a
// number" rule enforceable rather than just requested.
export function buildVerifiedStatsSummary(stats: AccountReportStats): string {
  const lines: string[] = []

  lines.push(`Total active ASINs: ${stats.totalActiveAsinCount}`)
  lines.push(`ASINs with sales: ${stats.asinsWithSales.count} (${formatPercent(stats.asinsWithSales.percent)})`)
  lines.push(`ASINs with zero sales: ${stats.asinsWithZeroSales.count} (${formatPercent(stats.asinsWithZeroSales.percent)})`)
  lines.push(`Total revenue: ${formatCurrency(stats.totalRevenue)}`)
  lines.push(`Total units ordered: ${stats.totalUnitsOrdered}`)
  lines.push(
    `Average order value: ${stats.averageOrderValue !== null ? formatCurrency(stats.averageOrderValue) : 'not available (zero units ordered)'}`
  )
  lines.push(
    `Average Buy Box %: ${stats.averageBuyBoxPercentage !== null ? formatPercent(stats.averageBuyBoxPercentage) : 'not available (no Buy Box data reported)'}`
  )

  const rc = stats.revenueConcentration
  lines.push(
    `Revenue concentration: ${rc.asinCount} ASIN(s) (${formatPercent(rc.percentOfTotalAsins)} of the catalog) account for ${formatPercent(rc.cumulativeRevenuePercent)} of revenue (${formatCurrency(rc.cumulativeRevenue)})`
  )
  if (rc.asins.length > 0) {
    lines.push(`Top revenue ASINs, highest first: ${rc.asins.join(', ')}`)
  }

  lines.push(`Sessions median (typical traffic per ASIN): ${stats.sessionsMedian}`)
  lines.push(`High-traffic, zero-sales ASINs: ${stats.highTrafficZeroSales.length}`)
  for (const row of stats.highTrafficZeroSales.slice(0, 15)) {
    lines.push(
      `  - ${row.asin}${row.sku ? ` (${row.sku})` : ''}: ${row.sessions} sessions, Buy Box ${
        row.buyBoxPercentage !== null ? formatPercent(row.buyBoxPercentage) : 'not available'
      }`
    )
  }
  if (stats.highTrafficZeroSales.length > 15) {
    lines.push(`  ...and ${stats.highTrafficZeroSales.length - 15} more`)
  }

  return lines.join('\n')
}

// Narrow on purpose: only currency amounts (₹ plain or lakh/crore),
// percentages, and thousands-comma numbers — the shapes an invented
// statistic would actually take. Bare small integers ("30-day plan", "3
// steps") are ordinary prose, not stats, and flagging them would just be
// false-positive noise.
export function extractStatTokens(text: string): string[] {
  const matches = text.match(/₹[\d,]+(?:\.\d+)?(?:\s*(?:lakh|crore))?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?%/g)
  return matches ?? []
}

// Collapses formatting-only differences before comparing tokens — e.g. the
// model writing "86%" in a sentence when the verified stats say "86.0%" is
// the same number, not a fabricated one, and shouldn't be flagged. Only
// numeric precision/grouping is normalized here; a genuinely wrong number
// (e.g. "85%" instead of "86.0%") still won't match after normalizing.
export function normalizeStatToken(token: string): string {
  if (token.endsWith('%')) {
    const num = Number(token.slice(0, -1))
    return Number.isFinite(num) ? formatPercent(num) : token
  }

  const lakhMatch = token.match(/^₹([\d,]+(?:\.\d+)?)\s*lakh$/)
  if (lakhMatch) {
    const num = Number(lakhMatch[1].replace(/,/g, ''))
    return Number.isFinite(num) ? `₹${num.toFixed(2)} lakh` : token
  }

  const croreMatch = token.match(/^₹([\d,]+(?:\.\d+)?)\s*crore$/)
  if (croreMatch) {
    const num = Number(croreMatch[1].replace(/,/g, ''))
    return Number.isFinite(num) ? `₹${num.toFixed(2)} crore` : token
  }

  const rupeeMatch = token.match(/^₹([\d,]+(?:\.\d+)?)$/)
  if (rupeeMatch) {
    const num = Number(rupeeMatch[1].replace(/,/g, ''))
    return Number.isFinite(num) ? `₹${num.toFixed(2)}` : token
  }

  return token
}

// All percentage values actually shown to the model in the verified stats
// block — the only figures a "100 minus X" complement could plausibly have
// been derived from.
export function extractVerifiedPercentages(verifiedStatsSummary: string): number[] {
  return extractStatTokens(verifiedStatsSummary)
    .filter((token) => token.endsWith('%'))
    .map((token) => Number(token.slice(0, -1)))
    .filter((value) => Number.isFinite(value))
}

// True if `token` (a flagged percentage) numerically equals 100 minus one of
// the verified percentages — the exact "subtract from 100" arithmetic rule 5
// forbids. Small tolerance absorbs rounding, not genuinely different numbers.
const COMPLEMENT_TOLERANCE = 0.5
export function isDerivedFromComplement(token: string, verifiedPercentages: number[]): boolean {
  if (!token.endsWith('%')) return false
  const value = Number(token.slice(0, -1))
  if (!Number.isFinite(value)) return false

  return verifiedPercentages.some((verified) => Math.abs(100 - verified - value) <= COMPLEMENT_TOLERANCE)
}
