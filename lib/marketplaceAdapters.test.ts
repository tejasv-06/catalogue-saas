// Unit tests for lib/marketplaceAdapters.ts (Milestone C10), using Node's
// built-in test runner (no new dependency — tsx is already a project
// devDependency). Run with: npx tsx --test lib/marketplaceAdapters.test.ts
//
// This module wraps shapeForPlatform/computeListingHealth/flattenRow rather
// than reimplementing them, so most tests here assert EQUIVALENCE to those
// existing, already-tested-via-live-verification functions — the goal is
// proving the adapter is a faithful, non-duplicating wrapper, not
// re-deriving marketplace rules from scratch.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getMarketplaceAdapter, MARKETPLACE_ADAPTERS, type CanonicalProduct } from './marketplaceAdapters'
import { shapeForPlatform, SUPPORTED_MARKETPLACES } from './platformShapers'
import { flattenRow, exportColumns } from './exportShapers'
import { computeListingHealth } from './listingHealth'

const sampleAi = {
  title: 'Handwoven Jute Doormat',
  description: 'A durable, eco-friendly doormat woven from natural jute fiber.',
  bullets: ['100% natural jute', 'Non-slip backing', 'Absorbs moisture', 'Fits standard doorways', 'Easy to clean'],
  keywordPool: ['jute doormat', 'eco-friendly mat', 'natural fiber rug', 'entrance mat', 'doormat']
}

const sampleProduct: CanonicalProduct = {
  brandName: 'Acme',
  description: 'raw description',
  category: 'Home',
  imageUrl: null,
  intelligence: null
}

// --- 1. Adapter selection ---

test('getMarketplaceAdapter returns the correct adapter for each supported marketplace', () => {
  for (const m of SUPPORTED_MARKETPLACES) {
    const adapter = getMarketplaceAdapter(m)
    assert.ok(adapter, `expected an adapter for ${m}`)
    assert.equal(adapter!.marketplace, m)
  }
})

test('getMarketplaceAdapter returns undefined for shopify — not fabricated, genuinely unsupported', () => {
  // C10 audit finding: SUPPORTED_MARKETPLACES, MARKETPLACE_RULES, and
  // exportColumns all agree Shopify has no real support in this repo.
  // getMarketplaceAdapter must reflect that honestly, not invent a
  // best-effort adapter for it.
  assert.equal(getMarketplaceAdapter('shopify'), undefined)
})

test('getMarketplaceAdapter returns undefined for any other unknown/unsupported marketplace string', () => {
  assert.equal(getMarketplaceAdapter('tatacliq'), undefined)
  assert.equal(getMarketplaceAdapter(''), undefined)
  assert.equal(getMarketplaceAdapter('AMAZON'), undefined) // case-sensitive, matches shapeForPlatform's own switch
})

// --- 2-5. Canonical product -> marketplace transformation (equivalence to shapeForPlatform) ---

for (const marketplace of SUPPORTED_MARKETPLACES) {
  test(`${marketplace} adapter.shape() produces exactly what shapeForPlatform() produces for the same input`, () => {
    const adapter = getMarketplaceAdapter(marketplace)!
    const adapterResult = adapter.shape(sampleAi, sampleProduct)
    const directResult = shapeForPlatform(marketplace, sampleAi, { brand_name: sampleProduct.brandName })
    assert.deepEqual(adapterResult, directResult)
  })
}

test('myntra adapter.shape() correctly threads brandName into productDisplayName (canonical product data actually used)', () => {
  const adapter = getMarketplaceAdapter('myntra')!
  const result = adapter.shape(sampleAi, { ...sampleProduct, brandName: 'Acme' })
  assert.ok(result.productDisplayName.startsWith('Acme'))
})

// --- 6. Shopify transformation: must be reported unsupported, never fabricated ---

test('shopify has no adapter, so no shape/validate/export call can even be attempted for it', () => {
  const adapter = getMarketplaceAdapter('shopify')
  assert.equal(adapter, undefined)
  // Confirming the negative directly rather than only asserting undefined:
  // there must be no MARKETPLACE_ADAPTERS entry to accidentally fall back to.
  assert.ok(!('shopify' in MARKETPLACE_ADAPTERS))
})

// --- 7. Required-field validation ---

test('validate() reports NOT_READY with issues when required fields are missing', () => {
  const adapter = getMarketplaceAdapter('etsy')!
  const incompleteContent = { title: 'Only a title', description: '', tags: [] }
  const readiness = adapter.validate(incompleteContent, null, null)
  assert.equal(readiness.status, 'NOT_READY')
  assert.ok(readiness.issues.length > 0)
  assert.ok(readiness.issues.some((i) => i.field === 'Required fields' || i.field === 'Description'))
  assert.ok(readiness.issues.every((i) => i.marketplace === 'etsy'))
})

// --- 8. Character-limit validation ---

test('validate() reports a character-limit issue when a verified limit is exceeded', () => {
  const adapter = getMarketplaceAdapter('amazon')!
  const overLongTitle = 'X'.repeat(200) // amazon title limit is 75, verified
  const content = shapeForPlatform('amazon', { ...sampleAi, title: overLongTitle }, { brand_name: 'Acme' })
  // shapeForPlatform's own enforceCharLimit already shapes the stored title
  // down to fit — to exercise the "still over" branch, use meta reporting
  // the RAW pre-shape length as over limit (mirrors what a real generation
  // response's meta looks like when the model still exceeded the limit).
  const meta = {
    titleFields: [{ key: 'title', label: 'Title', rawLength: 200, maxLength: 75, withinLimit: false }],
    descriptionField: null,
    keywordsField: null,
    bulletCount: sampleAi.bullets.length
  }
  const readiness = adapter.validate(content, null, meta)
  assert.equal(readiness.status, 'NOT_READY')
  assert.ok(readiness.issues.some((i) => i.field === 'Character limit'))
})

// --- 9. Invalid marketplace output rejection ---

test('validate() rejects null content as NOT_READY (missing-data), never treats it as ready', () => {
  const adapter = getMarketplaceAdapter('flipkart')!
  const readiness = adapter.validate(null, null, null)
  assert.equal(readiness.status, 'NOT_READY')
  assert.ok(readiness.issues.length > 0)
})

test('validate() surfaces a generation error as NOT_READY with an error-severity issue', () => {
  const adapter = getMarketplaceAdapter('myntra')!
  const readiness = adapter.validate(null, 'Model returned empty content', null)
  assert.equal(readiness.status, 'NOT_READY')
  assert.ok(readiness.issues.some((i) => i.severity === 'error'))
})

// --- 10. Missing Product Intelligence handling ---

test('shape() works normally when CanonicalProduct.intelligence is null (existing generation behavior preserved)', () => {
  const adapter = getMarketplaceAdapter('amazon')!
  const productWithoutIntelligence: CanonicalProduct = { ...sampleProduct, intelligence: null }
  const result = adapter.shape(sampleAi, productWithoutIntelligence)
  assert.equal(result.title, shapeForPlatform('amazon', sampleAi, { brand_name: sampleProduct.brandName }).title)
})

// --- 11. Adapter isolation ---

test('using one marketplace adapter does not mutate another marketplace\'s adapter or its output', () => {
  const amazon = getMarketplaceAdapter('amazon')!
  const flipkart = getMarketplaceAdapter('flipkart')!

  const flipkartBefore = flipkart.shape(sampleAi, sampleProduct)
  // Exercise amazon's shape/validate/exportRow repeatedly in between.
  amazon.shape(sampleAi, sampleProduct)
  amazon.validate(amazon.shape(sampleAi, sampleProduct), null, null)
  amazon.exportRow(amazon.shape(sampleAi, sampleProduct))

  const flipkartAfter = flipkart.shape(sampleAi, sampleProduct)
  assert.deepEqual(flipkartBefore, flipkartAfter)
  assert.notEqual(getMarketplaceAdapter('amazon'), getMarketplaceAdapter('flipkart'))
})

test('MARKETPLACE_ADAPTERS entries are independent objects, not shared/mutated references', () => {
  const keys = Object.keys(MARKETPLACE_ADAPTERS)
  assert.deepEqual(new Set(keys), new Set(SUPPORTED_MARKETPLACES))
  for (const a of SUPPORTED_MARKETPLACES) {
    for (const b of SUPPORTED_MARKETPLACES) {
      if (a === b) continue
      assert.notEqual(MARKETPLACE_ADAPTERS[a], MARKETPLACE_ADAPTERS[b])
    }
  }
})

// --- 13. Existing export behavior preserved exactly ---

for (const marketplace of SUPPORTED_MARKETPLACES) {
  test(`${marketplace} adapter.exportRow()/exportColumns match flattenRow()/exportColumns exactly`, () => {
    const adapter = getMarketplaceAdapter(marketplace)!
    const content = shapeForPlatform(marketplace, sampleAi, { brand_name: sampleProduct.brandName })
    assert.deepEqual(adapter.exportRow(content), flattenRow(marketplace, content))
    assert.deepEqual(adapter.exportColumns, exportColumns[marketplace])
  })
}

test('adapter.validate() is functionally consistent with calling computeListingHealth directly', () => {
  const adapter = getMarketplaceAdapter('etsy')!
  const content = shapeForPlatform('etsy', sampleAi, { brand_name: sampleProduct.brandName })
  const readiness = adapter.validate(content, null, null)
  const health = computeListingHealth('etsy', content, null, null)
  assert.equal(readiness.status === 'READY', health.status === 'ready')
})
