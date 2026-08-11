// Unit tests for lib/catalogOperations.ts (Milestone C14 — Catalog Command
// Center). Run with: npx tsx --test lib/catalogOperations.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeNeedsAttention,
  filterProducts,
  matchesProductFilters,
  getAvailableBrands,
  getAvailableCategories,
  sortProducts,
  hasActiveFilters,
  DEFAULT_PRODUCT_FILTERS,
  type ProductFilters
} from './catalogOperations'
import { shapeForPlatform } from './platformShapers'
import {
  emptyGeneratedContent,
  emptyApproved,
  emptyGenerationError,
  emptyGenerationMeta,
  type DraftProduct
} from './types'

const sampleAi = {
  title: 'Handwoven Jute Doormat',
  description: 'A durable, eco-friendly doormat woven from natural jute fiber.',
  bullets: ['100% natural jute', 'Non-slip backing', 'Absorbs moisture', 'Fits standard doorways', 'Easy to clean'],
  keywordPool: ['jute doormat', 'eco-friendly mat', 'natural fiber rug', 'entrance mat', 'doormat']
}

function baseProduct(overrides: Partial<DraftProduct> = {}): DraftProduct {
  return {
    id: overrides.id ?? 'p1',
    brandName: 'Acme',
    description: 'A test product',
    category: 'Home',
    imageFile: null,
    imageUrl: null,
    generatedContent: emptyGeneratedContent(),
    approved: emptyApproved(),
    status: 'draft',
    generationError: emptyGenerationError(),
    skipBrandVoice: false,
    generationMeta: emptyGenerationMeta(),
    visualAttributes: null,
    ...overrides
  }
}

function withAmazonReady(product: DraftProduct): DraftProduct {
  const content = shapeForPlatform('amazon', sampleAi, { brand_name: product.brandName })
  return {
    ...product,
    generatedContent: { ...product.generatedContent, amazon: content },
    status: 'generated'
  }
}

function withAmazonError(product: DraftProduct, message = 'Model returned empty content'): DraftProduct {
  return {
    ...product,
    generationError: { ...product.generationError, amazon: message }
  }
}

function withAmazonMissingData(product: DraftProduct): DraftProduct {
  // Missing description/bullets/genericKeywords -> health status 'missing-data'
  return {
    ...product,
    generatedContent: { ...product.generatedContent, amazon: { title: 'Only a title' } }
  }
}

// --- computeNeedsAttention ---

test('computeNeedsAttention flags error and missing-data rows, never ready/needs-review/not-attempted rows', () => {
  const errorProduct = withAmazonError(baseProduct({ id: 'p-error' }))
  const missingProduct = withAmazonMissingData(baseProduct({ id: 'p-missing' }))
  const readyProduct = withAmazonReady(baseProduct({ id: 'p-ready' }))
  const untouchedProduct = baseProduct({ id: 'p-untouched' })

  const items = computeNeedsAttention([errorProduct, missingProduct, readyProduct, untouchedProduct])
  const flaggedIds = items.map((i) => i.productId).sort()

  assert.deepEqual(flaggedIds, ['p-error', 'p-missing'])
  assert.equal(items.find((i) => i.productId === 'p-error')!.status, 'error')
  assert.equal(items.find((i) => i.productId === 'p-missing')!.status, 'missing-data')
})

// --- search ---

test('search matches brand name, category, and description, case-insensitively', () => {
  const p = baseProduct({ brandName: 'Sunrise Ceramics', category: 'Home Decor', description: 'hand-painted mugs' })
  assert.ok(matchesProductFilters(p, { ...DEFAULT_PRODUCT_FILTERS, search: 'ceramics' }, new Set()))
  assert.ok(matchesProductFilters(p, { ...DEFAULT_PRODUCT_FILTERS, search: 'DECOR' }, new Set()))
  assert.ok(matchesProductFilters(p, { ...DEFAULT_PRODUCT_FILTERS, search: 'painted' }, new Set()))
  assert.ok(!matchesProductFilters(p, { ...DEFAULT_PRODUCT_FILTERS, search: 'nonexistent term' }, new Set()))
})

// --- brand / category filters ---

test('brand and category filters match on exact real values only', () => {
  const p = baseProduct({ brandName: 'Acme', category: 'Home' })
  assert.ok(matchesProductFilters(p, { ...DEFAULT_PRODUCT_FILTERS, brand: 'Acme' }, new Set()))
  assert.ok(!matchesProductFilters(p, { ...DEFAULT_PRODUCT_FILTERS, brand: 'Other Brand' }, new Set()))
  assert.ok(matchesProductFilters(p, { ...DEFAULT_PRODUCT_FILTERS, category: 'Home' }, new Set()))
  assert.ok(!matchesProductFilters(p, { ...DEFAULT_PRODUCT_FILTERS, category: 'Electronics' }, new Set()))
})

test('getAvailableBrands/getAvailableCategories return sorted, de-duplicated, non-blank real values only', () => {
  const products = [
    baseProduct({ id: 'a', brandName: 'Zed', category: '' }),
    baseProduct({ id: 'b', brandName: 'Acme', category: 'Home' }),
    baseProduct({ id: 'c', brandName: 'Acme', category: 'Home' }),
    baseProduct({ id: 'd', brandName: '', category: 'Garden' })
  ]
  assert.deepEqual(getAvailableBrands(products), ['Acme', 'Zed'])
  assert.deepEqual(getAvailableCategories(products), ['Garden', 'Home'])
})

// --- marketplace filter ---

test('marketplace filter matches only products that have attempted that marketplace (content or error present)', () => {
  const attempted = withAmazonReady(baseProduct({ id: 'p1' }))
  const untouched = baseProduct({ id: 'p2' })
  assert.ok(matchesProductFilters(attempted, { ...DEFAULT_PRODUCT_FILTERS, marketplace: 'amazon' }, new Set()))
  assert.ok(!matchesProductFilters(untouched, { ...DEFAULT_PRODUCT_FILTERS, marketplace: 'amazon' }, new Set()))
})

// --- approval filter ---

test('approval filter: unapproved/approved/partially-approved are computed from attempted marketplaces only', () => {
  let p = withAmazonReady(baseProduct({ id: 'p1' }))
  // Not approved yet -> unapproved
  assert.ok(matchesProductFilters(p, { ...DEFAULT_PRODUCT_FILTERS, approval: 'unapproved' }, new Set()))
  assert.ok(!matchesProductFilters(p, { ...DEFAULT_PRODUCT_FILTERS, approval: 'approved' }, new Set()))

  // Approve the only attempted marketplace -> fully approved
  const approved = { ...p, approved: { ...p.approved, amazon: true } }
  assert.ok(matchesProductFilters(approved, { ...DEFAULT_PRODUCT_FILTERS, approval: 'approved' }, new Set()))
  assert.ok(!matchesProductFilters(approved, { ...DEFAULT_PRODUCT_FILTERS, approval: 'partially-approved' }, new Set()))

  // A product with an untouched marketplace never counts as an "attempted"
  // row for approval purposes — never confused with a real unapproved listing.
  const neverAttempted = baseProduct({ id: 'p2' })
  assert.ok(!matchesProductFilters(neverAttempted, { ...DEFAULT_PRODUCT_FILTERS, approval: 'unapproved' }, new Set()))
  assert.ok(!matchesProductFilters(neverAttempted, { ...DEFAULT_PRODUCT_FILTERS, approval: 'approved' }, new Set()))
})

// --- attentionOnly ---

test('attentionOnly restricts to the supplied attention product-id set', () => {
  const p1 = baseProduct({ id: 'p1' })
  const p2 = baseProduct({ id: 'p2' })
  const attentionIds = new Set(['p1'])
  assert.ok(matchesProductFilters(p1, { ...DEFAULT_PRODUCT_FILTERS, attentionOnly: true }, attentionIds))
  assert.ok(!matchesProductFilters(p2, { ...DEFAULT_PRODUCT_FILTERS, attentionOnly: true }, attentionIds))
})

// --- filterProducts (integration of the above + the internal attention computation) ---

test('filterProducts returns the identical array reference when no filters are active (cheap no-op path)', () => {
  const products = [baseProduct({ id: 'p1' })]
  assert.equal(filterProducts(products, DEFAULT_PRODUCT_FILTERS), products)
})

test('filterProducts combines search + brand + marketplace + approval correctly', () => {
  const match = { ...withAmazonReady(baseProduct({ id: 'p1', brandName: 'Acme', category: 'Home' })) }
  const wrongBrand = withAmazonReady(baseProduct({ id: 'p2', brandName: 'Other', category: 'Home' }))
  const filters: ProductFilters = { ...DEFAULT_PRODUCT_FILTERS, brand: 'Acme', marketplace: 'amazon', approval: 'unapproved' }
  const result = filterProducts([match, wrongBrand], filters)
  assert.deepEqual(result.map((p) => p.id), ['p1'])
})

test('hasActiveFilters is false only for the untouched default filter set', () => {
  assert.equal(hasActiveFilters(DEFAULT_PRODUCT_FILTERS), false)
  assert.equal(hasActiveFilters({ ...DEFAULT_PRODUCT_FILTERS, search: 'x' }), true)
  assert.equal(hasActiveFilters({ ...DEFAULT_PRODUCT_FILTERS, approval: 'approved' }), true)
})

// --- sorting ---

test('sortProducts: newest first is a reverse of creation order, oldest first preserves it', () => {
  const products = [baseProduct({ id: 'p1' }), baseProduct({ id: 'p2' }), baseProduct({ id: 'p3' })]
  assert.deepEqual(sortProducts(products, 'oldest').map((p) => p.id), ['p1', 'p2', 'p3'])
  assert.deepEqual(sortProducts(products, 'newest').map((p) => p.id), ['p3', 'p2', 'p1'])
})

test('sortProducts: brand-az / brand-za sort alphabetically by brand name', () => {
  const products = [baseProduct({ id: 'p1', brandName: 'Zed' }), baseProduct({ id: 'p2', brandName: 'Acme' })]
  assert.deepEqual(sortProducts(products, 'brand-az').map((p) => p.id), ['p2', 'p1'])
  assert.deepEqual(sortProducts(products, 'brand-za').map((p) => p.id), ['p1', 'p2'])
})

test('sortProducts: attention-first puts needs-attention products ahead without reordering within each group', () => {
  const ok = baseProduct({ id: 'p1' })
  const bad = withAmazonError(baseProduct({ id: 'p2' }))
  const alsoOk = baseProduct({ id: 'p3' })
  const result = sortProducts([ok, bad, alsoOk], 'attention-first')
  assert.equal(result[0].id, 'p2')
})

test('sortProducts never mutates its input array', () => {
  const products = [baseProduct({ id: 'p1' }), baseProduct({ id: 'p2' })]
  const original = [...products]
  sortProducts(products, 'newest')
  assert.deepEqual(products.map((p) => p.id), original.map((p) => p.id))
})
