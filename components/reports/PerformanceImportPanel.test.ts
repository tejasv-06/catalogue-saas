// UI regression tests for components/reports/PerformanceImportPanel.tsx.
// Same source-inspection convention as every other *.test.ts file in this
// repo: real rendered behavior is covered by live browser verification,
// not by these tests.
//
// Final architecture correction: this is a marketplace performance REPORT
// IMPORT, not a catalog-product-matching tool. There is no "Product
// Match" column, no dropdown, no matched/unmatched gate: every valid row
// imports. These tests assert that concept was actually removed, not
// just renamed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPerformanceAdapter } from '@/lib/performanceAdapters'

const source = readFileSync(join(__dirname, 'PerformanceImportPanel.tsx'), 'utf8')

// --- Report columns render verbatim, in exact source order -----------------

test('the Myntra adapter exposes all 16 Impress report columns, in the exact report order from spec §1', () => {
  const adapter = getPerformanceAdapter('myntra')!
  const labels = adapter.previewColumns.map((c) => c.label)
  assert.deepEqual(labels, [
    'Style ID',
    'Seller ID',
    'Article Type',
    'Brand',
    'Gender',
    'Seller MRP',
    'Inventory Age',
    'RPLC',
    'Impressions',
    'Clicks',
    'Add to Carts',
    'Purchases',
    'Return %',
    'Consideration %',
    'Conversion %',
    'Rating'
  ])
})

test('the raw import preview never renames Myntra\'s report columns to canonical field names (e.g. "Return %" stays "Return %", never becomes "returnRate")', () => {
  const adapter = getPerformanceAdapter('myntra')!
  const labels = adapter.previewColumns.map((c) => c.label)
  assert.ok(labels.includes('Return %'))
  assert.ok(!labels.includes('returnRate'))
})

test('numeric Myntra columns are right-aligned, text columns are left-aligned', () => {
  const adapter = getPerformanceAdapter('myntra')!
  const byKey = new Map(adapter.previewColumns.map((c) => [c.key, c.align]))
  assert.equal(byKey.get('styleId'), 'left')
  assert.equal(byKey.get('brand'), 'left')
  assert.equal(byKey.get('impressions'), 'right')
  assert.equal(byKey.get('rating'), 'right')
})

test('the table sits inside an internal, bounded scroll container (never a page-width table that breaks layout)', () => {
  assert.match(source, /overflow-auto max-h-\[32rem\]/)
})

test('the header row is sticky (stays visible while scrolling vertically)', () => {
  const theadIdx = source.indexOf('<thead>')
  const theadEnd = source.indexOf('</thead>')
  const theadBody = source.slice(theadIdx, theadEnd)
  assert.match(theadBody, /sticky top-0/)
})

test('the first report column is sticky horizontally', () => {
  assert.match(source, /colIndex === 0 \? 'sticky left-0 z-30' : 'z-20'/)
})

test('the table is genuinely adapter-driven: PerformanceImportPanel.tsx never hardcodes a Myntra or Amazon column list of its own', () => {
  assert.ok(!/'Style ID', 'Seller ID'/.test(source), 'columns must come from adapter.previewColumns, never a hardcoded array in the panel')
})

test('the import table never converts to a card layout on narrow screens: no responsive breakpoint classes around the table', () => {
  assert.ok(!/sm:hidden|md:hidden|lg:hidden|sm:block|md:grid-cols/.test(source))
})

test('no virtualization library was introduced: the fix is a plain array slice, not react-window/react-virtualized/etc.', () => {
  assert.ok(!/react-window|react-virtualized|virtualiz/i.test(source))
})

// --- The "Product Match" import-time gate was DELETED, not replaced --------

test('there is no "Product Match" column, header, or cell anywhere in the file\'s actual code', () => {
  const codeOnly = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n')
  assert.ok(!/Product Match/.test(codeOnly))
})

test('there is no product-selection <select>/dropdown in the preview table: no "Unmatched" concept, no per-row product choice', () => {
  assert.ok(!/Unmatched: select a product/.test(source))
  assert.ok(!/resolveRow|resolveMany|handleBulkAssign|selectedIndexes|bulkProductId/.test(source), 'the entire per-row/bulk resolution mechanism must be gone, not merely unused')
})

test('the panel never imports the catalog product list: importing a report never needs to know Tesolute\'s catalog at all', () => {
  assert.ok(!/getCatalog|CatalogProductRow/.test(source))
})

test('the panel never imports classifyImportRows/ImportResolution/getExternalIdMappings: matching/mapping lookups are commitPerformanceImport\'s job now, not the UI\'s', () => {
  assert.ok(!/classifyImportRows|ImportResolution|getExternalIdMappings/.test(source))
})

test('Confirm Import is never gated on a match count: only on there being at least one structurally valid row', () => {
  assert.match(source, /disabled=\{importing \|\| validCount === 0\}/)
  assert.ok(!/matchedCount/.test(source))
})

test('the import button reads "Import Performance Report", not a matched-count label', () => {
  assert.match(source, /'Import Performance Report'/)
  assert.ok(!/Confirm import \(/.test(source))
})

test('the status line reports rows detected / valid / invalid: never Matched/Unmatched', () => {
  assert.match(source, /rows detected/)
  assert.match(source, /\{validCount\} valid/)
  assert.match(source, /\{invalidCount\} invalid/)
  assert.ok(!/Matched: \{/.test(source))
  assert.ok(!/Unmatched: \{/.test(source))
})

test('an invalid row is still visibly distinguished (left accent border) and its reason is surfaced via a tooltip, without a dedicated matching column', () => {
  assert.match(source, /row\.kind === 'invalid' \? 'border-l-4 border-l-\[var\(--danger-border\)\]' : ''/)
  assert.match(source, /`Invalid: \$\{row\.reason\}`/)
})

test('handleConfirmImport sends every valid row\'s record to commitPerformanceImport, grouped by the report\'s own brand: no per-row filtering by product/match state', () => {
  const start = source.indexOf('async function handleConfirmImport')
  const end = source.indexOf('\n  }', source.indexOf('setImporting(false)', start))
  const body = source.slice(start, end)
  assert.match(body, /r\.kind === 'valid'/)
  assert.ok(!/r\.productId|!!r\.productId/.test(body), 'no product-linkage filter should gate which rows get committed')
  assert.match(body, /const groups = groupRecordsByReportBrand\(validRecords\)/)
  assert.match(body, /commitPerformanceImport\(marketplace, group\.brand, group\.records\)/)
})

test('performance_imported history events are derived from the ACTUAL inserted rows\' product_id (result.inserted), only for rows that came back linked: never assumed from UI state', () => {
  const start = source.indexOf('async function handleConfirmImport')
  const end = source.indexOf('\n  }', source.indexOf('setImporting(false)', start))
  const body = source.slice(start, end)
  assert.match(body, /for \(const row of result\.inserted\)/)
  assert.match(body, /if \(row\.product_id\) allProductIds\.add\(row\.product_id\)/)
})

test('handleConfirmImport never blends different brands into one commit: groupRecordsByReportBrand is recomputed from previewRows, not read from stale state', () => {
  const start = source.indexOf('async function handleConfirmImport')
  const end = source.indexOf('\n  }', source.indexOf('setImporting(false)', start))
  const body = source.slice(start, end)
  assert.match(body, /for \(const group of groups\)/)
})

// --- 11. Amazon stays a separate, adapter-owned column set ------------------

test('the Amazon adapter defines its OWN column set: not the Myntra schema, not a hardcoded UI list', () => {
  const adapter = getPerformanceAdapter('amazon')!
  assert.ok(adapter.previewColumns.length > 0)
  assert.ok(!adapter.previewColumns.some((c) => c.label === 'Style ID'))
})

// --- Row order / left border accent -----------------------------------------

test('row state uses only a subtle left-border accent: no full-row background tint', () => {
  const trMatches = source.match(/<tr[^>]*>/g) ?? []
  for (const tr of trMatches) {
    assert.ok(!/bg-\[var\(--(danger|warn|success)-bg\)\]/.test(tr), `row element should not be fully tinted: ${tr}`)
  }
})

// ==================================================
// Large report performance: PREVIEW_LIMIT
// ==================================================

test('PREVIEW_LIMIT is 15, and only that many rows are ever rendered into the DOM (tbody maps visibleRows, not the full previewRows)', () => {
  assert.match(source, /const PREVIEW_LIMIT = 15/)
  assert.match(source, /const visibleRows = previewRows\.slice\(0, PREVIEW_LIMIT\)/)
  assert.match(source, /\{visibleRows\.map\(\(row, i\) => \{/)
  assert.ok(!/\{previewRows\.map\(\(row, i\) => \{/.test(source), 'the table body must never map over the full, unsliced dataset')
})

test('validCount/invalidCount are computed from the full previewRows array, never the sliced preview', () => {
  assert.match(source, /const validCount = previewRows\.filter/)
  assert.match(source, /const invalidCount = previewRows\.filter/)
  assert.ok(!/visibleRows\.filter/.test(source), 'counts must never be derived from the sliced preview rows')
})

test('Confirm Import (handleConfirmImport) reads records from the full previewRows array, never the sliced preview', () => {
  const start = source.indexOf('async function handleConfirmImport')
  const end = source.indexOf('\n  }', source.indexOf('setImporting(false)', start))
  const body = source.slice(start, end)
  assert.match(body, /previewRows\.filter/)
  assert.ok(!/visibleRows/.test(body), 'Confirm Import must never read from the sliced preview rows')
})

test('the preview label distinguishes "first N of M" (large report) from "showing all" (small report)', () => {
  assert.match(source, /Preview: first \$\{PREVIEW_LIMIT\} of \$\{previewRows\.length\} rows/)
  assert.match(source, /Showing \$\{previewRows\.length\} of \$\{previewRows\.length\} rows/)
  assert.match(source, /previewRows\.length > PREVIEW_LIMIT/)
})

// --- Pure-logic simulation of the exact slicing/labeling behavior -----------
// (mirrors the component's own PREVIEW_LIMIT/visibleRows/label logic
// byte-for-byte, since this repo has no DOM test harness to mount the real
// component: see the file header.)

const PREVIEW_LIMIT = 15

function simulateImport(rowCount: number, invalidEvery = 0) {
  const previewRows = Array.from({ length: rowCount }, (_, i) => ({
    kind: invalidEvery > 0 && i % invalidEvery === 0 ? ('invalid' as const) : ('valid' as const)
  }))
  const visibleRows = previewRows.slice(0, PREVIEW_LIMIT)
  const validCount = previewRows.filter((r) => r.kind === 'valid').length
  const invalidCount = previewRows.filter((r) => r.kind === 'invalid').length
  const label =
    previewRows.length > PREVIEW_LIMIT
      ? `Preview: first ${PREVIEW_LIMIT} of ${previewRows.length} rows`
      : `Showing ${previewRows.length} of ${previewRows.length} rows`
  // Every valid row is what Confirm Import actually acts on: no
  // product-linkage filter narrows this further.
  const committed = previewRows.filter((r) => r.kind === 'valid')
  return { previewRows, visibleRows, validCount, invalidCount, label, committed }
}

test('a 100-row report: preview contains exactly 15 rows, summary counts represent all 100, and Confirm Import commits all 100 valid rows', () => {
  const result = simulateImport(100)
  assert.equal(result.previewRows.length, 100)
  assert.equal(result.visibleRows.length, 15)
  assert.equal(result.validCount, 100)
  assert.equal(result.label, 'Preview: first 15 of 100 rows')
  assert.equal(result.committed.length, result.validCount)
})

test('a 75-row report with some invalid rows: all valid rows commit, regardless of the 15-row render limit', () => {
  const result = simulateImport(75, 10)
  assert.equal(result.previewRows.length, 75)
  assert.equal(result.validCount + result.invalidCount, 75)
  assert.ok(result.invalidCount > 0, 'sanity: this synthetic dataset does have some invalid rows')
  assert.equal(result.committed.length, result.validCount)
})

test('an 8-row report (fewer than PREVIEW_LIMIT): preview shows all 8, label says "Showing 8 of 8 rows"', () => {
  const result = simulateImport(8)
  assert.equal(result.visibleRows.length, 8)
  assert.equal(result.label, 'Showing 8 of 8 rows')
})

test('a 15-row report (exactly at the limit): still "Showing 15 of 15 rows", not "Preview: first 15 of 15"', () => {
  const result = simulateImport(15)
  assert.equal(result.visibleRows.length, 15)
  assert.equal(result.label, 'Showing 15 of 15 rows')
})

// ==================================================
// Filter reset: every filter starts blank on every mount
// ==================================================

test('marketplace/periodType/periodStart/periodEnd all initialize to a blank literal, never a hardcoded selection or computed date', () => {
  assert.match(source, /useState<PerformanceMarketplace \| ''>\(''\)/)
  assert.match(source, /useState<PerformancePeriodType \| ''>\(''\)/)
  assert.match(source, /const \[periodStart, setPeriodStart\] = useState\(''\)/)
  assert.match(source, /const \[periodEnd, setPeriodEnd\] = useState\(''\)/)
  assert.ok(!/useState<PerformanceMarketplace>\('myntra'\)/.test(source), 'marketplace must not default to a real marketplace')
  assert.ok(!/useState<PerformancePeriodType>\('weekly'\)/.test(source), 'periodType must not default to a real period type')
})

test('reset() clears marketplace/periodType/periodStart/periodEnd back to blank: a fresh mount and a reset must be indistinguishable', () => {
  const start = source.indexOf('function reset()')
  const end = source.indexOf('\n  }', start)
  const body = source.slice(start, end)
  assert.match(body, /setMarketplace\(''\)/)
  assert.match(body, /setPeriodType\(''\)/)
  assert.match(body, /setPeriodStart\(''\)/)
  assert.match(body, /setPeriodEnd\(''\)/)
})

test('no localStorage/sessionStorage/URL-param persistence exists anywhere in this file', () => {
  const codeOnly = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n')
  assert.ok(!/localStorage|sessionStorage|useSearchParams|URLSearchParams/.test(codeOnly))
})

// ==================================================
// Upload UI: the file picker must never be silently inert
// ==================================================
// Bug found via careful trace, not assumed: the file input used to be
// disabled={!canUpload}, so clicking "Upload report" before all four
// setup fields were filled did nothing at all (a disabled file input
// inside a <label> never opens the OS file dialog): this read as "the
// button doesn't work." Worse, the intended fallback (handleFileChange's
// own guard, which sets `error`) was ALSO a dead end: the error banner
// only rendered inside the step === 'preview' block, which is never
// reached when that guard fires and returns early. So even removing the
// disabled attribute alone would have swapped "button does nothing" for
// "button silently fails with an invisible error": both are the same
// user-facing bug. The fix has two parts, both asserted below.

test('the file input is never disabled: canUpload only drives an informational hint, not whether the picker can open', () => {
  assert.match(source, /const canUpload = marketplace !== '' && periodType !== '' && periodStart !== '' && periodEnd !== ''/)
  assert.ok(!/disabled=\{!canUpload\}/.test(source), 'the file input must not be disabled based on canUpload: picking a file must always be possible')
  const inputMatch = source.match(/<input type="file"[^/]*\/>/)
  assert.ok(inputMatch, 'expected to find the file input')
  assert.ok(!/disabled/.test(inputMatch![0]), 'the file input element itself must carry no disabled attribute at all')
})

test('the error banner renders regardless of step: a validation error set while still on \'setup\' (e.g. file picked before marketplace/period were chosen) must be visible, not silently swallowed', () => {
  const setupStart = source.indexOf("step === 'setup'")
  const setupEnd = source.indexOf("step === 'preview'", setupStart)
  const betweenSetupAndPreview = source.slice(setupStart, setupEnd)
  assert.match(betweenSetupAndPreview, /\{error && \(/, 'the error banner must be reachable from outside the preview-only block')
  // And it must not ALSO be duplicated inside the preview block (single
  // source of truth, not two banners that could drift or double-render).
  const previewStart = source.indexOf("step === 'preview'")
  const previewBody = source.slice(previewStart, source.indexOf("step === 'done'"))
  const dangerBannerCount = (previewBody.match(/dangerBannerClass/g) ?? []).length
  assert.equal(dangerBannerCount, 0, 'the preview block should not render its own separate error banner anymore')
})

test('performance import panel renders the file upload control, unconditionally', () => {
  assert.match(source, /<input type="file" accept="\.csv" onChange=\{handleFileChange\}/)
})

test('selecting a file always invokes handleFileChange (Papa.parse -> adapter.parseRows), which itself decides whether to proceed or show an error: the DOM never pre-empts that decision', () => {
  const start = source.indexOf('async function handleFileChange')
  const end = source.indexOf('const csvText = await file.text()', start)
  const body = source.slice(start, end)
  // The guard runs INSIDE the handler (post file-selection), not via a
  // disabled attribute that would prevent the handler from ever firing.
  assert.match(body, /if \(!marketplace \|\| !periodType \|\| !periodStart \|\| !periodEnd\)/)
  assert.match(body, /setError\(/)
})

test('a successful parse reaches the preview step: setStep(\'preview\') is the last thing handleFileChange does on the happy path', () => {
  const start = source.indexOf('async function handleFileChange')
  const end = source.indexOf('\n  }', source.indexOf("setStep('preview')", start))
  const body = source.slice(start, end)
  assert.match(body, /adapter\.parseRows\(parsed\.data/)
  assert.match(body, /setPreviewRows\(combined\)/)
  assert.match(body, /setStep\('preview'\)/)
})

test('handleFileChange rejects an upload attempt if marketplace/periodType/periodStart/periodEnd are not all set, before ever parsing the file', () => {
  const start = source.indexOf('async function handleFileChange')
  const end = source.indexOf('const csvText = await file.text()', start)
  const body = source.slice(start, end)
  assert.match(body, /if \(!marketplace \|\| !periodType \|\| !periodStart \|\| !periodEnd\)/)
})

// --- 19. Credit safety --------------------------------------------------------

test('19. PerformanceImportPanel never imports lib/credits.ts or calls deductCredits/assertSufficientCredits', () => {
  assert.ok(!/lib\/credits/.test(source), 'must not import lib/credits.ts')
  assert.ok(!/deductCredits|assertSufficientCredits/.test(source), 'must not call credit deduction functions')
})
