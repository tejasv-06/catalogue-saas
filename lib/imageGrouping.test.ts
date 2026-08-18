// Milestone C18: Multi-Image Product Grouping & Image-Only Intelligence.
// Real, executable tests against lib/imageGrouping.ts's pure logic: this
// is the highest-risk code in the milestone (an AI-proposed image-to-
// product mapping, trusted before any catalog_products row exists), so it
// gets real unit tests, not just source-inspection.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MAX_IMAGE_GROUPING_BATCH,
  MAX_IMAGES_PER_GROUPING_CALL,
  validateGroupingResponse,
  buildImageGroupCandidates,
  buildSingleGroupFallback,
  chunkImageUrls,
  remapChunkProposals,
  validateChunkedGroupingResult,
  GroupingValidationError
} from './imageGrouping'

test('the per-import batch cap is 10, per explicit product-owner direction', () => {
  assert.equal(MAX_IMAGE_GROUPING_BATCH, 10)
})

// --- validateGroupingResponse: the real, structural correctness checks ---

test('1 image -> 1 group', () => {
  const groups = validateGroupingResponse({ groups: [{ image_indexes: [0], confidence: 'high' }] }, 1)
  assert.deepEqual(groups, [{ imageIndexes: [0], confidence: 'high' }])
})

test('5 images all in one group (same product from 5 angles) -> 1 group', () => {
  const groups = validateGroupingResponse(
    { groups: [{ image_indexes: [0, 1, 2, 3, 4], confidence: 'high' }] },
    5
  )
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].imageIndexes, [0, 1, 2, 3, 4])
})

test('5 different products -> 5 separate one-image groups', () => {
  const groups = validateGroupingResponse(
    {
      groups: [0, 1, 2, 3, 4].map((i) => ({ image_indexes: [i], confidence: 'high' }))
    },
    5
  )
  assert.equal(groups.length, 5)
})

test('mixed upload -> correct grouping structure preserved exactly as proposed', () => {
  // 4 images of a red saree (0-3), 1 image of a different blue saree (4):
  // the exact example from the milestone spec.
  const groups = validateGroupingResponse(
    {
      groups: [
        { image_indexes: [0, 1, 2, 3], confidence: 'high' },
        { image_indexes: [4], confidence: 'high' }
      ]
    },
    5
  )
  assert.equal(groups.length, 2)
  assert.deepEqual(groups[0].imageIndexes, [0, 1, 2, 3])
  assert.deepEqual(groups[1].imageIndexes, [4])
})

test('a low-confidence group is accepted structurally (surfacing it for review is the caller\'s job, not a validation failure)', () => {
  const groups = validateGroupingResponse({ groups: [{ image_indexes: [0, 1], confidence: 'low' }] }, 2)
  assert.equal(groups[0].confidence, 'low')
})

test('rejects a response missing an image entirely (not every index appears in exactly one group)', () => {
  assert.throws(
    () => validateGroupingResponse({ groups: [{ image_indexes: [0], confidence: 'high' }] }, 2),
    GroupingValidationError
  )
})

test('rejects an image index appearing in two different groups', () => {
  assert.throws(
    () =>
      validateGroupingResponse(
        {
          groups: [
            { image_indexes: [0, 1], confidence: 'high' },
            { image_indexes: [1, 2], confidence: 'high' }
          ]
        },
        3
      ),
    /appears in more than one group/
  )
})

test('rejects an out-of-range image index', () => {
  assert.throws(() => validateGroupingResponse({ groups: [{ image_indexes: [5], confidence: 'high' }] }, 3), GroupingValidationError)
})

test('rejects a non-integer / negative index', () => {
  assert.throws(() => validateGroupingResponse({ groups: [{ image_indexes: [0.5], confidence: 'high' }] }, 2), GroupingValidationError)
  assert.throws(() => validateGroupingResponse({ groups: [{ image_indexes: [-1], confidence: 'high' }] }, 2), GroupingValidationError)
})

test('rejects an invalid confidence value', () => {
  assert.throws(
    () => validateGroupingResponse({ groups: [{ image_indexes: [0], confidence: 'certain' }] }, 1),
    GroupingValidationError
  )
})

test('rejects a response with no "groups" array at all', () => {
  assert.throws(() => validateGroupingResponse({}, 2), GroupingValidationError)
  assert.throws(() => validateGroupingResponse(null, 2), GroupingValidationError)
  assert.throws(() => validateGroupingResponse('not an object', 2), GroupingValidationError)
})

test('rejects an empty groups array (every image must land somewhere)', () => {
  assert.throws(() => validateGroupingResponse({ groups: [] }, 2), GroupingValidationError)
})

test('rejects an empty image_indexes array within a group', () => {
  assert.throws(() => validateGroupingResponse({ groups: [{ image_indexes: [], confidence: 'high' }] }, 1), GroupingValidationError)
})

// --- buildImageGroupCandidates: pure mapping to the UI-facing shape ------

test('buildImageGroupCandidates preserves image order within each group (so the first image stays primary)', () => {
  const urls = ['a.jpg', 'b.jpg', 'c.jpg']
  const candidates = buildImageGroupCandidates([{ imageIndexes: [2, 0], confidence: 'high' }], urls)
  assert.deepEqual(candidates[0].imageUrls, ['c.jpg', 'a.jpg'])
})

test('buildImageGroupCandidates sets needsReview true only for low confidence', () => {
  const urls = ['a.jpg', 'b.jpg', 'c.jpg']
  const [high, medium, low] = buildImageGroupCandidates(
    [
      { imageIndexes: [0], confidence: 'high' },
      { imageIndexes: [1], confidence: 'medium' },
      { imageIndexes: [2], confidence: 'low' }
    ],
    urls
  )
  assert.equal(high.needsReview, false)
  assert.equal(medium.needsReview, false)
  assert.equal(low.needsReview, true)
})

test('buildImageGroupCandidates assigns a unique id per group', () => {
  const urls = ['a.jpg', 'b.jpg']
  const candidates = buildImageGroupCandidates(
    [
      { imageIndexes: [0], confidence: 'high' },
      { imageIndexes: [1], confidence: 'high' }
    ],
    urls
  )
  assert.notEqual(candidates[0].id, candidates[1].id)
})

// --- buildSingleGroupFallback: the 1-image trivial case AND the "Organize
// Manually" fallback after a grouping failure -----------------------------

test('buildSingleGroupFallback with one image -> one high-confidence group containing it', () => {
  const result = buildSingleGroupFallback(['a.jpg'])
  assert.equal(result.length, 1)
  assert.deepEqual(result[0].imageUrls, ['a.jpg'])
  assert.equal(result[0].confidence, 'high')
  assert.equal(result[0].needsReview, false)
})

test('buildSingleGroupFallback with several images -> ALL of them in one group (never split, since this is the "couldn\'t determine grouping" fallback)', () => {
  const urls = ['a.jpg', 'b.jpg', 'c.jpg']
  const result = buildSingleGroupFallback(urls)
  assert.equal(result.length, 1)
  assert.deepEqual(result[0].imageUrls, urls)
})

test('buildSingleGroupFallback with zero images -> empty array, not a group with no images', () => {
  assert.deepEqual(buildSingleGroupFallback([]), [])
})

// --- Chunking (real model constraint: max 3 images per Groq call) --------

test('the real vision-model constraint is 3 images per call (confirmed live), separate from the 10-image per-import batch cap', () => {
  assert.equal(MAX_IMAGES_PER_GROUPING_CALL, 3)
  assert.ok(MAX_IMAGES_PER_GROUPING_CALL < MAX_IMAGE_GROUPING_BATCH)
})

test('chunkImageUrls splits a 10-image batch into 4 ordered chunks of at most 3, never more than 3 per chunk', () => {
  const urls = Array.from({ length: 10 }, (_, i) => `${i}.jpg`)
  const chunks = chunkImageUrls(urls, 3)
  assert.equal(chunks.length, 4)
  for (const chunk of chunks) assert.ok(chunk.length <= 3)
  assert.deepEqual(chunks, [['0.jpg', '1.jpg', '2.jpg'], ['3.jpg', '4.jpg', '5.jpg'], ['6.jpg', '7.jpg', '8.jpg'], ['9.jpg']])
})

test('chunkImageUrls on a batch already at or under the cap still produces exactly one chunk', () => {
  const urls = ['a.jpg', 'b.jpg', 'c.jpg']
  assert.deepEqual(chunkImageUrls(urls, 3), [urls])
})

test('remapChunkProposals shifts local (per-chunk) indexes into the full batch\'s global index space', () => {
  // Chunk 2 of a 3-per-chunk split starts at global offset 3.
  const localProposals = [{ imageIndexes: [0, 2], confidence: 'high' as const }, { imageIndexes: [1], confidence: 'medium' as const }]
  const remapped = remapChunkProposals(localProposals, 3)
  assert.deepEqual(remapped, [
    { imageIndexes: [3, 5], confidence: 'high' },
    { imageIndexes: [4], confidence: 'medium' }
  ])
})

test('a full 10-image, 4-chunk grouping round-trips correctly: every original image appears in exactly one group after remap+concatenate', () => {
  const urls = Array.from({ length: 10 }, (_, i) => `${i}.jpg`)
  const chunks = chunkImageUrls(urls, MAX_IMAGES_PER_GROUPING_CALL)
  // Simulate each chunk's own AI response: everything in one group per chunk.
  let offset = 0
  const allProposals = chunks.flatMap((chunk) => {
    const local = [{ imageIndexes: chunk.map((_, i) => i), confidence: 'high' as const }]
    const remapped = remapChunkProposals(local, offset)
    offset += chunk.length
    return remapped
  })
  const validated = validateChunkedGroupingResult(allProposals, urls.length)
  assert.equal(validated.length, 4) // one group per chunk in this simulation
  const allCoveredIndexes = validated.flatMap((p) => p.imageIndexes).sort((a, b) => a - b)
  assert.deepEqual(allCoveredIndexes, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('validateChunkedGroupingResult catches a chunking/remapping bug: a missing image after concatenation is never silently accepted', () => {
  // Deliberately "forget" image index 9 (as if the last chunk's result was dropped).
  const incomplete = [{ imageIndexes: [0, 1, 2], confidence: 'high' as const }, { imageIndexes: [3, 4, 5], confidence: 'high' as const }]
  assert.throws(() => validateChunkedGroupingResult(incomplete, 10), GroupingValidationError)
})

test('validateChunkedGroupingResult catches a duplicate index across two chunks\' remapped results', () => {
  const overlapping = [{ imageIndexes: [0, 1, 2], confidence: 'high' as const }, { imageIndexes: [2, 3], confidence: 'high' as const }]
  assert.throws(() => validateChunkedGroupingResult(overlapping, 4), /appears in more than one group/)
})

// --- Source-inspection: app/api/group-product-images/route.ts's own use of
// the chunking helpers above. Same convention lib/productIntelligenceImages
// .test.ts already uses for app/api/enrich-product/route.ts: that route
// instantiates a real Groq client at import time (throws without
// GROQ_API_KEY loaded), so it's read as raw source text rather than
// imported directly. -------------------------------------------------------

const routeSource = readFileSync(join(__dirname, '..', 'app', 'api', 'group-product-images', 'route.ts'), 'utf8')

function routeBodyOf(fnSignature: string, window = 2200): string {
  const start = routeSource.indexOf(fnSignature)
  assert.ok(start !== -1, `expected to find "${fnSignature}" in group-product-images/route.ts`)
  return routeSource.slice(start, start + window)
}

test('a batch at or under MAX_IMAGES_PER_GROUPING_CALL is still exactly one Groq call, unchanged from the original design', () => {
  const body = routeBodyOf('export async function POST(request: Request) {', 6000)
  assert.match(body, /resolvedImageUrls\.length <= MAX_IMAGES_PER_GROUPING_CALL/)
})

test('a batch above the model\'s 3-image limit is chunked, never sent as one oversized request that would repeat the live "Too many images" error', () => {
  const body = routeBodyOf('export async function POST(request: Request) {', 6000)
  assert.match(body, /chunkImageUrls\(resolvedImageUrls, MAX_IMAGES_PER_GROUPING_CALL\)/)
  assert.match(body, /for \(const chunk of chunks\) \{/)
  // Exactly one runGroupingCompletion call per loop iteration (per chunk):
  // never a nested loop over individual images within a chunk.
  const loopBody = body.slice(body.indexOf('for (const chunk of chunks) {'))
  const completionCalls = loopBody.match(/runGroupingCompletion\(/g) ?? []
  assert.equal(completionCalls.length, 1)
})

test('chunk results are remapped back into the full batch\'s index space and re-validated as a whole before ever reaching the client', () => {
  const body = routeBodyOf('export async function POST(request: Request) {', 6000)
  assert.match(body, /remapChunkProposals\(chunkProposals, offset\)/)
  assert.match(body, /validateChunkedGroupingResult\(remapped, resolvedImageUrls\.length\)/)
})

// --- Credit gate: check before any Groq call, deduct only after a real
// result exists (never before, never for a failed attempt) ----------------

test('group-product-images checks credits (assertSufficientCredits) before the trivial 1-image short-circuit and before any Groq call: never after', () => {
  const body = routeBodyOf('export async function POST(request: Request) {', 6000)
  const creditCheckIdx = body.indexOf('await assertSufficientCredits(userId, CREDIT_COSTS.imageGroupingRequest)')
  const trivialCaseIdx = body.indexOf('if (imageUrls.length === 1) {')
  const firstGroqCallIdx = body.indexOf('await runGroupingCompletion(')
  assert.ok(creditCheckIdx !== -1 && trivialCaseIdx !== -1 && firstGroqCallIdx !== -1)
  assert.ok(creditCheckIdx < trivialCaseIdx && creditCheckIdx < firstGroqCallIdx)
})

test('insufficient credits blocks the request with a 403 carrying creditsRemaining/creditsRequired: the same shape generate-single already uses', () => {
  const body = routeBodyOf('export async function POST(request: Request) {', 6000)
  assert.match(body, /creditsRemaining: err\.available, creditsRequired: err\.required \}[\s\S]{0,20}status: 403/)
})

test('the grouping-request credit is deducted exactly once per request (trivial case or real grouping), never per chunk, never per detected product, never per marketplace (Part F/H)', () => {
  const body = routeBodyOf('export async function POST(request: Request) {', 6000)
  const deductCalls = body.match(/await deductGroupingCredit\(\)/g) ?? []
  // Once for the trivial 1-image path, once for the real multi-image
  // success path: never inside the per-chunk loop, and there is no
  // per-detected-product or per-marketplace charge anywhere in this route.
  assert.equal(deductCalls.length, 2)
  const chunkLoopBody = body.slice(body.indexOf('for (const chunk of chunks) {'), body.indexOf('validateChunkedGroupingResult'))
  assert.ok(!/deductGroupingCredit/.test(chunkLoopBody))
  assert.ok(!/data\.groups\.length|groups\.length \*/.test(body), 'credit amount must never scale with the number of detected groups')
})

test('a FAILED grouping attempt never deducts a credit: deductGroupingCredit only runs after runGroupingCompletion/chunk calls have already succeeded (Part H)', () => {
  const body = routeBodyOf('export async function POST(request: Request) {', 6000)
  // The multi-image try block's deductGroupingCredit() call comes after
  // `const groups: GroupingProposal[] = ...` has already been assigned
  // (i.e. after every awaited Groq/validation call in that branch resolved
  // without throwing): a throw anywhere in that assignment skips straight
  // to the catch block below, which returns 502 without ever reaching
  // deductGroupingCredit().
  const groupsAssignIdx = body.indexOf('const groups: GroupingProposal[] =')
  const successDeductIdx = body.lastIndexOf('await deductGroupingCredit()')
  const catchIdx = body.indexOf('} catch (err: any) {', groupsAssignIdx)
  assert.ok(groupsAssignIdx !== -1 && successDeductIdx !== -1 && catchIdx !== -1)
  assert.ok(groupsAssignIdx < successDeductIdx && successDeductIdx < catchIdx)
  assert.match(body.slice(catchIdx), /status: 502 \}/)
})

test('the grouping credit is recorded with reason \'image_grouping\': not the generic \'generation\' reason', () => {
  const body = routeBodyOf('async function deductGroupingCredit() {', 500)
  assert.match(body, /deductCredits\(userId, CREDIT_COSTS\.imageGroupingRequest, 'image_grouping'\)/)
})

test('CreditTransactionReason (lib/credits.ts) includes image_grouping alongside every existing reason, unchanged and unremoved', () => {
  const creditsSource = readFileSync(join(__dirname, 'credits.ts'), 'utf8')
  assert.match(creditsSource, /export type CreditTransactionReason = 'generation' \| 'account_audit' \| 'refund' \| 'image_grouping'/)
})

test('imageGroupingRequest (1 credit/request) is defined in the shared CREDIT_COSTS, and there is no separate per-product/per-confirm credit constant: the grouping request is the only charge in this milestone', () => {
  const creditCostsSource = readFileSync(join(__dirname, 'creditCosts.ts'), 'utf8')
  assert.match(creditCostsSource, /imageGroupingRequest: 1/)
  assert.ok(!/imageOnlyProductAnalysis/.test(creditCostsSource), 'the old per-confirmed-product charge must be gone: Part L forbids a second credit system')
})

test('CREDIT_TRANSACTION_REASON_LABELS maps image_grouping to the seller-facing "Photo Grouping Analysis" label, alongside the existing reasons (Part I)', () => {
  const creditCostsSource = readFileSync(join(__dirname, 'creditCosts.ts'), 'utf8')
  assert.match(creditCostsSource, /image_grouping: 'Photo Grouping Analysis'/)
  assert.match(creditCostsSource, /generation: 'Listing Generation'/)
  assert.match(creditCostsSource, /account_audit: 'Account Audit'/)
  assert.match(creditCostsSource, /refund: 'Refund'/)
})

test('app/api/confirm-image-groups/route.ts no longer exists: confirming grouped products into DraftProducts is free, same as every other add path (Part L)', () => {
  assert.throws(() => readFileSync(join(__dirname, '..', 'app', 'api', 'confirm-image-groups', 'route.ts'), 'utf8'))
})

test('a migration widens the credit_transactions reason CHECK constraint to include image_grouping without dropping generation/account_audit/refund', () => {
  const migrationSource = readFileSync(
    join(__dirname, '..', 'supabase', 'migrations', '20260819_01_credit_transaction_reason_image_grouping.sql'),
    'utf8'
  )
  assert.match(migrationSource, /check \(reason in \('generation', 'account_audit', 'refund', 'image_grouping'\)\)/)
})

test('a migration widens catalog_products.image_urls\' max-length constraint to 10, for Photos Only\'s "Create Single Product" up-to-10-image case (Part D)', () => {
  const migrationSource = readFileSync(
    join(__dirname, '..', 'supabase', 'migrations', '20260819_02_catalog_products_image_urls_max_10.sql'),
    'utf8'
  )
  assert.match(migrationSource, /array_length\(image_urls, 1\) <= 10/)
})
