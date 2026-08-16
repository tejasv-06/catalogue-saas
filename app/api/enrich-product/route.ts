import Groq from 'groq-sdk'
import { NextResponse } from 'next/server'
import { createClient as createAuthClient } from '@/lib/supabase/server'
import { getProductById, setProductIntelligence } from '@/lib/catalog'
import {
  PRODUCT_INTELLIGENCE_FIELD_KEYS,
  EXAMPLE_PRODUCT_INTELLIGENCE_DATA,
  validateProductIntelligenceData,
  validateMissingInformation,
  buildProcessingIntelligence,
  buildCompletedIntelligence,
  buildFailedIntelligence,
  type ProductIntelligence
} from '@/lib/productIntelligence'

// Milestone 32 (C9 / Phase 10J) — Product Intelligence enrichment boundary.
//
// Deliberately takes only { productId } from the browser — never brandName/
// description/imageUrl the way generate-single does. The raw product is
// loaded server-side, through the request's own session-cookie-bound
// Supabase client (lib/supabase/server.ts, the same one used for the
// auth check below), so RLS decides what this request can see — there is
// no owner id anywhere in the request body to spoof, and no service-role
// client is used anywhere in this route.

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

// Duplicated from app/api/generate-single/route.ts rather than extracted
// into a shared module — small, stable, pure, and this milestone's own
// scope rules say no unrelated refactors of that (C1-C8-adjacent,
// unmodified-except-for-the-one-explicit-C9-integration-point) file.
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

const FIELD_DESCRIPTIONS: Record<(typeof PRODUCT_INTELLIGENCE_FIELD_KEYS)[number], string> = {
  product_type: 'the specific product type/category (e.g. "ceramic wall clock", not just "clock")',
  material: 'primary material(s) the product is made of',
  pattern: 'visible pattern, print, or texture, if any',
  colors: 'the product\'s actual color(s) — an array of color names',
  style: 'overall design style (e.g. "bohemian", "minimalist", "vintage")',
  occasion: 'occasion(s) or use-case this product suits (e.g. "housewarming gift", "daily wear")',
  target_customer: 'who this product is most likely made for',
  key_selling_points: 'an array of 2-5 short, concrete selling points actually supported by the given data/image',
  search_keywords: 'an array of 8-15 realistic marketplace search terms a buyer might use to find this product'
}

// C9 follow-up — the schema used to be described to the model with abstract
// TypeScript-union pseudocode (`"value": string | string[] | null`) for
// every field uniformly. Live testing (7 real Groq calls) showed the model
// reliably collapsed exactly the array-shaped fields (colors,
// key_selling_points) down to a bare array, dropping the { value,
// confidence } wrapper entirely — while every scalar field came back
// correctly shaped. Replacing the abstract description with one complete,
// concrete, already-valid worked example (EXAMPLE_PRODUCT_INTELLIGENCE_DATA,
// see lib/productIntelligence.ts) plus an explicit right/wrong contrast for
// the exact failure mode observed is the fix — not a validator change.
function buildSystemPrompt(): string {
  const exampleJson = JSON.stringify(
    { data: EXAMPLE_PRODUCT_INTELLIGENCE_DATA, missing_information: ['example: no product image provided'] },
    null,
    2
  )

  const fieldGuide = PRODUCT_INTELLIGENCE_FIELD_KEYS.map((key) => `- ${key}: ${FIELD_DESCRIPTIONS[key]}`).join('\n')
  const arrayFieldKeys = ['colors', 'key_selling_points', 'search_keywords'].join(', ')

  return `You are a product data analyst building a canonical, factual understanding of a single product from its raw description, category, and (when provided) its photo — BEFORE any marketplace-specific listing copy is written elsewhere. Your output is used as ground truth by other systems, not as sales copy.

Field guide:
${fieldGuide}

Critical rules:
- Never invent or guess a specific fact you cannot actually support from the given text/image. If something isn't stated and isn't visible, set "value" to null and "confidence" to "unknown" for that field — do not fabricate a plausible-sounding answer (see the "occasion" field in the example below, which is genuinely unknown there).
- "confidence" must honestly reflect certainty: "high" only when directly stated or unambiguously visible, "low" for a reasonable inference, "unknown" when you genuinely cannot tell. It is always one of exactly these four words: "high", "medium", "low", "unknown" — never a number, never any other word.
- "evidence" is optional — include a short phrase citing what told you this only when you have one; otherwise omit it entirely or set it to null.
- Additionally return "missing_information": a string array naming genuinely missing inputs that limited this analysis — an empty array if nothing relevant is missing.

CRITICAL — every single one of the 9 fields under "data" (${PRODUCT_INTELLIGENCE_FIELD_KEYS.join(', ')}) MUST be an object shaped exactly like { "value": ..., "confidence": "..." }, with NO exceptions. This applies identically to ${arrayFieldKeys} — their "value" is a list, but the FIELD ITSELF is still the object wrapper, never the bare list.
WRONG (do not do this): "colors": ["white", "blue"]
RIGHT: "colors": { "value": ["white", "blue"], "confidence": "high" }
WRONG (do not do this): "key_selling_points": ["handmade", "unique design"]
RIGHT: "key_selling_points": { "value": ["handmade", "unique design"], "confidence": "medium" }

Here is a complete, correctly-shaped example response for a different, unrelated product — copy this exact structure for every field (all 9 must be present), changing only the actual content to match the REAL product you were given:
${exampleJson}

Respond ONLY with valid, raw JSON in exactly the same shape as the example above (a top-level "data" object with all 9 fields, and "missing_information").
CRITICAL: Output ONLY valid JSON. No markdown fences, no commentary.`
}

async function runEnrichmentCompletion(promptText: string, imageUrl: string | null): Promise<string> {
  const userContent = imageUrl
    ? [{ type: 'text' as const, text: promptText }, { type: 'image_url' as const, image_url: { url: imageUrl } }]
    : promptText

  const completion = await groq.chat.completions.create({
    model: 'qwen/qwen3.6-27b',
    reasoning_effort: 'none',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: userContent }
    ]
  })

  const content = completion.choices[0]?.message?.content
  if (!content || !content.trim()) throw new EmptyContentError()
  return content
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const productId = body?.productId

  if (!productId || typeof productId !== 'string') {
    return NextResponse.json({ error: 'Missing productId' }, { status: 400 })
  }

  // Session-bound client — every downstream lib/catalog.ts call rides on
  // this same client, so RLS (auth.uid() = owner_user_id, unchanged from
  // C1/C6) is the only authorization mechanism in this entire route. No
  // service-role client exists anywhere in this file.
  const authClient = await createAuthClient()
  const { data: authData } = await authClient.auth.getClaims()
  if (!authData?.claims) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  let product
  try {
    product = await getProductById(productId, authClient)
  } catch (err: any) {
    console.error('enrich-product: failed to load product:', err?.message ?? err)
    return NextResponse.json({ error: 'Could not load product' }, { status: 500 })
  }

  // Same result for "doesn't exist" and "exists but isn't yours" — RLS
  // already collapsed those into one case in getProductById, and this route
  // must not try to tell them apart (that would leak existence of another
  // user's row).
  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  // Avoid duplicate concurrent enrichment (C9 §4) — a practical, DB-observed
  // check, not a hard lock: if a prior request already marked this product
  // 'processing' and hasn't finished, decline a second one rather than
  // running two Groq calls against the same row.
  if (product.product_intelligence?.status === 'processing') {
    return NextResponse.json({ error: 'Enrichment is already in progress for this product' }, { status: 409 })
  }

  const previous = product.product_intelligence ?? null

  try {
    await setProductIntelligence(productId, buildProcessingIntelligence(previous), authClient)
  } catch (err: any) {
    console.error('enrich-product: failed to mark processing:', err?.message ?? err)
    return NextResponse.json({ error: 'Could not start enrichment' }, { status: 500 })
  }

  const hasDescription = !!(product.description && product.description.trim())
  const promptText = hasDescription
    ? `Brand: ${product.brand_name || 'N/A'}\nCategory: ${product.category || 'unspecified'}\nRaw description: ${product.description}`
    : `Brand: ${product.brand_name || 'N/A'}\nCategory: ${product.category || 'unspecified'}\nNo raw description was provided for this product — analyze the image only.`

  if (!hasDescription && !product.image_url) {
    const failed = buildFailedIntelligence(previous, 'Product has neither a description nor an image to analyze')
    try {
      await setProductIntelligence(productId, failed, authClient)
    } catch (err: any) {
      console.error('enrich-product: failed to persist failure state:', err?.message ?? err)
    }
    return NextResponse.json({ error: failed.error }, { status: 400 })
  }

  const resolvedImageUrl = product.image_url ? formatDirectImageUrl(product.image_url) : null

  let persisted: ProductIntelligence
  try {
    const rawContent = await runEnrichmentCompletion(promptText, resolvedImageUrl)
    const cleaned = rawContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned)

    // C9-AC6 — every field validated before anything is persisted. A
    // malformed response throws here and is caught below as a 'failed'
    // enrichment, never partially/silently written.
    const data = validateProductIntelligenceData(parsed.data)
    const missingInformation = validateMissingInformation(parsed.missing_information)

    const completed = buildCompletedIntelligence(data, missingInformation)
    const row = await setProductIntelligence(productId, completed, authClient)
    persisted = row.product_intelligence as ProductIntelligence
  } catch (err: any) {
    const message = err?.message || 'Enrichment failed'
    console.error(`enrich-product: enrichment failed for product ${productId}:`, message)
    const failed = buildFailedIntelligence(previous, message)
    try {
      const row = await setProductIntelligence(productId, failed, authClient)
      persisted = row.product_intelligence as ProductIntelligence
    } catch (persistErr: any) {
      console.error('enrich-product: failed to persist failure state:', persistErr?.message ?? persistErr)
      // The raw product itself was never touched — only its own
      // product_intelligence write failed on top of an already-failed
      // enrichment. Report the original enrichment error, not this
      // secondary persistence error, since that's what the user needs to
      // know.
      return NextResponse.json({ error: message }, { status: 500 })
    }
    return NextResponse.json({ error: message, productIntelligence: persisted }, { status: 502 })
  }

  return NextResponse.json({ productIntelligence: persisted })
}
