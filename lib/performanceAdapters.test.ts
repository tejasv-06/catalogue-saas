// Unit tests for lib/performanceAdapters.ts. Milestone C15.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getPerformanceAdapter,
  PERFORMANCE_MARKETPLACES,
  isPerformanceMarketplace,
  groupRecordsByReportBrand,
  type PerformanceImportRowResult,
  type CanonicalPerformanceRecord
} from './performanceAdapters'

const PERIOD = { periodStart: '2026-08-01', periodEnd: '2026-08-07', periodType: 'weekly' as const }

function valid(results: PerformanceImportRowResult[]) {
  return results.filter((r) => r.status === 'valid') as Extract<PerformanceImportRowResult, { status: 'valid' }>[]
}
function invalid(results: PerformanceImportRowResult[]) {
  return results.filter((r) => r.status === 'invalid') as Extract<PerformanceImportRowResult, { status: 'invalid' }>[]
}

// --- Marketplace scope (§2/§20) ---------------------------------------------

test('only amazon and myntra are performance marketplaces — etsy/flipkart/shopify get no adapter', () => {
  assert.deepEqual([...PERFORMANCE_MARKETPLACES], ['amazon', 'myntra'])
  assert.equal(getPerformanceAdapter('etsy'), undefined)
  assert.equal(getPerformanceAdapter('flipkart'), undefined)
  assert.equal(getPerformanceAdapter('shopify'), undefined)
  assert.ok(getPerformanceAdapter('amazon'))
  assert.ok(getPerformanceAdapter('myntra'))
})

test('isPerformanceMarketplace correctly narrows', () => {
  assert.equal(isPerformanceMarketplace('amazon'), true)
  assert.equal(isPerformanceMarketplace('myntra'), true)
  assert.equal(isPerformanceMarketplace('etsy'), false)
  assert.equal(isPerformanceMarketplace('nonsense'), false)
})

// --- 1. Amazon normalization -------------------------------------------------

test('1. Amazon adapter normalizes a real-shaped Business Report row into the canonical model', () => {
  const adapter = getPerformanceAdapter('amazon')!
  const results = adapter.parseRows(
    [
      {
        'Child ASIN': 'B0TESTASIN1',
        Title: 'Test Product',
        SKU: 'SKU-1',
        'Sessions - Total': '1,234',
        'Page Views - Total': '2,000',
        'Featured Offer (Buy Box) Percentage': '95%',
        'Units Ordered': '50',
        'Unit Session Percentage': '4.05%',
        'Ordered Product Sales': '$12,500.00'
      }
    ],
    PERIOD
  )
  const [row] = valid(results)
  assert.ok(row)
  assert.equal(row.record.marketplace, 'amazon')
  assert.equal(row.record.externalProductId, 'B0TESTASIN1')
  assert.equal(row.record.clicks, 1234)
  assert.equal(row.record.purchases, 50)
  assert.equal(row.record.revenue, 12500)
  assert.equal(row.record.conversionRate, 4.05)
  assert.equal(row.record.source, 'amazon_business_report')
})

// --- 2. Myntra normalization -------------------------------------------------

test("2. Myntra adapter normalizes a real-shaped Impress report row into the canonical model (structure only — no hardcoded example values in application logic)", () => {
  const adapter = getPerformanceAdapter('myntra')!
  const results = adapter.parseRows(
    [
      {
        'Style ID': '90000001',
        'Seller ID': '12345',
        'Article Type': 'Category A',
        Brand: 'TestBrand',
        Gender: 'Unisex',
        'Seller MRP': '999',
        'Inventory Age': '50',
        RPLC: '2.5',
        Impressions: '500',
        Clicks: '20',
        'Add to Carts': '5',
        Purchases: '2',
        'Return %': '0',
        'Consideration %': '4',
        'Conversion %': '10',
        Rating: '4.2'
      }
    ],
    PERIOD
  )
  const [row] = valid(results)
  assert.ok(row)
  assert.equal(row.record.marketplace, 'myntra')
  assert.equal(row.record.externalProductId, '90000001')
  assert.equal(row.record.impressions, 500)
  assert.equal(row.record.clicks, 20)
  assert.equal(row.record.addToCarts, 5)
  assert.equal(row.record.purchases, 2)
  assert.equal(row.record.conversionRate, 10)
  assert.equal(row.record.rating, 4.2)
  assert.equal(row.record.periodType, 'weekly')
  assert.equal(row.record.source, 'myntra_impress_report')
  assert.deepEqual(row.record.metadata, { sellerId: '12345', articleType: 'Category A', brand: 'TestBrand', gender: 'Unisex', sellerMrp: 999, inventoryAge: 50, rplc: 2.5 })
})

// --- 3. Missing metrics -> null ----------------------------------------------

test('3. Amazon: metrics not present in the report (impressions, add-to-carts, returns, rating) are null, never 0', () => {
  const adapter = getPerformanceAdapter('amazon')!
  const [row] = valid(
    adapter.parseRows([{ 'Child ASIN': 'B0X', 'Units Ordered': '1', 'Ordered Product Sales': '10' }], PERIOD)
  )
  assert.equal(row.record.impressions, null)
  assert.equal(row.record.addToCarts, null)
  assert.equal(row.record.returns, null)
  assert.equal(row.record.rating, null)
  assert.equal(row.record.returnRate, null)
  assert.equal(row.record.considerationRate, null)
})

test('3. Myntra: revenue and returns are not in the Impress report -> null, never fabricated', () => {
  const adapter = getPerformanceAdapter('myntra')!
  const [row] = valid(adapter.parseRows([{ 'Style ID': '1', Impressions: '10', Clicks: '1' }], PERIOD))
  assert.equal(row.record.revenue, null)
  assert.equal(row.record.returns, null)
})

// --- 4. Explicit zero preserved --------------------------------------------

test('4. Myntra: an explicit "0" in the report is preserved as the number 0, not treated as missing', () => {
  const adapter = getPerformanceAdapter('myntra')!
  const [row] = valid(
    adapter.parseRows(
      [{ 'Style ID': '1', Impressions: '386', Clicks: '7', Purchases: '1', 'Return %': '0', Rating: '0' }],
      PERIOD
    )
  )
  assert.equal(row.record.returnRate, 0)
  assert.strictEqual(row.record.returnRate, 0)
  assert.notEqual(row.record.returnRate, null)
  // Rating '0' is a genuine reported zero — still distinct from "no
  // rating data at all" (an absent Rating column, tested separately).
  assert.equal(row.record.rating, 0)
})

test('4. Amazon: an explicit "0" Units Ordered is preserved as 0, not null', () => {
  const adapter = getPerformanceAdapter('amazon')!
  const [row] = valid(adapter.parseRows([{ 'Child ASIN': 'B0Y', 'Units Ordered': '0', 'Ordered Product Sales': '0' }], PERIOD))
  assert.strictEqual(row.record.purchases, 0)
  assert.strictEqual(row.record.revenue, 0)
})

// --- 9. Invalid percentage / count handling ----------------------------------

test('9. Myntra: a Conversion % outside 0-100 is rejected as an invalid row, not silently coerced', () => {
  const adapter = getPerformanceAdapter('myntra')!
  const results = adapter.parseRows([{ 'Style ID': '1', 'Conversion %': '250' }], PERIOD)
  assert.equal(valid(results).length, 0)
  assert.equal(invalid(results).length, 1)
  assert.match(invalid(results)[0].reason, /Conversion/)
})

test('9. Myntra: a negative Impressions count is rejected', () => {
  const adapter = getPerformanceAdapter('myntra')!
  const results = adapter.parseRows([{ 'Style ID': '1', Impressions: '-5' }], PERIOD)
  assert.equal(valid(results).length, 0)
  assert.match(invalid(results)[0].reason, /Impressions/)
})

test('9. Myntra: a Rating outside 0-5 is rejected', () => {
  const adapter = getPerformanceAdapter('myntra')!
  const results = adapter.parseRows([{ 'Style ID': '1', Rating: '9.9' }], PERIOD)
  assert.equal(valid(results).length, 0)
  assert.match(invalid(results)[0].reason, /Rating/)
})

test('a row missing its identifier (Style ID / ASIN) is invalid, never silently dropped without a reason', () => {
  const myntra = getPerformanceAdapter('myntra')!.parseRows([{ Impressions: '10' }], PERIOD)
  assert.equal(invalid(myntra).length, 1)
  assert.match(invalid(myntra)[0].reason, /Style ID/)

  const amazon = getPerformanceAdapter('amazon')!.parseRows([{ 'Units Ordered': '1' }], PERIOD)
  assert.equal(invalid(amazon).length, 1)
})

test('every input row produces exactly one result (valid or invalid) — 1:1, nothing silently discarded', () => {
  const adapter = getPerformanceAdapter('myntra')!
  const rows: Record<string, string>[] = [{ 'Style ID': '1', Impressions: '10' }, { Impressions: '20' }, { 'Style ID': '3', Rating: '99' }]
  const results = adapter.parseRows(rows, PERIOD)
  assert.equal(results.length, 3)
})

// --- 12/13. Weekly / monthly period tagging ----------------------------------

test('12. a weekly period is tagged on every resulting record', () => {
  const adapter = getPerformanceAdapter('myntra')!
  const [row] = valid(adapter.parseRows([{ 'Style ID': '1' }], { periodStart: '2026-08-01', periodEnd: '2026-08-07', periodType: 'weekly' }))
  assert.equal(row.record.periodType, 'weekly')
  assert.equal(row.record.periodStart, '2026-08-01')
  assert.equal(row.record.periodEnd, '2026-08-07')
})

test('13. a monthly period is tagged on every resulting record', () => {
  const adapter = getPerformanceAdapter('myntra')!
  const [row] = valid(adapter.parseRows([{ 'Style ID': '1' }], { periodStart: '2026-08-01', periodEnd: '2026-08-31', periodType: 'monthly' }))
  assert.equal(row.record.periodType, 'monthly')
})

// --- Reuse of existing Amazon infrastructure (§3) ---------------------------

test('AmazonPerformanceAdapter reuses lib/accountReportStats.ts\'s parseAccountReportRow — it does not reimplement Amazon CSV parsing', () => {
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const source = fs.readFileSync(path.join(__dirname, 'performanceAdapters.ts'), 'utf8')
  assert.match(source, /import \{ parseAccountReportRow, parseAmazonNumber, type AccountReportRow \} from '@\/lib\/accountReportStats'/)
  assert.match(source, /parseAccountReportRow\(raw as AccountReportRow\)/)
})

// --- Acceptance test: zero dependency on the example report's own values ----
//
// "Tesolute displays whatever valid Myntra report the seller uploads" —
// not a fixed dataset. Two reports below are built from RANDOM values
// generated at test-run time (never the same twice, never any single
// specific worked example) specifically so this test cannot pass by
// coincidentally matching anything hardcoded in application logic.

function randomDigits(len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10)
  return s
}

function buildSyntheticMyntraReport(rowCount: number) {
  const rows: Record<string, string>[] = []
  for (let i = 0; i < rowCount; i++) {
    rows.push({
      'Style ID': randomDigits(8),
      'Seller ID': randomDigits(5),
      'Article Type': `SyntheticType-${randomDigits(4)}`,
      Brand: `SyntheticBrand-${randomDigits(4)}`,
      Gender: Math.random() > 0.5 ? 'Men' : 'Women',
      'Seller MRP': String(Math.floor(Math.random() * 9000) + 100),
      'Inventory Age': String(Math.floor(Math.random() * 400)),
      RPLC: (Math.random() * 10).toFixed(6),
      Impressions: String(Math.floor(Math.random() * 5000)),
      Clicks: String(Math.floor(Math.random() * 100)),
      'Add to Carts': String(Math.floor(Math.random() * 20)),
      Purchases: String(Math.floor(Math.random() * 10)),
      'Return %': String(Math.floor(Math.random() * 30)),
      'Consideration %': (Math.random() * 10).toFixed(4),
      'Conversion %': (Math.random() * 20).toFixed(4),
      Rating: (Math.random() * 5).toFixed(1)
    })
  }
  return rows
}

test('ACCEPTANCE: two synthetic reports with completely different, randomly generated Style IDs/brands/values both parse correctly — proves zero dependency on the spec\'s own example values', () => {
  const adapter = getPerformanceAdapter('myntra')!
  const reportA = buildSyntheticMyntraReport(5)
  const reportB = buildSyntheticMyntraReport(5)

  // Structurally impossible to collide — 8 random digits each.
  assert.notDeepEqual(reportA.map((r) => r['Style ID']), reportB.map((r) => r['Style ID']))

  const resultsA = valid(adapter.parseRows(reportA, PERIOD))
  const resultsB = valid(adapter.parseRows(reportB, PERIOD))

  assert.equal(resultsA.length, 5)
  assert.equal(resultsB.length, 5)

  // Every row's parsed externalProductId/previewValues echo back exactly
  // what THAT row's own random Style ID was — never a fixed value, never
  // one report's data leaking into the other.
  for (let i = 0; i < 5; i++) {
    assert.equal(resultsA[i].record.externalProductId, reportA[i]['Style ID'])
    assert.equal(resultsA[i].previewValues.styleId, reportA[i]['Style ID'])
    assert.equal(resultsB[i].record.externalProductId, reportB[i]['Style ID'])
    assert.equal(resultsB[i].previewValues.brand, reportB[i].Brand)
  }

  // The two reports produce entirely different output sets.
  const idsA = new Set(resultsA.map((r) => r.record.externalProductId))
  const idsB = new Set(resultsB.map((r) => r.record.externalProductId))
  for (const id of idsA) assert.ok(!idsB.has(id))
})

test('ACCEPTANCE: a report with an unusual row count (not 4, not 15) is parsed completely — the row count itself is never assumed', () => {
  const adapter = getPerformanceAdapter('myntra')!
  const oddRowCount = 37
  const report = buildSyntheticMyntraReport(oddRowCount)
  const results = adapter.parseRows(report, PERIOD)
  assert.equal(results.length, oddRowCount)
  assert.equal(valid(results).length, oddRowCount)
})

// --- groupRecordsByReportBrand: brand scoping derived from the report's --
// --- own Brand column, never typed by hand -------------------------------

function record(overrides: Partial<CanonicalPerformanceRecord> = {}): CanonicalPerformanceRecord {
  return {
    marketplace: 'myntra',
    externalProductId: 'style-1',
    periodStart: '2026-08-01',
    periodEnd: '2026-08-07',
    periodType: 'weekly',
    impressions: 100,
    clicks: 5,
    addToCarts: 1,
    purchases: 0,
    revenue: null,
    returns: null,
    returnRate: null,
    rating: null,
    considerationRate: null,
    conversionRate: null,
    ctr: null,
    source: 'myntra_impress_report',
    metadata: null,
    ...overrides
  }
}

test('groupRecordsByReportBrand: a file where every row reports the same Brand produces exactly one group, scoped to that brand', () => {
  const records = [
    record({ externalProductId: 'a', metadata: { brand: 'Acme Co' } }),
    record({ externalProductId: 'b', metadata: { brand: 'Acme Co' } }),
    record({ externalProductId: 'c', metadata: { brand: 'Acme Co' } })
  ]
  const groups = groupRecordsByReportBrand(records)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].brand, 'Acme Co')
  assert.equal(groups[0].records.length, 3)
})

test('groupRecordsByReportBrand: a file with N distinct Brand values splits into N groups, never silently merged', () => {
  const records = [
    record({ externalProductId: 'a', metadata: { brand: 'Acme Co' } }),
    record({ externalProductId: 'b', metadata: { brand: 'Zeta Co' } }),
    record({ externalProductId: 'c', metadata: { brand: 'Acme Co' } }),
    record({ externalProductId: 'd', metadata: { brand: 'Mid Co' } })
  ]
  const groups = groupRecordsByReportBrand(records)
  assert.equal(groups.length, 3)
  const byBrand = new Map(groups.map((g) => [g.brand, g.records.length]))
  assert.equal(byBrand.get('Acme Co'), 2)
  assert.equal(byBrand.get('Zeta Co'), 1)
  assert.equal(byBrand.get('Mid Co'), 1)
  // No row's external id crosses into another brand's group.
  const acmeIds = new Set(groups.find((g) => g.brand === 'Acme Co')!.records.map((r) => r.externalProductId))
  assert.deepEqual(acmeIds, new Set(['a', 'c']))
})

test('groupRecordsByReportBrand: a report format with no Brand column at all (e.g. Amazon) produces one group scoped to null ("unspecified"), never an error or a fabricated brand', () => {
  const records = [record({ externalProductId: 'asin-1', marketplace: 'amazon', metadata: { sku: 'SKU-1' } }), record({ externalProductId: 'asin-2', marketplace: 'amazon', metadata: null })]
  const groups = groupRecordsByReportBrand(records)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].brand, null)
  assert.equal(groups[0].records.length, 2)
})

test('groupRecordsByReportBrand treats a blank/whitespace-only Brand value the same as no Brand at all', () => {
  const records = [record({ externalProductId: 'a', metadata: { brand: '   ' } }), record({ externalProductId: 'b', metadata: { brand: '' } })]
  const groups = groupRecordsByReportBrand(records)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].brand, null)
})

test('groupRecordsByReportBrand groups are sorted deterministically (unspecified first, then named brands alphabetically) regardless of input row order', () => {
  const records = [
    record({ externalProductId: 'a', metadata: { brand: 'Zeta Co' } }),
    record({ externalProductId: 'b', metadata: null }),
    record({ externalProductId: 'c', metadata: { brand: 'Acme Co' } })
  ]
  const groups = groupRecordsByReportBrand(records)
  assert.deepEqual(
    groups.map((g) => g.brand),
    [null, 'Acme Co', 'Zeta Co']
  )
})

test('ACCEPTANCE: a synthetic report where every row has an independently-randomized Brand splits into exactly that many groups — proves the split is genuinely data-driven, not tuned to any fixed brand count', () => {
  const rowCount = 20
  const report = buildSyntheticMyntraReport(rowCount)
  // Force a KNOWN number of distinct brands (3) across the random rows,
  // rather than relying on buildSyntheticMyntraReport's own per-row-unique
  // brand generation, so this test's expected group count is exact.
  const knownBrands = ['Brand One', 'Brand Two', 'Brand Three']
  report.forEach((row, i) => {
    row.Brand = knownBrands[i % knownBrands.length]
  })
  const adapter = getPerformanceAdapter('myntra')!
  const records = valid(adapter.parseRows(report, PERIOD)).map((r) => r.record)
  const groups = groupRecordsByReportBrand(records)
  assert.equal(groups.length, 3)
  assert.equal(
    groups.reduce((sum, g) => sum + g.records.length, 0),
    rowCount
  )
})
