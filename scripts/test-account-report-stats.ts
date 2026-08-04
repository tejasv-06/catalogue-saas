// Temporary/throwaway: run computeAccountReportStats against a real Amazon
// "Detail Page Sales and Traffic by Child Item" CSV export and print the raw
// numbers to the console, ahead of any UI being built around them.
//
// Usage: npx tsx scripts/test-account-report-stats.ts path/to/report.csv

import { readFileSync } from 'fs'
import Papa from 'papaparse'
import { computeAccountReportStats } from '../lib/accountReportStats'

const csvPath = process.argv[2]
if (!csvPath) {
  console.error('Usage: npx tsx scripts/test-account-report-stats.ts path/to/report.csv')
  process.exit(1)
}

const csvText = readFileSync(csvPath, 'utf-8')
const parsed = Papa.parse<Record<string, string>>(csvText, {
  header: true,
  skipEmptyLines: true
})

if (parsed.errors.length > 0) {
  console.warn(`${parsed.errors.length} row(s) had parse warnings:`)
  console.warn(parsed.errors.slice(0, 5))
}

const stats = computeAccountReportStats(parsed.data)

console.log('\n=== Account Report Stats ===\n')

console.log(`Total active ASINs: ${stats.totalActiveAsinCount}`)
console.log(
  `ASINs with sales: ${stats.asinsWithSales.count} (${stats.asinsWithSales.percent.toFixed(1)}%)`
)
console.log(
  `ASINs with zero sales: ${stats.asinsWithZeroSales.count} (${stats.asinsWithZeroSales.percent.toFixed(1)}%)`
)

console.log(`\nTotal revenue (Ordered Product Sales): $${stats.totalRevenue.toFixed(2)}`)
console.log(`Total units ordered: ${stats.totalUnitsOrdered}`)
console.log(
  `Average order value: ${stats.averageOrderValue !== null ? `$${stats.averageOrderValue.toFixed(2)}` : 'n/a (no units ordered)'}`
)

console.log(
  `\nAverage Buy Box %: ${stats.averageBuyBoxPercentage !== null ? `${stats.averageBuyBoxPercentage.toFixed(1)}%` : 'n/a (no Buy Box data found)'}`
)

const rc = stats.revenueConcentration
console.log(
  `\nRevenue concentration: ${rc.asinCount} ASIN(s) (${rc.percentOfTotalAsins.toFixed(1)}% of ASINs) ` +
    `account for ${rc.cumulativeRevenuePercent.toFixed(1)}% of revenue ($${rc.cumulativeRevenue.toFixed(2)})`
)
console.log(`Top ASINs: ${rc.asins.slice(0, 10).join(', ')}${rc.asins.length > 10 ? ', ...' : ''}`)

console.log(`\nSessions median: ${stats.sessionsMedian}`)
console.log(`High traffic / zero sales ASINs: ${stats.highTrafficZeroSales.length}`)
for (const row of stats.highTrafficZeroSales.slice(0, 20)) {
  console.log(
    `  ${row.asin}${row.sku ? ` (${row.sku})` : ''} — sessions: ${row.sessions}, ` +
      `page views: ${row.pageViews ?? 'n/a'}, Buy Box: ${row.buyBoxPercentage !== null ? `${row.buyBoxPercentage}%` : 'n/a'}`
  )
}
if (stats.highTrafficZeroSales.length > 20) {
  console.log(`  ...and ${stats.highTrafficZeroSales.length - 20} more`)
}

console.log('')
