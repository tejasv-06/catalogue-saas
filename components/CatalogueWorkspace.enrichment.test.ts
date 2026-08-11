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

test('handleAnalyzeProduct calls the enrich-product API with only productId, never a caller-supplied owner field', () => {
  const body = bodyOf('async function handleAnalyzeProduct(')
  assert.match(body, /fetch\('\/api\/enrich-product'/)
  assert.match(body, /productId:\s*product\.serverId/)
  assert.ok(!/owner/i.test(body), 'handleAnalyzeProduct must never reference any owner/ownership field')
})

test('handleAnalyzeProduct uses a single-flight guard (enrichingProductId) around the request', () => {
  const body = bodyOf('async function handleAnalyzeProduct(')
  assert.match(body, /setEnrichingProductId\(id\)/)
  assert.match(body, /finally\s*\{\s*setEnrichingProductId\(null\)/)
})

test('generateForProductMarketplace only sends productIntelligence when a completed analysis exists', () => {
  const body = bodyOf('async function generateForProductMarketplace(')
  assert.match(body, /productIntelligence:\s*product\.productIntelligence\?\.status === 'completed' \? product\.productIntelligence\.data : undefined/)
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
