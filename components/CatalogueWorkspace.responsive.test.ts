// Milestone C16 — Responsive Workspace & UX Architecture, updated for
// Milestone C17's Seller Core Experience redesign (single-column,
// product-card layout replacing the old two-column table). Same
// source-inspection approach as the existing CatalogueWorkspace.*.test.ts
// files: this is a layout/CSS-class/IA milestone with no new business
// logic, so these tests assert on the actual rendered className strings
// rather than on behavior a headless DOM can't meaningfully exercise —
// real reflow behavior is covered separately by live browser verification
// at the required viewport widths.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const workspaceSource = readFileSync(join(__dirname, 'CatalogueWorkspace.tsx'), 'utf8')
const queueTableSource = readFileSync(join(__dirname, 'workspace', 'QueueTable.tsx'), 'utf8')
const appHeaderSource = readFileSync(join(__dirname, 'AppHeader.tsx'), 'utf8')
const emptyQueueSource = readFileSync(join(__dirname, 'workspace', 'EmptyQueueState.tsx'), 'utf8')

// --- 1. Desktop layout: single column, centered, no competing-width columns ---

test('1. the workspace is a single, centered column (C17 removed the old permanent two-column Add-Products/Listings split)', () => {
  assert.match(workspaceSource, /max-w-5xl mx-auto flex flex-col gap-6/)
  assert.ok(!/flex-1 flex flex-col xl:flex-row min-h-0/.test(workspaceSource), 'the old competing-width row must not come back')
})

test('AddProductsPanel is a focused, max-width-capped card, mounted inline (not a fixed-width sidebar column)', () => {
  // Milestone C17 — narrowed further to max-w-2xl (a focused ~672px
  // creation task, per the "no giant horizontal forms" requirement),
  // still not a fixed-width sidebar column.
  assert.match(workspaceSource, /w-full max-w-2xl mx-auto p-6 \$\{cardClass\}/)
  assert.ok(!/xl:w-\[420px\]/.test(workspaceSource), 'must not reintroduce a fixed sidebar width')
})

// --- 2. Narrow layout: a single column has nothing extra to stack — verify no width-fighting classes exist ---

test('2. no responsive row-vs-stack breakpoint is needed anymore since there is only one column', () => {
  assert.ok(!/flex-1 flex flex-col (sm|md|lg|xl):flex-row/.test(workspaceSource), 'no competing-width row should exist at any breakpoint')
})

test("QueueTable renders products as a responsive card grid (1/2/3 columns), not a <table>", () => {
  assert.match(queueTableSource, /grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3/)
  assert.ok(!/<table/.test(queueTableSource), 'C17 replaced the row-per-marketplace table with product cards')
})

// --- 3/9/10. No business logic changes — same handlers, same imports, no new state model ---

test('3/10. C17 introduces no new recommendation, credit, or marketplace-validation logic — same C15/C10/C5 imports as before, untouched', () => {
  assert.match(workspaceSource, /from '@\/lib\/catalogRecommendations'/)
  assert.match(workspaceSource, /computeCatalogRecommendations/)
  // No parallel/duplicate recommendation or readiness function defined in this file.
  assert.ok(!/function computeCatalogRecommendations/.test(workspaceSource), 'must only ever import this, never redefine it')
  assert.ok(!/function evaluateMarketplaceExportReadiness/.test(workspaceSource))
})

// --- 4. C15 recommendations remain available, surfaced per-product instead of as a global hero ---

test('4. the global ActionCenter card-stack is no longer mounted; recommendations are passed into QueueTable for per-product hints instead', () => {
  assert.ok(!/<ActionCenter/.test(workspaceSource), 'C17 removes the Action Center from the primary experience')
  const start = workspaceSource.indexOf('<QueueTable')
  const callSite = workspaceSource.slice(start, start + 1200)
  assert.match(callSite, /recommendations=\{recommendations\}/)
  assert.match(callSite, /onExecuteRecommendation=\{handleExecuteRecommendation\}/)
})

test('QueueTable shows at most one contextual recommendation per product card, reusing the already-sorted C15 list — never a second priority judgment', () => {
  assert.match(queueTableSource, /recommendationByProduct\.set/)
  assert.match(queueTableSource, /topRecommendation=\{recommendationByProduct\.get\(product\.id\) \?\? null\}/)
})

// --- 5. Existing filters remain intact (now collapsed behind a toggle, not removed) ---

test('5. CatalogFilterBar is still wired with the exact same C14 filter/sort state props', () => {
  const start = workspaceSource.indexOf('<CatalogFilterBar')
  const callSite = workspaceSource.slice(start, start + 700)
  assert.match(callSite, /filters=\{catalogFilters\}/)
  assert.match(callSite, /onFiltersChange=\{setCatalogFilters\}/)
  assert.match(callSite, /sortKey=\{sortKey\}/)
  assert.match(callSite, /readinessFilter=\{readinessFilter\}/)
})

// --- 6. Existing bulk actions remain intact ---

test('6. BulkActionBar is still wired with the exact same C14 selection-scoped handlers', () => {
  const start = workspaceSource.indexOf('<BulkActionBar')
  const callSite = workspaceSource.slice(start, start + 600)
  assert.match(callSite, /selectedCount=\{selectedCount\}/)
  assert.match(callSite, /onAnalyze=\{handleBulkAnalyzeSelected\}/)
  assert.match(callSite, /onGenerate=\{handleBulkGenerateSelected\}/)
  assert.match(callSite, /onExport=\{handleBulkExportSelected\}/)
})

// --- 7. Existing export flow remains intact ---

test('7. performExport and the C11 readiness gate are untouched by this milestone', () => {
  assert.match(workspaceSource, /async function performExport\(marketplaces: Marketplace\[\]\)/)
  assert.match(workspaceSource, /evaluateMarketplaceExportReadiness\(/)
})

// --- 8. Existing drawer remains intact and stays viewport-safe ---

test('8. GeneratedListingDrawer keeps its viewport-safe sizing (full width capped, internal scroll, never taller than the viewport)', () => {
  const start = workspaceSource.indexOf('className="relative w-full max-w-md')
  assert.ok(start !== -1, 'expected the drawer panel\'s className to still cap width and scroll internally')
  const body = workspaceSource.slice(start, start + 200)
  assert.match(body, /h-full p-6 overflow-y-auto/)
})

// --- Header stays usable (no removed functionality, still wraps rather than overlapping) ---

test('AppHeader keeps its wrapping layout (marketplace pills + brand voice never overlap at reduced width)', () => {
  assert.match(appHeaderSource, /flex flex-wrap items-end gap-4 sm:gap-6/)
  assert.match(appHeaderSource, /flex flex-wrap gap-2 rounded-xl/)
})

// --- Empty state stays visible and readable ---

test('EmptyQueueState renders as a plain readable div, not a table row (C17 replaced the table with cards)', () => {
  assert.match(emptyQueueSource, /text-left text-sm/)
  assert.match(emptyQueueSource, /<div className=/)
})
