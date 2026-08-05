import { pick } from '@/lib/csvMapping'

export type AccountReportRow = Record<string, string>

export type ParsedAsinRow = {
  asin: string
  title: string | null
  sku: string | null
  sessions: number | null
  pageViews: number | null
  buyBoxPercentage: number | null
  unitsOrdered: number
  unitSessionPercentage: number | null
  orderedProductSales: number
  averageSellingPrice: number | null
}

export type RevenueConcentration = {
  asinCount: number
  percentOfTotalAsins: number
  cumulativeRevenue: number
  cumulativeRevenuePercent: number
  asins: string[]
}

export type HighTrafficZeroSalesAsin = {
  asin: string
  title: string | null
  sku: string | null
  sessions: number
  pageViews: number | null
  buyBoxPercentage: number | null
}

export type AccountReportStats = {
  totalActiveAsinCount: number
  asinsWithSales: { count: number; percent: number }
  asinsWithZeroSales: { count: number; percent: number }
  totalRevenue: number
  totalUnitsOrdered: number
  averageOrderValue: number | null
  averageBuyBoxPercentage: number | null
  revenueConcentration: RevenueConcentration
  sessionsMedian: number
  highTrafficZeroSales: HighTrafficZeroSalesAsin[]
  // Full per-ASIN rows, for consumers (e.g. dashboard charts) that need more
  // than the pre-aggregated fields above — revenueConcentration.asins only
  // lists the ASINs making up the top 80%, not their values.
  asinRows: ParsedAsinRow[]
}

// Amazon report exports format numbers as "$1,234.56", "45.67%", "1,234" —
// strip the currency/percent/thousands punctuation and parse what's left.
export function parseAmazonNumber(value: string | null): number | null {
  if (value === null) return null
  const cleaned = value.replace(/[$,%]/g, '').trim()
  if (cleaned === '' || cleaned === '-') return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

export function parseAccountReportRow(row: AccountReportRow): ParsedAsinRow | null {
  const asin = pick(row, 'Child ASIN', 'ASIN')
  if (!asin) return null

  return {
    asin,
    title: pick(row, 'Title', 'Product Title'),
    sku: pick(row, 'SKU'),
    sessions: parseAmazonNumber(pick(row, 'Sessions - Total', 'Sessions')),
    pageViews: parseAmazonNumber(pick(row, 'Page Views - Total', 'Page Views')),
    buyBoxPercentage: parseAmazonNumber(
      pick(row, 'Featured Offer (Buy Box) Percentage', 'Buy Box Percentage')
    ),
    // Missing Units Ordered/Ordered Product Sales means Amazon reported no
    // activity for that ASIN in the period, not "unknown" — treat as 0 so
    // revenue/units totals and the zero-sales split stay accurate.
    unitsOrdered: parseAmazonNumber(pick(row, 'Units Ordered')) ?? 0,
    unitSessionPercentage: parseAmazonNumber(pick(row, 'Unit Session Percentage')),
    orderedProductSales: parseAmazonNumber(pick(row, 'Ordered Product Sales')) ?? 0,
    averageSellingPrice: parseAmazonNumber(pick(row, 'Average Selling Price'))
  }
}

function percentOf(count: number, total: number): number {
  return total > 0 ? (count / total) * 100 : 0
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function computeRevenueConcentration(
  rows: ParsedAsinRow[],
  totalRevenue: number
): RevenueConcentration {
  const asins: string[] = []
  let cumulativeRevenue = 0

  if (totalRevenue > 0) {
    const sorted = [...rows].sort((a, b) => b.orderedProductSales - a.orderedProductSales)
    const threshold = totalRevenue * 0.8

    for (const row of sorted) {
      if (cumulativeRevenue >= threshold) break
      cumulativeRevenue += row.orderedProductSales
      asins.push(row.asin)
    }
  }

  return {
    asinCount: asins.length,
    percentOfTotalAsins: percentOf(asins.length, rows.length),
    cumulativeRevenue,
    cumulativeRevenuePercent: percentOf(cumulativeRevenue, totalRevenue),
    asins
  }
}

export function computeAccountReportStats(rows: AccountReportRow[]): AccountReportStats {
  const parsedRows = rows
    .map(parseAccountReportRow)
    .filter((row): row is ParsedAsinRow => row !== null)

  const totalActiveAsinCount = parsedRows.length
  const withSales = parsedRows.filter((row) => row.unitsOrdered > 0)
  const zeroSales = parsedRows.filter((row) => row.unitsOrdered === 0)

  const totalRevenue = parsedRows.reduce((sum, row) => sum + row.orderedProductSales, 0)
  const totalUnitsOrdered = parsedRows.reduce((sum, row) => sum + row.unitsOrdered, 0)
  const averageOrderValue = totalUnitsOrdered > 0 ? totalRevenue / totalUnitsOrdered : null

  const buyBoxValues = parsedRows
    .map((row) => row.buyBoxPercentage)
    .filter((value): value is number => value !== null)
  const averageBuyBoxPercentage =
    buyBoxValues.length > 0
      ? buyBoxValues.reduce((sum, value) => sum + value, 0) / buyBoxValues.length
      : null

  // Missing Sessions is treated as 0 traffic for both the median and the
  // high-traffic comparison, consistent with the Units Ordered treatment above.
  const sessionsMedian = median(parsedRows.map((row) => row.sessions ?? 0))
  const highTrafficZeroSales: HighTrafficZeroSalesAsin[] = parsedRows
    .filter((row) => (row.sessions ?? 0) > sessionsMedian && row.unitsOrdered === 0)
    .sort((a, b) => (b.sessions ?? 0) - (a.sessions ?? 0))
    .map((row) => ({
      asin: row.asin,
      title: row.title,
      sku: row.sku,
      sessions: row.sessions ?? 0,
      pageViews: row.pageViews,
      buyBoxPercentage: row.buyBoxPercentage
    }))

  return {
    totalActiveAsinCount,
    asinsWithSales: { count: withSales.length, percent: percentOf(withSales.length, totalActiveAsinCount) },
    asinsWithZeroSales: { count: zeroSales.length, percent: percentOf(zeroSales.length, totalActiveAsinCount) },
    totalRevenue,
    totalUnitsOrdered,
    averageOrderValue,
    averageBuyBoxPercentage,
    revenueConcentration: computeRevenueConcentration(parsedRows, totalRevenue),
    sessionsMedian,
    highTrafficZeroSales,
    asinRows: parsedRows
  }
}

// Shared shape check for any endpoint that must only ever accept the
// verified output of computeAccountReportStats — never raw CSV rows (which
// arrive as an array and fail immediately) or another shape.
export function isAccountReportStats(body: unknown): body is AccountReportStats {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const b = body as Record<string, unknown>
  return (
    typeof b.totalActiveAsinCount === 'number' &&
    typeof b.totalRevenue === 'number' &&
    typeof b.revenueConcentration === 'object' &&
    b.revenueConcentration !== null &&
    Array.isArray(b.asinRows) &&
    Array.isArray(b.highTrafficZeroSales)
  )
}
