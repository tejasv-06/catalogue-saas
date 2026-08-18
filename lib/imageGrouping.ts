// Milestone C18: Multi-Image Product Grouping & Image-Only Intelligence.
//
// Pure and side-effect-free, deliberately kept out of
// app/api/group-product-images/route.ts's own module scope (which
// instantiates a real Groq client at import time, same reasoning as
// lib/productIntelligenceImages.ts): this is the highest-risk logic in the
// milestone (trusting an AI-proposed image-to-product mapping before it's
// ever used to create real catalog_products rows), so it's unit-testable
// for real with plain node:test, not only via source-inspection or live
// verification.

// Up to this many images per image-only import batch. Deliberately a
// SEPARATE, smaller cap than MAX_INTELLIGENCE_IMAGES/MAX_MANUAL_IMAGES (5,
// the per-PRODUCT cap): this is a per-IMPORT cap, before grouping has even
// decided how many products are in the batch. Kept small (not the "20-30"
// originally floated) per explicit product-owner direction: smaller batches
// keep the one-shot vision grouping call more accurate, keep latency
// reasonable, and keep the review UI legible without pagination.
export const MAX_IMAGE_GROUPING_BATCH = 10

// Confirmed live against the real model (qwen/qwen3.6-27b via Groq): vision
// requests are hard-capped at 3 images per call: "Too many images
// provided. This model supports up to 3 images." A batch above this many
// can never be one single Groq call the way MAX_IMAGE_GROUPING_BATCH's own
// doc comment originally assumed; see chunkImageUrls/remapChunkProposals
// below and app/api/group-product-images/route.ts's POST handler for how a
// batch above this size is split into multiple bounded calls instead of one
// call per image.
export const MAX_IMAGES_PER_GROUPING_CALL = 3

export type GroupingConfidence = 'high' | 'medium' | 'low'

const GROUPING_CONFIDENCE_VALUES: GroupingConfidence[] = ['high', 'medium', 'low']

// The raw, index-based shape the AI actually returns (and what
// validateGroupingResponse below produces): indexes are positions into the
// SAME imageUrls array the request was built from. Never a productId/DB
// concept: this route is fully stateless, no catalog_products row exists
// yet for any of these images.
export type GroupingProposal = {
  imageIndexes: number[]
  confidence: GroupingConfidence
}

// One card in the seller-facing review UI: the ephemeral, NEVER-persisted
// unit this whole milestone operates on right up until "Confirm & Analyze
// Products" turns each one into an ordinary DraftProduct. imageUrls[0] is
// always the primary image, same convention as DraftProduct.imageUrl/
// imageUrls elsewhere in the app.
export type ImageGroupCandidate = {
  id: string
  imageUrls: string[]
  confidence: GroupingConfidence
  // Derived from confidence at creation time, but tracked as its own field
  // (not re-derived from confidence on every render) so an explicit seller
  // "Looks right" resolution can clear it without pretending the AI's
  // original confidence changed.
  needsReview: boolean
}

export class GroupingValidationError extends Error {
  constructor(message: string) {
    super(`Image grouping validation failed: ${message}`)
    this.name = 'GroupingValidationError'
  }
}

// The single most important check in this whole module: every index
// 0..totalImages-1 appears in EXACTLY one group: never dropped, never
// duplicated across groups (which would silently put one uploaded image
// into two different products). Extracted on its own so the route can
// re-run the identical check on the FINAL, already-chunked-and-remapped
// result too (see remapChunkProposals below): the same invariant, checked
// twice: once per chunk (inside validateGroupingResponse) and once again
// over the whole original batch, so a chunking/remapping bug is caught
// immediately rather than trusted to hold by construction alone.
function assertExhaustiveNonOverlappingCoverage(proposals: GroupingProposal[], totalImages: number): void {
  const seenIndexes = new Set<number>()
  for (const proposal of proposals) {
    for (const idx of proposal.imageIndexes) {
      if (seenIndexes.has(idx)) {
        throw new GroupingValidationError(`image index ${idx} appears in more than one group`)
      }
      seenIndexes.add(idx)
    }
  }
  if (seenIndexes.size !== totalImages) {
    throw new GroupingValidationError(
      `every uploaded image must appear in exactly one group: got ${seenIndexes.size} of ${totalImages} images placed`
    )
  }
}

// C18-AC: every AI response passes through this before it can ever be
// shown to a seller or used to create a product. Throws (never coerces,
// never silently drops an image, never invents a plausible-looking group)
// on any structural mismatch: a malformed response becomes an explicit
// "couldn't confidently organize these images" failure upstream (§18),
// never a partially-wrong grouping presented as trustworthy.
export function validateGroupingResponse(raw: unknown, totalImages: number): GroupingProposal[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).groups)) {
    throw new GroupingValidationError('top-level response must be an object with a "groups" array')
  }

  const groups = (raw as { groups: unknown[] }).groups
  if (groups.length === 0) {
    throw new GroupingValidationError('"groups" must not be empty')
  }

  const seenIndexes = new Set<number>()
  const proposals: GroupingProposal[] = []

  for (const rawGroup of groups) {
    if (!rawGroup || typeof rawGroup !== 'object') {
      throw new GroupingValidationError('each group must be an object')
    }
    const g = rawGroup as Record<string, unknown>

    if (typeof g.confidence !== 'string' || !GROUPING_CONFIDENCE_VALUES.includes(g.confidence as GroupingConfidence)) {
      throw new GroupingValidationError(`"confidence" must be one of ${GROUPING_CONFIDENCE_VALUES.join(', ')}`)
    }

    const rawIndexes = g.image_indexes ?? g.imageIndexes
    if (!Array.isArray(rawIndexes) || rawIndexes.length === 0) {
      throw new GroupingValidationError('"image_indexes" must be a non-empty array')
    }
    const imageIndexes: number[] = []
    for (const idx of rawIndexes) {
      if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= totalImages) {
        throw new GroupingValidationError(`"image_indexes" entries must be integers in range [0, ${totalImages - 1}]`)
      }
      if (seenIndexes.has(idx)) {
        throw new GroupingValidationError(`image index ${idx} appears in more than one group`)
      }
      seenIndexes.add(idx)
      imageIndexes.push(idx)
    }

    proposals.push({ imageIndexes, confidence: g.confidence as GroupingConfidence })
  }

  assertExhaustiveNonOverlappingCoverage(proposals, totalImages)

  return proposals
}

// Splits a batch above MAX_IMAGES_PER_GROUPING_CALL into ordered,
// non-overlapping windows of at most maxPerChunk images each: e.g. 10
// images -> [0,1,2] [3,4,5] [6,7,8] [9]. Preserves upload order, which in
// practice is the single best heuristic available here anyway: a seller
// photographing one product at a time naturally uploads that product's
// photos consecutively, so most real batches already cluster by product
// along this exact axis. The one real limitation: two photos of the same
// product landing in different chunks: is knowingly left to the seller's
// own "Merge with" control in the review UI (§6: the seller stays in
// control) rather than a second, more expensive cross-chunk AI pass.
export function chunkImageUrls(imageUrls: string[], maxPerChunk: number = MAX_IMAGES_PER_GROUPING_CALL): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < imageUrls.length; i += maxPerChunk) {
    chunks.push(imageUrls.slice(i, i + maxPerChunk))
  }
  return chunks
}

// A chunk's own GroupingProposal[] is indexed 0..chunk.length-1, relative to
// THAT chunk alone: this shifts those local indexes back into the full
// original batch's index space (chunk 2 of [0,1,2],[3,4,5],... has offset
// 3, so its local index 0 becomes global index 3) so every chunk's results
// can be concatenated into one coherent, full-batch GroupingProposal[].
export function remapChunkProposals(proposals: GroupingProposal[], offset: number): GroupingProposal[] {
  return proposals.map((proposal) => ({
    ...proposal,
    imageIndexes: proposal.imageIndexes.map((idx) => idx + offset)
  }))
}

// Re-validates the FINAL, already-chunked-and-remapped proposal list
// against the whole original batch: see assertExhaustiveNonOverlappingCoverage's
// own doc comment for why this check is worth running twice.
export function validateChunkedGroupingResult(proposals: GroupingProposal[], totalImages: number): GroupingProposal[] {
  assertExhaustiveNonOverlappingCoverage(proposals, totalImages)
  return proposals
}

// Pure mapping from validated, index-based proposals + the original ordered
// URL list into the seller-facing ImageGroupCandidate[]: order within each
// group (and therefore which image is primary) is preserved exactly as the
// AI proposed it, itself following the original upload order.
export function buildImageGroupCandidates(proposals: GroupingProposal[], imageUrls: string[]): ImageGroupCandidate[] {
  return proposals.map((proposal) => ({
    id: crypto.randomUUID(),
    imageUrls: proposal.imageIndexes.map((idx) => imageUrls[idx]),
    confidence: proposal.confidence,
    needsReview: proposal.confidence === 'low'
  }))
}

// The trivial case (exactly one image) never needs an AI call at all:
// there is no grouping ambiguity possible with a single image. Also used as
// the client-side "Organize Manually" fallback after a grouping failure
// (§18): one group containing every uploaded image, which the seller can
// then split/move manually using the same review controls, rather than a
// second, separate manual-grouping UI.
export function buildSingleGroupFallback(imageUrls: string[]): ImageGroupCandidate[] {
  if (imageUrls.length === 0) return []
  return [
    {
      id: crypto.randomUUID(),
      imageUrls: [...imageUrls],
      confidence: 'high',
      needsReview: false
    }
  ]
}
