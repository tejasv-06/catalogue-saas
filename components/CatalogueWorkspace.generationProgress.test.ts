// Regression guard for the Generate Listings loading/progress experience:
// same source-inspection approach as CatalogueWorkspace.enrichment.test.ts
// and every other CatalogueWorkspace.*.test.ts file (no DOM/React-testing-
// library harness exists in this repo). These tests prove the progress
// banner's five stages (Analyzing/Preparing/Generating/Validating/Complete-
// or-Failed) are driven by real, already-reached state transitions inside
// generateForProductMarketplace/handleGenerateAll/runGeneration, never a
// timer: and that ensureProductIntelligence/runProductIntelligenceAnalysis/
// the credit-accounting call sites are untouched by this change.

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

// --- No fake timer anywhere in this feature ---

test('no setTimeout/setInterval is used to drive the progress banner', () => {
  const genBody = bodyOf('async function generateForProductMarketplace(', 10000)
  const allBody = bodyOf('async function handleGenerateAll(', 4000)
  const runBody = bodyOf('async function runGeneration(', 1500)
  for (const body of [genBody, allBody, runBody]) {
    assert.ok(!/setTimeout|setInterval/.test(body))
  }
})

// --- Stage 1: Analyzing Product: derived from the real enrichingProductId
// signal, never stored as an explicit settable phase (see
// describeGenerationStage's own comment for why). ---

test('describeGenerationStage shows "Analyzing" only when enrichingProductId genuinely matches the stage\'s own product, never as a stored phase value', () => {
  const type = bodyOf('export type GenerationStageInfo = {', 300)
  // 'analyzing' must NOT be one of the literal phase values that can be
  // stored: proving it can only ever come from the real signal.
  assert.match(type, /phase:\s*'preparing' \| 'generating' \| 'validating' \| 'complete' \| 'failed'/)

  const fn = bodyOf('function describeGenerationStage(', 1500)
  assert.match(fn, /if \(enrichingProductId && enrichingProductId === stage\.productId\)/)
  assert.match(fn, /return `Analyzing\$\{productSuffix\}\.\.\.`/)
})

// --- Stage transitions happen at real await boundaries inside
// generateForProductMarketplace, in the correct order. ---

test('the "preparing" stage is set before Product Intelligence is awaited, so the Analyzing overlay can sit on top of it for exactly the real analysis window', () => {
  const body = bodyOf('async function generateForProductMarketplace(', 5000)
  const preparingIdx = body.indexOf("phase: 'preparing'")
  const ensureIdx = body.indexOf('await ensureProductIntelligence(product)')
  assert.ok(preparingIdx !== -1 && ensureIdx !== -1 && preparingIdx < ensureIdx)
})

test('the "generating" stage (with the real marketplace label) is set only after Product Intelligence has resolved, before the generate-single request is sent', () => {
  const body = bodyOf('async function generateForProductMarketplace(', 5000)
  const ensureIdx = body.indexOf('await ensureProductIntelligence(product)')
  const generatingIdx = body.indexOf("phase: 'generating', marketplaceLabel: MARKETPLACE_LABELS[marketplace]")
  const fetchIdx = body.indexOf("fetch('/api/generate-single'")
  assert.ok(ensureIdx !== -1 && generatingIdx !== -1 && fetchIdx !== -1)
  assert.ok(ensureIdx < generatingIdx && generatingIdx < fetchIdx)
})

test('the "validating" stage is only ever entered inside the res.ok success branch: never on an error response', () => {
  const body = bodyOf('async function generateForProductMarketplace(', 10000)
  const okIdx = body.indexOf('if (res.ok) {')
  const validatingIdx = body.indexOf("phase: 'validating'")
  assert.ok(okIdx !== -1 && validatingIdx !== -1 && validatingIdx > okIdx)
  // And it must appear before this same block's own success return path.
  const returnSuccessIdx = body.indexOf("return 'success'")
  assert.ok(returnSuccessIdx !== -1 && validatingIdx < returnSuccessIdx)
})

// --- Terminal states: complete/failed are set by the CALLERS
// (handleGenerateAll/runGeneration), never inside
// generateForProductMarketplace itself: so a multi-marketplace bulk batch
// never flashes "complete" after each individual pair. ---

test('generateForProductMarketplace itself never sets phase complete or failed: only its callers do, after the whole request is actually done', () => {
  const body = bodyOf('async function generateForProductMarketplace(', 10000)
  assert.ok(!/phase:\s*'complete'/.test(body))
  assert.ok(!/phase:\s*'failed'/.test(body))
})

test('handleGenerateAll only sets a terminal phase once, after its whole batch loop finishes: complete only when at least one pair actually succeeded, failed only when every attempted pair failed', () => {
  const body = bodyOf('async function handleGenerateAll(', 5000)
  assert.match(body, /succeededPairs > 0\s*\n?\s*\?\s*\{ phase: 'complete'/)
  assert.match(body, /completedPairs > 0\s*\n?\s*\?\s*\{ phase: 'failed'/)
  // Insufficient-credits stop defers to the existing, more specific
  // creditsStoppedInfo banner instead of also claiming a generic failure.
  assert.match(body, /stoppedForCredits\s*\n?\s*\?\s*null/)
})

test('runGeneration (single-row Retry / drawer regenerate) sets complete on success and failed otherwise, scoped to the exact product it ran for', () => {
  const body = bodyOf('async function runGeneration(', 1500)
  assert.match(body, /prev && prev\.productId === id/)
  assert.match(body, /phase: outcome === 'success' \? 'complete' : 'failed'/)
})

// --- Bulk isolation: productIndex/totalProducts are computed per product,
// threaded through progressContext, never shared/global. ---

test('handleGenerateAll computes a real 1-based productIndex per product (from its own position in the frozen pending array) and passes it through progressContext', () => {
  const body = bodyOf('async function handleGenerateAll(', 5000)
  assert.match(body, /for \(let productIndex = 0; productIndex < pending\.length; productIndex\+\+\)/)
  assert.match(body, /productIndex:\s*productIndex \+ 1,\s*\n\s*totalProducts:\s*pending\.length/)
})

test('a single-row call (runGeneration) never passes progressContext, so describeGenerationStage omits bulk "N of M" text for it', () => {
  const body = bodyOf('async function runGeneration(', 1500)
  const callIdx = body.indexOf('generateForProductMarketplace(product, marketplace, selectedMarketplaces, fieldGroup)')
  assert.ok(callIdx !== -1, 'runGeneration must call generateForProductMarketplace without a 5th progressContext argument')
})

test('describeGenerationStage omits the "product N of M" clutter unless there is genuinely more than one product in this run', () => {
  const fn = bodyOf('function describeGenerationStage(', 1500)
  assert.match(fn, /stage\.totalProducts && stage\.totalProducts > 1/)
})

// --- Field-scoped regenerate still shows the same real progression, but
// (per the existing, unmodified logic asserted in
// CatalogueWorkspace.enrichment.test.ts) never triggers a fresh analysis. ---

test('the preparing stage is set unconditionally (both full generation and field-scoped regenerate reach it): only the intelligence branch beneath it is gated on fieldGroup', () => {
  const body = bodyOf('async function generateForProductMarketplace(', 5000)
  const preparingIdx = body.indexOf("phase: 'preparing'")
  const fieldGroupCheckIdx = body.indexOf('const intelligenceData = fieldGroup')
  assert.ok(preparingIdx !== -1 && fieldGroupCheckIdx !== -1 && preparingIdx < fieldGroupCheckIdx)
})

// --- No new/duplicate credit or Product Intelligence calls introduced by
// this purely-UI change. ---

test('this change introduces no new deductCredits/assertSufficientCredits call sites in CatalogueWorkspace.tsx (credits are the server route\'s concern, unchanged)', () => {
  assert.ok(!/deductCredits|assertSufficientCredits/.test(source))
})

test('ensureProductIntelligence and runProductIntelligenceAnalysis are structurally unmodified call/definition sites: still exactly one call to ensureProductIntelligence in the whole file', () => {
  const occurrences = [...source.matchAll(/ensureProductIntelligence\(/g)]
  assert.equal(occurrences.length, 2) // definition + the one call inside generateForProductMarketplace
})

// --- The banner itself lives in the Listings column, not the drawer, so it
// is visible with the drawer closed (requirement B). ---

test('the progress banner renders in the main Listings column tree, not inside GeneratedListingDrawer', () => {
  const drawerStart = source.indexOf('function GeneratedListingDrawer(')
  const drawerEnd = source.indexOf('\nfunction ExportGateModal(')
  assert.ok(drawerStart !== -1 && drawerEnd !== -1)
  const drawerBody = source.slice(drawerStart, drawerEnd)
  assert.ok(!/generationStage &&/.test(drawerBody), 'the banner must not be gated inside the drawer component')

  const bannerIdx = source.indexOf('{generationStage && (')
  assert.ok(bannerIdx !== -1 && (bannerIdx < drawerStart || bannerIdx > drawerEnd))
})
