// Regression guard for Milestone C11's addition to
// components/CatalogueWorkspace.tsx, using Node's built-in test runner (no
// new dependency — tsx is already a project devDependency). Same
// source-inspection approach as the C8/C9 CatalogueWorkspace test files —
// this file's actual React/async behavior is covered separately by live
// browser verification against the real database, not by these tests.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(__dirname, 'CatalogueWorkspace.tsx'), 'utf8')

function bodyOf(fnSignature: string, window = 3000): string {
  const start = source.indexOf(fnSignature)
  assert.ok(start !== -1, `expected to find "${fnSignature}" in CatalogueWorkspace.tsx`)
  return source.slice(start, start + window)
}

test('performExport is scoped to a caller-supplied marketplaces list, never the full SUPPORTED_MARKETPLACES set', () => {
  const body = bodyOf('async function performExport(marketplaces: Marketplace[])')
  assert.match(body, /for \(const marketplace of marketplaces\)/)
  assert.ok(!/for \(const marketplace of SUPPORTED_MARKETPLACES\)/.test(body.slice(0, body.indexOf('flattenedRows.length === 0'))))
})

test('handleOpenExportSummary resets readiness to null so the modal always recomputes fresh on open', () => {
  const body = bodyOf('function handleOpenExportSummary(')
  assert.match(body, /setExportReadiness\(null\)/)
})

test('readiness is computed via the C10/C11 pure functions, not re-derived inline', () => {
  const body = bodyOf('useEffect(() => {\n    if (!showExportSummary) return')
  assert.match(body, /evaluateMarketplaceExportReadiness\(/)
  assert.match(body, /gatherExportCandidateItems\(/)
})

test('the modal is wired to only export the READY subset, via onConfirmReady', () => {
  const start = source.indexOf('<ExportSummaryModal')
  const callSite = source.slice(start, start + 900)
  assert.match(callSite, /readiness=\{exportReadiness\}/)
  assert.match(callSite, /onConfirmReady=\{\(marketplaces\) => performExport\(marketplaces\)\}/)
})

test('ExportSummaryModal disables the export action while checking readiness or when nothing is ready', () => {
  const body = bodyOf('function ExportSummaryModal({', 6000)
  assert.match(body, /disabled=\{isCheckingReadiness \|\| ready\.length === 0\}/)
})

test('ExportSummaryModal never labels a non-READY marketplace with a generic "some fields missing" message — it renders each issue\'s real field name', () => {
  const body = bodyOf('function ExportSummaryModal({', 6000)
  assert.match(body, /issue\.field/)
  assert.ok(!/some fields (are )?missing/i.test(body))
})

test('gatherExportCandidateItems reuses the same approved[marketplace] eligibility rule as computeExportableCounts, not a new one', () => {
  // Milestone C15 — moved from this file into lib/catalogOperations.ts so
  // lib/catalogRecommendations.ts's marketplace-level EXPORT recommendation
  // can call the exact same function CatalogueWorkspace.tsx's own export
  // flow does, rather than re-deriving the same approved[marketplace]
  // mapping a second time. Behavior (and this assertion) is unchanged.
  const opsSource = readFileSync(join(__dirname, '..', 'lib', 'catalogOperations.ts'), 'utf8')
  const start = opsSource.indexOf('export function gatherExportCandidateItems(')
  assert.ok(start !== -1, 'expected to find gatherExportCandidateItems in lib/catalogOperations.ts')
  const body = opsSource.slice(start, start + 500)
  assert.match(body, /p\.approved\[marketplace\]/)
  assert.match(source, /import\s*\{[^}]*gatherExportCandidateItems[^}]*\}\s*from\s*'@\/lib\/catalogOperations'/)
})

test('skipped-marketplace reasons come from the real readiness issues, never a hardcoded generic string', () => {
  const body = bodyOf('const skipped = (exportReadiness ?? [])')
  assert.match(body, /r\.issues\[0\]\?\.message/)
})
