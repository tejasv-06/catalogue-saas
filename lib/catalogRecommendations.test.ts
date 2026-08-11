// Unit tests for lib/catalogRecommendations.ts (Milestone C15 — Catalog
// Intelligence & Action Center). Run with:
// npx tsx --test lib/catalogRecommendations.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  computeCatalogRecommendations,
  sortRecommendations,
  summarizeByPriority,
  filterRecommendationsByPriority,
  type CatalogActionRecommendation,
  type RecommendationPriority
} from './catalogRecommendations'
import { evaluateMarketplaceExportReadiness, readyMarketplaces } from './exportReadiness'
import { filterProducts, sortProducts, DEFAULT_PRODUCT_FILTERS } from './catalogOperations'
import { shapeForPlatform } from './platformShapers'
import {
  emptyGeneratedContent,
  emptyApproved,
  emptyGenerationError,
  emptyGenerationMeta,
  type DraftProduct
} from './types'
import type { ProductIntelligence } from './productIntelligence'

const sampleAi = {
  title: 'Handwoven Jute Doormat',
  description: 'A durable, eco-friendly doormat woven from natural jute fiber.',
  bullets: ['100% natural jute', 'Non-slip backing', 'Absorbs moisture', 'Fits standard doorways', 'Easy to clean'],
  keywordPool: ['jute doormat', 'eco-friendly mat', 'natural fiber rug', 'entrance mat', 'doormat']
}

function baseProduct(overrides: Partial<DraftProduct> = {}): DraftProduct {
  return {
    id: overrides.id ?? 'p1',
    serverId: overrides.serverId ?? 'server-p1',
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

function readyContent(marketplace: string, brandName = 'Acme') {
  return shapeForPlatform(marketplace, sampleAi, { brand_name: brandName })
}

function withReadyApproved(product: DraftProduct, marketplace: 'amazon' = 'amazon', approved = true): DraftProduct {
  return {
    ...product,
    generatedContent: { ...product.generatedContent, [marketplace]: readyContent(marketplace, product.brandName) },
    approved: { ...product.approved, [marketplace]: approved }
  }
}

function intel(overrides: Partial<ProductIntelligence>): ProductIntelligence {
  return { status: 'not_started', updated_at: null, error: null, missing_information: [], data: null, ...overrides }
}

function findByProduct(recs: CatalogActionRecommendation[], productId: string) {
  return recs.filter((r) => r.productId === productId)
}

// --- 1. No intelligence -> ANALYZE ---

test('1. product with no intelligence yields an ANALYZE recommendation', () => {
  const p = baseProduct()
  const recs = computeCatalogRecommendations([p])
  const analyze = recs.find((r) => r.actionType === 'ANALYZE' && r.productId === p.id)
  assert.ok(analyze)
  assert.equal(analyze!.priority, 'high')
  assert.equal(analyze!.source, 'product_intelligence')
  assert.equal(analyze!.creditCost, 0)
})

// --- 2. Processing -> no duplicate ANALYZE ---

test('2. product currently processing yields no ANALYZE recommendation', () => {
  const p = baseProduct({ productIntelligence: intel({ status: 'processing' }) })
  const recs = computeCatalogRecommendations([p])
  assert.equal(recs.some((r) => r.actionType === 'ANALYZE' && r.productId === p.id), false)
})

// --- 3. Failed intelligence -> retry recommendation ---

test('3. failed intelligence yields a retry ANALYZE recommendation naming the real error', () => {
  const p = baseProduct({ productIntelligence: intel({ status: 'failed', error: 'Model returned empty content' }) })
  const recs = computeCatalogRecommendations([p])
  const retry = recs.find((r) => r.actionType === 'ANALYZE' && r.productId === p.id)
  assert.ok(retry)
  assert.match(retry!.reason, /Model returned empty content/)
})

// --- 4. Completed intelligence with missing information -> recommendation ---

test('4. completed intelligence with missing_information yields a COMPLETE_INFORMATION recommendation', () => {
  const p = baseProduct({
    productIntelligence: intel({ status: 'completed', missing_information: ['product image'] })
  })
  const recs = computeCatalogRecommendations([p])
  const rec = recs.find((r) => r.actionType === 'COMPLETE_INFORMATION' && r.productId === p.id)
  assert.ok(rec)
  assert.equal(rec!.priority, 'medium')
  assert.match(rec!.reason, /product image/)
})

test('4b. completed intelligence with NO missing information yields no recommendation', () => {
  const p = baseProduct({ productIntelligence: intel({ status: 'completed', missing_information: [] }) })
  const recs = computeCatalogRecommendations([p])
  assert.equal(recs.some((r) => r.actionType === 'COMPLETE_INFORMATION' && r.productId === p.id), false)
})

// --- 5. Missing marketplace listing -> GENERATE ---

test('5. an un-attempted marketplace yields a GENERATE recommendation with the real credit cost', () => {
  const p = baseProduct()
  const recs = computeCatalogRecommendations([p])
  const gen = recs.find((r) => r.actionType === 'GENERATE' && r.productId === p.id && r.marketplace === 'amazon')
  assert.ok(gen)
  assert.equal(gen!.priority, 'high')
  assert.equal(gen!.creditCost, 1)
})

// --- 6. Listing health error -> FIX (critical) ---

test('6. a generation error yields a critical FIX_LISTING recommendation', () => {
  const p = baseProduct({ generationError: { ...emptyGenerationError(), amazon: 'Model returned empty content' } })
  const recs = computeCatalogRecommendations([p])
  const fix = recs.find((r) => r.actionType === 'FIX_LISTING' && r.productId === p.id && r.marketplace === 'amazon')
  assert.ok(fix)
  assert.equal(fix!.priority, 'critical')
  assert.match(fix!.reason, /Model returned empty content/)
})

// --- 7. Listing health warning -> REVIEW (medium FIX_LISTING) ---

test('7. a warning-only (needs-review) listing yields a medium-priority review recommendation, not critical', () => {
  const content = {
    title: 'X'.repeat(100), // over Amazon's 75-char limit -> needs-review, not missing-data
    description: 'A description.',
    bullets: ['a', 'b', 'c', 'd', 'e'],
    genericKeywords: 'k'
  }
  const p = baseProduct({ generatedContent: { ...emptyGeneratedContent(), amazon: content } })
  const recs = computeCatalogRecommendations([p])
  const rec = recs.find((r) => r.productId === p.id && r.marketplace === 'amazon')
  assert.ok(rec)
  assert.equal(rec!.actionType, 'FIX_LISTING')
  assert.equal(rec!.priority, 'medium')
  assert.match(rec!.title, /Review/)
})

// --- 8. NOT_READY (missing required fields) -> critical FIX, never EXPORT ---

test('8. a NOT_READY (missing required field) marketplace yields critical FIX_LISTING and never an EXPORT recommendation', () => {
  const incomplete = { vendorArticleName: 'Only a name' } // missing listViewName/productDetails/etc.
  const p = baseProduct({
    generatedContent: { ...emptyGeneratedContent(), myntra: incomplete },
    approved: { ...emptyApproved(), myntra: true } // approved despite being incomplete -- must still never export
  })
  const recs = computeCatalogRecommendations([p])
  const fix = recs.find((r) => r.actionType === 'FIX_LISTING' && r.productId === p.id && r.marketplace === 'myntra')
  assert.ok(fix)
  assert.equal(fix!.priority, 'critical')
  assert.equal(recs.some((r) => r.actionType === 'EXPORT' && r.marketplace === 'myntra'), false)
})

// --- 9. READY marketplace -> EXPORT allowed ---

test('9. a READY, approved marketplace yields an EXPORT recommendation, and no APPROVE/FIX for that item', () => {
  const p = withReadyApproved(baseProduct(), 'amazon', true)
  const recs = computeCatalogRecommendations([p])
  const exportRec = recs.find((r) => r.actionType === 'EXPORT' && r.marketplace === 'amazon')
  assert.ok(exportRec)
  assert.equal(exportRec!.priority, 'medium')
  assert.equal(findByProduct(recs, p.id).some((r) => r.marketplace === 'amazon'), false)
})

test('9b. a READY but NOT YET approved marketplace yields an APPROVE recommendation, not EXPORT', () => {
  const p = withReadyApproved(baseProduct(), 'amazon', false)
  const recs = computeCatalogRecommendations([p])
  const approveRec = recs.find((r) => r.actionType === 'APPROVE' && r.productId === p.id && r.marketplace === 'amazon')
  assert.ok(approveRec)
  assert.equal(recs.some((r) => r.actionType === 'EXPORT' && r.marketplace === 'amazon'), false)
})

// --- 10. Brand profile missing fields -> brand recommendation ---

test('10. a selected brand missing voice/audience yields a REVIEW_BRAND recommendation', () => {
  const recs = computeCatalogRecommendations([baseProduct()], { brand_voice: null, target_audience: '' })
  const rec = recs.find((r) => r.actionType === 'REVIEW_BRAND')
  assert.ok(rec)
  assert.equal(rec!.priority, 'medium')
  assert.match(rec!.reason, /brand voice/)
  assert.match(rec!.reason, /target audience/)
})

test('10b. a complete brand profile yields no REVIEW_BRAND recommendation, and no brand context yields none either', () => {
  const withCompleteBrand = computeCatalogRecommendations([baseProduct()], { brand_voice: 'Playful', target_audience: 'Gen Z' })
  assert.equal(withCompleteBrand.some((r) => r.actionType === 'REVIEW_BRAND'), false)
  const withNoBrand = computeCatalogRecommendations([baseProduct()], null)
  assert.equal(withNoBrand.some((r) => r.actionType === 'REVIEW_BRAND'), false)
})

// --- 11-13. Priority ordering ---

function makeRec(priority: RecommendationPriority, id: string): CatalogActionRecommendation {
  return { id, actionType: 'REVIEW_BRAND', priority, title: id, reason: id, source: 'brand_profile' }
}

test('11. critical ranks above high', () => {
  const sorted = sortRecommendations([makeRec('high', 'h'), makeRec('critical', 'c')])
  assert.deepEqual(sorted.map((r) => r.id), ['c', 'h'])
})

test('12. high ranks above medium', () => {
  const sorted = sortRecommendations([makeRec('medium', 'm'), makeRec('high', 'h')])
  assert.deepEqual(sorted.map((r) => r.id), ['h', 'm'])
})

test('13. medium ranks above low', () => {
  const sorted = sortRecommendations([makeRec('low', 'l'), makeRec('medium', 'm')])
  assert.deepEqual(sorted.map((r) => r.id), ['m', 'l'])
})

// --- 14. Deterministic ordering for equal priority ---

test('14. equal-priority recommendations keep a stable, deterministic order across repeated calls', () => {
  const products = [
    baseProduct({ id: 'p1', brandName: 'Alpha' }),
    baseProduct({ id: 'p2', brandName: 'Beta' }),
    baseProduct({ id: 'p3', brandName: 'Gamma' })
  ]
  const run1 = computeCatalogRecommendations(products).map((r) => r.id)
  const run2 = computeCatalogRecommendations(products).map((r) => r.id)
  assert.deepEqual(run1, run2)
})

// --- 15. No recommendation for a fully healthy/complete/approved product ---

test('15. a listing that is fully generated, approved, and exported-ready, with complete intelligence, yields no per-item recommendation for that (product, marketplace) pair', () => {
  let p = baseProduct({ productIntelligence: intel({ status: 'completed', missing_information: [] }) })
  p = withReadyApproved(p, 'amazon', true)
  const recs = computeCatalogRecommendations([p])
  // No per-item recommendation should ever be attributed to the healthy
  // Amazon listing itself (only the marketplace-level EXPORT recommendation
  // may exist for it) — the product's other, never-attempted marketplaces
  // legitimately still generate their own GENERATE recommendations, which
  // is a separate, correct signal and not what this check is about.
  assert.equal(findByProduct(recs, p.id).some((r) => r.marketplace === 'amazon'), false)
  assert.equal(recs.some((r) => r.actionType === 'COMPLETE_INFORMATION' && r.productId === p.id), false)
})

// --- 16. Empty catalog ---

test('16. an empty catalog yields zero recommendations', () => {
  assert.deepEqual(computeCatalogRecommendations([], null), [])
})

// --- 17. No mutations ---

test('17. computing recommendations never mutates its inputs', () => {
  const p = baseProduct({ productIntelligence: intel({ status: 'completed', missing_information: ['image'] }) })
  const before = JSON.parse(JSON.stringify(p))
  const brand = { brand_voice: null, target_audience: null }
  const brandBefore = JSON.parse(JSON.stringify(brand))
  computeCatalogRecommendations([p], brand)
  assert.deepEqual(JSON.parse(JSON.stringify(p)), before)
  assert.deepEqual(JSON.parse(JSON.stringify(brand)), brandBefore)
})

// --- 18. No credit calls ---

test('18. computeCatalogRecommendations is synchronous (returns an array, never a Promise) and the module never imports credit-spending machinery', () => {
  const result = computeCatalogRecommendations([baseProduct()])
  assert.ok(Array.isArray(result))
  const source = fs.readFileSync(path.join(__dirname, 'catalogRecommendations.ts'), 'utf8')
  assert.ok(!/from ['"].\/credits['"]/.test(source), 'must never import lib/credits.ts')
  assert.ok(!/deductCredits|assertSufficientCredits|getSupabaseAdminClient/.test(source))
})

// --- 19. Existing C11 export readiness unchanged ---

test("19. lib/exportReadiness.ts's own behavior is unaffected by C15 (equivalence check against a known READY case)", () => {
  const content = readyContent('etsy')
  const result = evaluateMarketplaceExportReadiness('etsy', [{ productId: 'x', content, generationError: null, meta: null }])
  assert.equal(result.status, 'READY')
  assert.deepEqual(readyMarketplaces([result]), ['etsy'])
})

// --- 20. Existing C14 filtering/operations unchanged ---

test('20. lib/catalogOperations.ts filtering/sorting is unaffected by C15 (smoke test)', () => {
  const products = [baseProduct({ id: 'p1', brandName: 'Zed' }), baseProduct({ id: 'p2', brandName: 'Acme' })]
  const filtered = filterProducts(products, { ...DEFAULT_PRODUCT_FILTERS, brand: 'Acme' })
  assert.deepEqual(filtered.map((p) => p.id), ['p2'])
  const sorted = sortProducts(products, 'brand-az')
  assert.deepEqual(sorted.map((p) => p.id), ['p2', 'p1'])
})

// --- summarizeByPriority / filterRecommendationsByPriority ---

test('summarizeByPriority counts each priority bucket correctly', () => {
  const recs = [makeRec('critical', 'a'), makeRec('critical', 'b'), makeRec('high', 'c'), makeRec('low', 'd')]
  assert.deepEqual(summarizeByPriority(recs), { critical: 2, high: 1, medium: 0, low: 1 })
})

test('filterRecommendationsByPriority narrows to the requested priority, "all" returns everything', () => {
  const recs = [makeRec('critical', 'a'), makeRec('high', 'b')]
  assert.deepEqual(filterRecommendationsByPriority(recs, 'critical').map((r) => r.id), ['a'])
  assert.deepEqual(filterRecommendationsByPriority(recs, 'all'), recs)
})
