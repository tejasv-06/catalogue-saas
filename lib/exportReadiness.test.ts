// Unit tests for lib/exportReadiness.ts (Milestone C11), using Node's
// built-in test runner (no new dependency — tsx is already a project
// devDependency). Run with: npx tsx --test lib/exportReadiness.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateMarketplaceExportReadiness,
  evaluateSelectedMarketplaces,
  readyMarketplaces,
  type ExportCandidateItem
} from './exportReadiness'
import { shapeForPlatform } from './platformShapers'

const sampleAi = {
  title: 'Handwoven Jute Doormat',
  description: 'A durable, eco-friendly doormat woven from natural jute fiber.',
  bullets: ['100% natural jute', 'Non-slip backing', 'Absorbs moisture', 'Fits standard doorways', 'Easy to clean'],
  keywordPool: ['jute doormat', 'eco-friendly mat', 'natural fiber rug', 'entrance mat', 'doormat']
}

function readyItem(marketplace: string, productId = 'p1'): ExportCandidateItem {
  const content = shapeForPlatform(marketplace, sampleAi, { brand_name: 'Acme' })
  return { productId, content, generationError: null, meta: null }
}

// --- 1. All four marketplaces READY ---

test('a marketplace with all fully-shaped approved items is READY', () => {
  for (const m of ['amazon', 'flipkart', 'myntra', 'etsy'] as const) {
    const result = evaluateMarketplaceExportReadiness(m, [readyItem(m)])
    assert.equal(result.status, 'READY', `expected ${m} to be READY`)
    assert.deepEqual(result.issues, [])
  }
})

// --- 3. Zero marketplaces READY / missing required fields ---

test('a marketplace with a missing required field is NOT_READY, with the specific field named', () => {
  const incomplete = { title: 'Only a title', description: '', tags: [] } // etsy shape, missing description/tags
  const result = evaluateMarketplaceExportReadiness('etsy', [{ productId: 'p1', content: incomplete, generationError: null, meta: null }])
  assert.equal(result.status, 'NOT_READY')
  assert.ok(result.issues.length > 0)
  // Real field names from the adapter, never a generic "some fields missing".
  assert.ok(result.issues.some((i) => i.field === 'Required fields' || i.field === 'Description'))
})

test('a marketplace with a soft (warning-level) issue only is MISSING_FIELDS, not NOT_READY', () => {
  // Over the verified Amazon title limit (75) but otherwise complete —
  // computeListingHealth treats this as needs-review (warning), not
  // missing-data (error), and the readiness gate must preserve that
  // distinction rather than collapsing every non-READY case to NOT_READY.
  const content = {
    title: 'X'.repeat(100),
    description: 'A description.',
    bullets: ['a', 'b', 'c', 'd', 'e'],
    genericKeywords: 'k'
  }
  const meta = {
    titleFields: [{ key: 'title', label: 'Title', rawLength: 100, maxLength: 75, withinLimit: false }],
    descriptionField: null,
    keywordsField: null,
    bulletCount: 5
  }
  const result = evaluateMarketplaceExportReadiness('amazon', [{ productId: 'p1', content, generationError: null, meta }])
  assert.equal(result.status, 'MISSING_FIELDS')
})

test('a marketplace with zero approved items is NOT_READY, never fabricated as READY', () => {
  const result = evaluateMarketplaceExportReadiness('amazon', [])
  assert.equal(result.status, 'NOT_READY')
  assert.equal(result.itemCount, 0)
})

test('a generation error on any item is surfaced as an error-severity issue (NOT_READY)', () => {
  const result = evaluateMarketplaceExportReadiness('myntra', [
    { productId: 'p1', content: null, generationError: 'Model returned empty content', meta: null }
  ])
  assert.equal(result.status, 'NOT_READY')
  assert.ok(result.issues.some((i) => i.severity === 'error'))
})

// --- 5/6. Batch evaluation and export-set filtering ---

test('evaluateSelectedMarketplaces evaluates each marketplace independently from a per-marketplace item map', () => {
  const itemsByMarketplace = new Map<any, ExportCandidateItem[]>([
    ['amazon', [readyItem('amazon')]],
    ['flipkart', [{ productId: 'p1', content: { title: 't' }, generationError: null, meta: null }]], // missing required fields
    ['myntra', []],
    ['etsy', [readyItem('etsy')]]
  ])
  const results = evaluateSelectedMarketplaces(['amazon', 'flipkart', 'myntra', 'etsy'] as any, itemsByMarketplace)
  const byMarket = Object.fromEntries(results.map((r) => [r.marketplace, r.status]))
  assert.equal(byMarket.amazon, 'READY')
  assert.equal(byMarket.flipkart, 'NOT_READY')
  assert.equal(byMarket.myntra, 'NOT_READY') // zero items
  assert.equal(byMarket.etsy, 'READY')
})

test('readyMarketplaces returns only the READY subset — MISSING_FIELDS and NOT_READY are both excluded', () => {
  const itemsByMarketplace = new Map<any, ExportCandidateItem[]>([
    ['amazon', [readyItem('amazon')]],
    ['flipkart', [{ productId: 'p1', content: { title: 't' }, generationError: null, meta: null }]],
    ['myntra', []],
    ['etsy', [readyItem('etsy')]]
  ])
  const results = evaluateSelectedMarketplaces(['amazon', 'flipkart', 'myntra', 'etsy'] as any, itemsByMarketplace)
  assert.deepEqual(readyMarketplaces(results), ['amazon', 'etsy'])
})

test('when every selected marketplace is not ready, readyMarketplaces returns an empty list (export must be blocked)', () => {
  const itemsByMarketplace = new Map<any, ExportCandidateItem[]>()
  const results = evaluateSelectedMarketplaces(['amazon', 'flipkart'] as any, itemsByMarketplace)
  assert.deepEqual(readyMarketplaces(results), [])
})

// --- 8. Readiness evaluation failure never yields an automatic READY ---

test('a throwing validator never results in READY — it becomes a blocking issue instead', () => {
  // Malformed meta shape (wrong types) shouldn't be able to crash the
  // aggregation into an unhandled exception or a false READY.
  const brokenMeta: any = { titleFields: 'not-an-array' }
  const result = evaluateMarketplaceExportReadiness('amazon', [
    { productId: 'p1', content: { title: 't' }, generationError: null, meta: brokenMeta }
  ])
  assert.notEqual(result.status, 'READY')
})

// --- 12. Adapter isolation — evaluating one marketplace cannot affect another ---

test('evaluating one marketplace does not mutate another marketplace\'s result or shared item data', () => {
  const amazonItem = readyItem('amazon')
  const etsyItem = readyItem('etsy')
  const amazonBefore = JSON.stringify(amazonItem)
  const etsyBefore = JSON.stringify(etsyItem)

  evaluateMarketplaceExportReadiness('amazon', [amazonItem])
  evaluateMarketplaceExportReadiness('etsy', [etsyItem])
  evaluateMarketplaceExportReadiness('myntra', [{ productId: 'p1', content: null, generationError: 'boom', meta: null }])

  assert.equal(JSON.stringify(amazonItem), amazonBefore)
  assert.equal(JSON.stringify(etsyItem), etsyBefore)
})
