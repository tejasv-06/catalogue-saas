// Regression guard for Milestone 32 (C9)'s addition to
// components/CatalogueWorkspace.tsx, using Node's built-in test runner (no
// new dependency — tsx is already a project devDependency). Same
// source-inspection approach as CatalogueWorkspace.addProducts.test.ts (C8)
// and ClientSelector.test.ts — this file's actual React/async behavior is
// covered separately by live browser verification against the real
// database, not by these tests.

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

test('handleAnalyzeProduct requires a resolved serverId before calling the enrichment API', () => {
  const body = bodyOf('async function handleAnalyzeProduct(')
  assert.match(body, /if \(!product\?\.serverId \|\| enrichingProductId\) return/)
})

// handleAnalyzeProduct (manual) and ensureProductIntelligence (automatic,
// pre-generation) now share one real implementation —
// runProductIntelligenceAnalysis — rather than each independently calling
// fetch('/api/enrich-product') itself. These tests follow the call, not the
// literal fetch, so both callers are proven to go through the same code.
test('handleAnalyzeProduct delegates to the one shared runProductIntelligenceAnalysis implementation', () => {
  const body = bodyOf('async function handleAnalyzeProduct(')
  assert.match(body, /await runProductIntelligenceAnalysis\(id, product\.serverId\)/)
})

test('runProductIntelligenceAnalysis calls the enrich-product API with only productId, never a caller-supplied owner field', () => {
  const body = bodyOf('async function runProductIntelligenceAnalysis(')
  assert.match(body, /fetch\('\/api\/enrich-product'/)
  assert.match(body, /productId:\s*serverId/)
  assert.ok(!/owner/i.test(body), 'runProductIntelligenceAnalysis must never reference any owner/ownership field')
})

test('runProductIntelligenceAnalysis uses a single-flight guard (enrichingProductId) around the request, safe against a second product finishing first', () => {
  const body = bodyOf('async function runProductIntelligenceAnalysis(')
  assert.match(body, /setEnrichingProductId\(id\)/)
  // Guarded functional clear (not a bare setEnrichingProductId(null)) — this
  // function is now reachable from two different products' calls, and a
  // second (different) product's finally block must never clear the FIRST
  // product's still-in-flight enrichingProductId out from under it.
  assert.match(body, /finally\s*\{[\s\S]*?setEnrichingProductId\(\(prev\) => \(prev === id \? null : prev\)\)/)
})

test('ensureProductIntelligence reuses an already-completed analysis without a new network call', () => {
  const body = bodyOf('async function ensureProductIntelligence(')
  assert.match(body, /if \(product\.productIntelligence\?\.status === 'completed'\)/)
  // The completed-data branch must return before ever reaching serverId/
  // hasSession checks or a fetch — confirmed structurally by requiring the
  // completed-status check to appear before any fetch call in this function.
  const completedIdx = body.search(/product\.productIntelligence\?\.status === 'completed'/)
  const fetchIdx = body.search(/runProductIntelligenceAnalysis\(/)
  assert.ok(completedIdx !== -1 && fetchIdx !== -1 && completedIdx < fetchIdx)
})

test('ensureProductIntelligence skips entirely for guests / products with no persisted serverId', () => {
  const body = bodyOf('async function ensureProductIntelligence(')
  assert.match(body, /if \(!hasSession \|\| !product\.serverId\)\s*\{\s*return null/)
})

test('ensureProductIntelligence dedupes concurrent/sequential calls for the same product via a promise cache keyed by product.id', () => {
  const body = bodyOf('async function ensureProductIntelligence(')
  assert.match(body, /productIntelligencePromises\.current\.get\(product\.id\)/)
  assert.match(body, /productIntelligencePromises\.current\.set\(product\.id,/)
})

test('a fresh Generate Listings batch evicts a PRIOR failure so it can genuinely retry, not permanently reuse a cached null result', () => {
  const body = bodyOf('async function handleGenerateAll(')
  assert.match(body, /productIntelligence\?\.status === 'failed'/)
  assert.match(body, /productIntelligencePromises\.current\.delete\(product\.id\)/)
})

test('a fresh single-row Retry (runGeneration) also evicts a prior failure for that product', () => {
  const body = bodyOf('async function runGeneration(')
  assert.match(body, /productIntelligence\?\.status === 'failed'/)
  assert.match(body, /productIntelligencePromises\.current\.delete\(product\.id\)/)
})

test('generateForProductMarketplace ensures Product Intelligence for a full generation, but never for a field-scoped regenerate', () => {
  const body = bodyOf('async function generateForProductMarketplace(')
  assert.match(body, /const intelligenceData = fieldGroup\s*\?\s*product\.productIntelligence\?\.status === 'completed'\s*\?\s*product\.productIntelligence\.data\s*:\s*undefined\s*:\s*await ensureProductIntelligence\(product\)/)
})

test('generateForProductMarketplace sends the resolved intelligence data (not a stale re-check of product.productIntelligence) to generate-single', () => {
  const body = bodyOf('async function generateForProductMarketplace(', 5000)
  assert.match(body, /productIntelligence:\s*intelligenceData \?\? undefined/)
})

test('Product Intelligence is never mixed across products — ensureProductIntelligence always receives and returns data scoped to the one product passed in', () => {
  const body = bodyOf('async function ensureProductIntelligence(')
  // Every branch reads/writes exclusively via `product` (the function's own
  // parameter) or the id-keyed cache — never a bare/shared variable name
  // that could leak one product's result into another's request.
  assert.ok(!/\bcurrentIntelligence\b|\blastIntelligence\b/.test(body))
  assert.match(body, /productIntelligencePromises\.current\.(get|set)\(product\.id/)
})

test('catalog hydration carries product_intelligence through by serverId without modifying reconcileCatalog itself', () => {
  const body = bodyOf('getCatalog()', 1500)
  assert.match(body, /reconcileCatalog\(prev, server, computeProductStatus\)/)
  assert.match(body, /intelligenceByServerId/)
  // lib/catalogReconciliation.ts (C4) must remain byte-for-byte untouched —
  // this pass happens entirely in CatalogueWorkspace.tsx, after reconcileCatalog
  // returns, never inside it.
  assert.match(body, /const intelligenceByServerId = new Map\(server\.products\.map/)
})

test('GeneratedListingDrawer receives the enrichment trigger and single-flight status as props', () => {
  const start = source.indexOf('<GeneratedListingDrawer')
  assert.ok(start !== -1)
  const callSite = source.slice(start, start + 700)
  assert.match(callSite, /onAnalyzeProduct=\{handleAnalyzeProduct\}/)
  assert.match(callSite, /isAnalyzing=\{enrichingProductId === viewingProduct\.id\}/)
})

// --- Automatic-trigger scope: exactly one real call site, inside
// generation itself — never opening a drawer, never a page refresh. ---

test('ensureProductIntelligence is called from exactly one place in the whole file: inside generateForProductMarketplace', () => {
  const occurrences = [...source.matchAll(/ensureProductIntelligence\(/g)]
  // Exactly 2: the function's own definition, and its one real call site.
  assert.equal(occurrences.length, 2)

  const callIdx = source.indexOf('await ensureProductIntelligence(product)')
  assert.ok(callIdx !== -1)
  const genStart = source.indexOf('async function generateForProductMarketplace(')
  const genEnd = source.indexOf('\n  async function persistApprovalToCatalog(', genStart)
  assert.ok(genStart !== -1 && genEnd !== -1 && callIdx > genStart && callIdx < genEnd)
})

test('opening a product drawer (setViewingTarget) never triggers Product Intelligence', () => {
  for (const start of [...source.matchAll(/setViewingTarget\(/g)].map((m) => m.index!)) {
    const nearby = source.slice(Math.max(0, start - 200), start + 200)
    assert.ok(
      !/ensureProductIntelligence|runProductIntelligenceAnalysis/.test(nearby),
      'setViewingTarget must not be adjacent to an intelligence trigger'
    )
  }
})

test('the mount-time catalog hydration effect (page refresh) never triggers Product Intelligence — it only reads and merges already-persisted results', () => {
  const body = bodyOf('getCatalog()', 1500)
  assert.ok(!/ensureProductIntelligence|runProductIntelligenceAnalysis/.test(body))
})

// --- Credit safety: enrichment has no credit cost to duplicate, and this
// change must not add one. ---

test('app/api/enrich-product/route.ts has no credit deduction — Product Intelligence remains unmetered, so running it automatically introduces no new/duplicate charge', () => {
  const routeSource = readFileSync(join(__dirname, '..', 'app', 'api', 'enrich-product', 'route.ts'), 'utf8')
  assert.ok(!/deductCredits|assertSufficientCredits|CREDIT_COSTS/.test(routeSource))
})

// --- Existing visualAttributes ("Detected from image") behavior is
// untouched — it's a byproduct of generate-single, not something this
// change reroutes through Product Intelligence. ---

test('visualAttributes merge in generateForProductMarketplace is unchanged by the Product Intelligence wiring', () => {
  // Wider window than the default 3000 — this function is long, and the
  // visualAttributes merge sits well past the intelligence/fetch code near
  // its top (~6.5k chars in).
  const body = bodyOf('async function generateForProductMarketplace(', 10000)
  assert.match(body, /const visualAttributes = data\.visualAttributes \?\? p\.visualAttributes/)
})
