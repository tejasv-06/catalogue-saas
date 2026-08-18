import Groq from 'groq-sdk'
import { NextResponse } from 'next/server'
import { createClient as createAuthClient } from '@/lib/supabase/server'
import {
  MAX_IMAGE_GROUPING_BATCH,
  MAX_IMAGES_PER_GROUPING_CALL,
  validateGroupingResponse,
  validateChunkedGroupingResult,
  chunkImageUrls,
  remapChunkProposals,
  type GroupingProposal
} from '@/lib/imageGrouping'
import { CREDIT_COSTS, InsufficientCreditsError, assertSufficientCredits, deductCredits } from '@/lib/credits'

// Milestone C18: Image-only product grouping boundary.
//
// Fully stateless: takes only { imageUrls: string[] } (already-uploaded
// Supabase Storage URLs, same "upload first, then send URLs to Groq"
// convention app/api/enrich-product/route.ts and app/api/generate-single/
// route.ts already use) and returns a proposed image-to-product grouping.
// No productId, no catalog_products read or write anywhere in this file:
// grouping happens strictly BEFORE any product exists, since Product
// Intelligence's own prompt already hard-codes "all images given to me are
// one product" (see enrich-product/route.ts) and would be the wrong place
// to un-group anything after the fact.
//
// Auth: requires a signed-in session, same gate app/api/enrich-product/
// route.ts already uses: this is a genuinely new AI-calling surface, and
// image-only batch import is meaningless without a persisted catalog to
// import into (guests never get a catalog_products row for anything).

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

// Duplicated from app/api/enrich-product/route.ts's own formatDirectImageUrl
// rather than extracted into a shared module: same established convention
// in this pair of route files (small, stable, pure, no unrelated refactor).
function formatDirectImageUrl(url: string): string {
  const driveFileMatch = url.match(/\/file\/d\/([^/]+)/)
  const driveIdMatch = url.match(/[?&]id=([^&]+)/)
  const driveFileId = driveFileMatch?.[1] || driveIdMatch?.[1]

  if (url.includes('drive.google.com') && driveFileId) {
    return `https://lh3.googleusercontent.com/d/${driveFileId}`
  }

  if (url.includes('dropbox.com')) {
    return url.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace('dl=0', 'raw=1')
  }

  return url
}

class EmptyContentError extends Error {
  constructor() {
    super('Model returned empty content')
  }
}

// §3/§4 of the milestone spec, verbatim as the model's own instructions:
// the two halves matter equally: what SHOULD be grouped together (angles,
// close-ups, lifestyle/model shots, packaging of the same physical product)
// and what should NOT be assumed identical just because it looks similar
// (different sarees/shirts/wall-art that merely share a color or general
// shape are different sellable products, not the same one photographed
// twice). The model is never told how many products to expect.
function buildSystemPrompt(imageCount: number): string {
  return `You are a product-boundary analyst. You will be shown ${imageCount} product photos, numbered 0 to ${imageCount - 1} in the order given. Your ONLY job is to determine which photos show the SAME physical, sellable product and which show DIFFERENT products: you are not describing or evaluating any product, only grouping the photos.

Group photos together when they show the same product from a different angle, a close-up/detail shot of the same product, a lifestyle photo or a model wearing/displaying the same product, or packaging that belongs with the same product. Do NOT treat photos as different products merely because the camera angle, background, framing, lighting, or zoom level differs, or because one photo is a close-up and another is a wide shot.

Do NOT over-trust simple visual similarity. Two different products that merely share a similar color, general shape, or category (e.g. two different sarees, two different shirts, two different wall-art pieces) are DIFFERENT products unless the photos actually show the same individual item: evaluate actual product identity (construction, exact pattern, exact design details, distinguishing features), not just "these look similar." When genuinely uncertain whether two photos show the same item or two similar-but-different items, do not guess a merge: reflect that uncertainty honestly in "confidence" rather than picking a side.

For every group, report a "confidence":
- "high": you are strongly confident all photos in this group show the same product.
- "medium": meaningful evidence supports the grouping, but with some ambiguity.
- "low": you cannot reliably determine whether these photos belong together.

Every one of the ${imageCount} photos (indexes 0 through ${imageCount - 1}) must appear in EXACTLY ONE group: never omitted, never placed in two groups. A photo that is clearly its own separate product is still its own one-photo group.

Respond ONLY with valid, raw JSON in exactly this shape:
{
  "groups": [
    { "image_indexes": [0, 2, 3], "confidence": "high" },
    { "image_indexes": [1], "confidence": "medium" }
  ]
}
CRITICAL: Output ONLY valid JSON. No markdown fences, no commentary.`
}

async function runGroupingCompletion(imageUrls: string[]): Promise<string> {
  const userContent = [
    { type: 'text' as const, text: `Here are the ${imageUrls.length} photos to group, in order (index 0 first).` },
    ...imageUrls.map((url) => ({ type: 'image_url' as const, image_url: { url } }))
  ]

  const completion = await groq.chat.completions.create({
    model: 'qwen/qwen3.6-27b',
    reasoning_effort: 'none',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildSystemPrompt(imageUrls.length) },
      { role: 'user', content: userContent }
    ]
  })

  const content = completion.choices[0]?.message?.content
  if (!content || !content.trim()) throw new EmptyContentError()
  return content
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const imageUrls = body?.imageUrls

  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    return NextResponse.json({ error: 'At least one image URL is required' }, { status: 400 })
  }
  if (!imageUrls.every((url) => typeof url === 'string' && url.trim() !== '')) {
    return NextResponse.json({ error: 'Every imageUrl must be a non-empty string' }, { status: 400 })
  }
  if (imageUrls.length > MAX_IMAGE_GROUPING_BATCH) {
    return NextResponse.json(
      { error: `Up to ${MAX_IMAGE_GROUPING_BATCH} images per import: got ${imageUrls.length}` },
      { status: 400 }
    )
  }

  // Session required: same gate as app/api/enrich-product/route.ts. No
  // service-role client exists anywhere in this file; RLS is never
  // consulted here at all since this route never touches the database.
  const authClient = await createAuthClient()
  const { data: authData } = await authClient.auth.getClaims()
  if (!authData?.claims) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }
  const userId = authData.claims.sub as string

  // Credit check runs BEFORE any Groq call (including the trivial one-image
  // short-circuit below, which still counts as the seller "initiating a
  // grouping request" even though it does no real vision work): same
  // fail-closed, check-before-call discipline app/api/generate-single/
  // route.ts already uses for its own per-marketplace charge.
  try {
    await assertSufficientCredits(userId, CREDIT_COSTS.imageGroupingRequest)
  } catch (err: any) {
    if (err instanceof InsufficientCreditsError) {
      return NextResponse.json(
        { error: err.message, creditsRemaining: err.available, creditsRequired: err.required },
        { status: 403 }
      )
    }
    console.error('group-product-images: credit check failed:', err?.message ?? err)
    return NextResponse.json({ error: 'Could not verify credit balance. Please try again.' }, { status: 500 })
  }

  // Deducted only after a real result exists (trivial or AI-grouped):
  // mirrors generate-single's own "never charge for a call that never
  // produced anything" discipline. A deduction failure here is logged but
  // never discards an already-successful grouping result, same reasoning
  // generate-single already documents for its own post-success deduction.
  async function deductGroupingCredit() {
    try {
      await deductCredits(userId, CREDIT_COSTS.imageGroupingRequest, 'image_grouping')
    } catch (err: any) {
      console.error('group-product-images: failed to deduct credits:', err?.message ?? err)
    }
  }

  // The trivial case: one image can never be ambiguous, so it never needs a
  // Groq call at all: one group, high confidence, by construction.
  if (imageUrls.length === 1) {
    await deductGroupingCredit()
    return NextResponse.json({ groups: [{ imageIndexes: [0], confidence: 'high' }] as GroupingProposal[] })
  }

  try {
    const resolvedImageUrls = imageUrls.map(formatDirectImageUrl)

    // Confirmed live against the real model: vision requests are hard-capped
    // at MAX_IMAGES_PER_GROUPING_CALL (3) images. A batch at or under that
    // limit is still exactly one Groq call, as originally designed. A
    // larger batch (up to MAX_IMAGE_GROUPING_BATCH) is split into ordered
    // chunks of at most 3 images each: still nowhere near "one call per
    // image" (10 images is 4 calls, not 10): and each chunk's own
    // 0-indexed result is shifted back into the full batch's index space
    // before being concatenated. See chunkImageUrls/remapChunkProposals in
    // lib/imageGrouping.ts for why this is the right tradeoff, including
    // the one known limitation (two photos of the same product landing in
    // different chunks won't auto-merge: the seller's own "Merge with"
    // control in the review UI is the intended fallback for that).
    const groups: GroupingProposal[] =
      resolvedImageUrls.length <= MAX_IMAGES_PER_GROUPING_CALL
        ? await (async () => {
            const rawContent = await runGroupingCompletion(resolvedImageUrls)
            const cleaned = rawContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
            // C18-AC: every response validated before it's ever returned to
            // the client; a malformed response never reaches the seller as a
            // trustworthy-looking grouping (see validateGroupingResponse's
            // own doc comment for why this is the highest-risk logic in the
            // milestone).
            return validateGroupingResponse(JSON.parse(cleaned), resolvedImageUrls.length)
          })()
        : await (async () => {
            const chunks = chunkImageUrls(resolvedImageUrls, MAX_IMAGES_PER_GROUPING_CALL)
            const remapped: GroupingProposal[] = []
            let offset = 0
            for (const chunk of chunks) {
              const rawContent = await runGroupingCompletion(chunk)
              const cleaned = rawContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
              const chunkProposals = validateGroupingResponse(JSON.parse(cleaned), chunk.length)
              remapped.push(...remapChunkProposals(chunkProposals, offset))
              offset += chunk.length
            }
            // Defensive re-check over the WHOLE original batch: catches a
            // chunking/remapping bug immediately instead of trusting the
            // invariant to hold by construction alone.
            return validateChunkedGroupingResult(remapped, resolvedImageUrls.length)
          })()

    await deductGroupingCredit()
    return NextResponse.json({ groups })
  } catch (err: any) {
    const message = err?.message || 'Grouping failed'
    console.error('group-product-images: grouping failed:', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
