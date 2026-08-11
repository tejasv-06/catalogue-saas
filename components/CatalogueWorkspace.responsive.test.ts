// Milestone C16 — Responsive Workspace & UX Architecture. Same
// source-inspection approach as the existing CatalogueWorkspace.*.test.ts
// files: this is a layout/CSS-class milestone with no new business logic,
// so these tests assert on the actual rendered className strings rather
// than on behavior a headless DOM can't meaningfully exercise — real
// reflow behavior is covered separately by live browser verification at
// the required viewport widths.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const workspaceSource = readFileSync(join(__dirname, 'CatalogueWorkspace.tsx'), 'utf8')
const queueTableSource = readFileSync(join(__dirname, 'workspace', 'QueueTable.tsx'), 'utf8')
const actionCenterSource = readFileSync(join(__dirname, 'workspace', 'ActionCenter.tsx'), 'utf8')
const appHeaderSource = readFileSync(join(__dirname, 'AppHeader.tsx'), 'utf8')
const emptyQueueSource = readFileSync(join(__dirname, 'workspace', 'EmptyQueueState.tsx'), 'utf8')

// --- 1. Desktop layout classes remain intact ---

test('1. the Add Products / Listings row is still a real desktop side-by-side layout (xl:flex-row)', () => {
  assert.match(workspaceSource, /flex-1 flex flex-col xl:flex-row min-h-0/)
})

test('AddProductsPanel keeps its fixed desktop width and independent scroll region at xl', () => {
  assert.match(workspaceSource, /w-full xl:w-\[420px\] xl:shrink-0 xl:h-full xl:overflow-y-auto/)
})

// --- 2. Narrow layout wraps/stacks (below xl, everything is flex-col by default — no narrow-specific override needed) ---

test('2. below xl the Add Products / Listings row falls back to flex-col (the Tailwind default before the xl: prefix applies)', () => {
  // flex-col with no md:/lg: override before xl: means every width below
  // 1280px stacks — this is the actual fix for the "3-way row crushed
  // Listings into ~350px at 1024px" problem found during the C16 audit.
  const row = workspaceSource.match(/flex-1 flex flex-col xl:flex-row min-h-0/)
  assert.ok(row)
  assert.ok(!/flex-1 flex flex-col (sm|md|lg):flex-row/.test(workspaceSource), 'must not reintroduce a narrower row breakpoint')
})

test('QueueTable\'s scroll container remains overflow-auto (table-only horizontal scroll, never the whole page)', () => {
  assert.match(queueTableSource, /overflow-auto rounded-xl border/)
})

test('QueueTable gives its columns a real minimum width so they scroll cleanly instead of shrinking arbitrarily', () => {
  assert.match(queueTableSource, /min-w-\[680px\]/)
})

// --- 3/9/10. No business logic changes — same handlers, same imports, no new state model ---

test('3/10. C16 introduces no new recommendation, credit, or marketplace-validation logic — same C15/C10/C5 imports as before, untouched', () => {
  assert.match(workspaceSource, /from '@\/lib\/catalogRecommendations'/)
  assert.match(workspaceSource, /computeCatalogRecommendations/)
  // No parallel/duplicate recommendation or readiness function defined in this file.
  assert.ok(!/function computeCatalogRecommendations/.test(workspaceSource), 'must only ever import this, never redefine it')
  assert.ok(!/function evaluateMarketplaceExportReadiness/.test(workspaceSource))
})

// --- 4. Existing Action Center functionality remains intact ---

test('4. ActionCenter is still wired with the exact same recommendations/onExecute contract', () => {
  const start = workspaceSource.indexOf('<ActionCenter')
  const callSite = workspaceSource.slice(start, start + 400)
  assert.match(callSite, /recommendations=\{recommendations\}/)
  assert.match(callSite, /onExecute=\{handleExecuteRecommendation\}/)
})

test('ActionCenter shows the top recommendation prominently and renders the rest as a lighter, more compact variant', () => {
  assert.match(actionCenterSource, /<RecommendationCard rec=\{topRecommendation\} onExecute=\{onExecute\} busy=\{busy\} \/>/)
  assert.match(actionCenterSource, /<RecommendationCard key=\{rec\.id\} rec=\{rec\} onExecute=\{onExecute\} busy=\{busy\} compact \/>/)
})

// --- 5. Existing filters remain intact ---

test('5. CatalogFilterBar is still wired with the exact same C14 filter/sort state props', () => {
  const start = workspaceSource.indexOf('<CatalogFilterBar')
  const callSite = workspaceSource.slice(start, start + 400)
  assert.match(callSite, /filters=\{catalogFilters\}/)
  assert.match(callSite, /onFiltersChange=\{setCatalogFilters\}/)
  assert.match(callSite, /sortKey=\{sortKey\}/)
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

// --- Empty state stays visible without requiring a horizontal scroll ---

test('EmptyQueueState text is left-aligned so it is visible immediately in a horizontally-scrolled, min-width table, never centered off-screen', () => {
  assert.match(emptyQueueSource, /text-left text-sm/)
  assert.ok(!/text-center text-sm/.test(emptyQueueSource))
})
