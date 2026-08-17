// Regression guard: selecting a Brand Voice auto-fills Brand Name (shared by
// both Manual Entry and Photos Only, since they're driven by the same
// brandName state — see LeftPanel/ImageOnlyPanel) so the seller can visibly
// confirm which brand's guidelines generation will use. Same source-
// inspection approach as every other CatalogueWorkspace.*.test.ts file in
// this repo (no DOM/React-testing-library harness exists).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(__dirname, 'CatalogueWorkspace.tsx'), 'utf8')

function bodyOf(fnSignature: string, window = 1200): string {
  const start = source.indexOf(fnSignature)
  assert.ok(start !== -1, `expected to find "${fnSignature}" in CatalogueWorkspace.tsx`)
  return source.slice(start, start + window)
}

test('handleSelectClient fills brandName from the newly selected client', () => {
  const body = bodyOf('function handleSelectClient(client: Client | null) {')
  assert.match(body, /setSelectedClient\(client\)/)
  assert.match(body, /setBrandName\(client\.client_name\)/)
})

test('handleSelectClient never overwrites brandName while editing an existing product (same !editingId guard the brand-mismatch gate already uses)', () => {
  const body = bodyOf('function handleSelectClient(client: Client | null) {')
  assert.match(body, /if \(client && !editingId\)/)
})

test('deselecting back to "No brand selected" (client === null) leaves a manually-typed brandName untouched, never force-clears it', () => {
  // Narrow window — just this function's own body, not spilling into
  // handleClearForm right after it (which also calls setBrandName('')).
  const body = bodyOf('function handleSelectClient(client: Client | null) {', 238)
  // setBrandName only appears once in this function, inside the
  // `if (client && !editingId)` guard — never unconditionally, and never
  // called with '' / null.
  const setBrandNameCalls = body.match(/setBrandName\(/g) ?? []
  assert.equal(setBrandNameCalls.length, 1)
})

test('AppHeader is wired to handleSelectClient, not the raw setSelectedClient setter', () => {
  assert.match(source, /onSelectClient=\{handleSelectClient\}/)
  assert.ok(!/onSelectClient=\{setSelectedClient\}/.test(source))
})

test('brandName is the one field shared by Manual Entry and Photos Only — handleSelectClient does not need separate per-tab wiring', () => {
  // Both LeftPanel (Manual Entry) and ImageOnlyPanel (Photos Only) are
  // driven by the same top-level brandName/onBrandNameChange props from
  // AddProductsPanel, confirmed by both call sites passing the identical
  // brandName={brandName} prop.
  const leftPanelCallIdx = source.indexOf('<LeftPanel')
  const imageOnlyCallIdx = source.indexOf('<ImageOnlyPanel')
  assert.ok(leftPanelCallIdx !== -1 && imageOnlyCallIdx !== -1)
  const leftPanelCall = source.slice(leftPanelCallIdx, leftPanelCallIdx + 400)
  const imageOnlyCall = source.slice(imageOnlyCallIdx, imageOnlyCallIdx + 400)
  assert.match(leftPanelCall, /brandName=\{brandName\}/)
  assert.match(imageOnlyCall, /brandName=\{brandName\}/)
})
