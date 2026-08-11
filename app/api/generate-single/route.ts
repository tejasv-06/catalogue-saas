import Groq from 'groq-sdk'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js'
import { createClient as createAuthClient } from '@/lib/supabase/server'
import { getOrCreateAnonId } from '@/lib/guestId'
import { shapeForPlatform, computeGenerationMeta, MARKETPLACE_LABELS } from '@/lib/platformShapers'
import {
  getTitleRoleFields,
  getDescriptionRule,
  getKeywordsLengthRule,
  getFieldRules,
  describeUniversalConstraints,
  enforceCharLimit
} from '@/lib/marketplaceRules'
import { GUEST_GENERATION_LIMIT } from '@/lib/limits'
import { CREDIT_COSTS, InsufficientCreditsError, assertSufficientCredits, deductCredits } from '@/lib/credits'
import { PRODUCT_INTELLIGENCE_FIELD_KEYS } from '@/lib/productIntelligence'
import { getMarketplaceAdapter } from '@/lib/marketplaceAdapters'

type FieldGroup = 'title' | 'bullets' | 'description'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

function formatDirectImageUrl(url: string): string {
  const driveFileMatch = url.match(/\/file\/d\/([^/]+)/)
  const driveIdMatch = url.match(/[?&]id=([^&]+)/)
  const driveFileId = driveFileMatch?.[1] || driveIdMatch?.[1]

  if (url.includes('drive.google.com') && driveFileId) {
    return `https://lh3.googleusercontent.com/d/${driveFileId}`
  }

  if (url.includes('dropbox.com')) {
    return url
      .replace('www.dropbox.com', 'dl.dropboxusercontent.com')
      .replace('dl=0', 'raw=1')
  }

  return url
}

// Milestone 32 (C9) — Generation Integration. Turns an already-persisted,
// completed Product Intelligence object (see lib/productIntelligence.ts)
// into a short factual block appended to the prompt this route already
// builds. Only fields with a real, non-null value are included — an
// "unknown"/null field contributes nothing here, same as it contributes
// nothing to a human writer. Returns '' (no-op) for anything not shaped
// like the real intelligence data object, so a missing/malformed/absent
// value never changes this route's existing behavior (C9-AC14) — this
// function is intentionally forgiving on input shape precisely because it
// must never be the thing that breaks generation.
function buildIntelligenceSummary(intelligence: unknown): string {
  if (!intelligence || typeof intelligence !== 'object') return ''

  const lines: string[] = []
  for (const key of PRODUCT_INTELLIGENCE_FIELD_KEYS) {
    const field = (intelligence as Record<string, any>)[key]
    if (!field || field.value == null) continue
    const value = Array.isArray(field.value) ? field.value.join(', ') : field.value
    if (!value || (typeof value === 'string' && !value.trim())) continue
    lines.push(`- ${key.replace(/_/g, ' ')}: ${value}`)
  }

  if (lines.length === 0) return ''

  return `\n\nCanonical product intelligence has already been determined for this product by a separate analysis step — treat the following as established fact and do not re-guess or contradict it (you may still phrase it however fits the listing):\n${lines.join('\n')}`
}

class EmptyContentError extends Error {
  constructor() {
    super('Model returned empty content')
  }
}

function isTransientGroqError(err: any): boolean {
  if (err instanceof EmptyContentError) return true

  const status = err?.status
  const code = err?.error?.error?.code || err?.error?.code
  const messageText = String(err?.message || '')

  return status === 400 && (code === 'json_validate_failed' || messageText.includes('json_validate_failed'))
}

function isInvalidImageError(err: any): boolean {
  const status = err?.status
  const messageText = String(err?.error?.error?.message || err?.message || '').toLowerCase()

  return status === 400 && messageText.includes('invalid image data')
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let delay = 500

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      if (!isTransientGroqError(err) || attempt === maxAttempts) {
        throw err
      }
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay *= 2
    }
  }

  throw new Error('Generation failed after retries')
}

// Enforces a real, verified character limit (lib/marketplaceRules.ts) by
// asking the model to rewrite the text to fit — never by slicing it as the
// primary mechanism. Called only when the value actually exceeds its limit,
// so the common case (model already complied thanks to the constraint in
// the main prompt) costs nothing extra. Bounded to a couple of rewrite
// attempts so one stubborn field can't blow up latency.
//
// The return value is UNCONDITIONALLY guaranteed to be <= maxLength: if the
// model still hasn't complied after the allowed attempts, enforceCharLimit
// (sentence/word-boundary-aware, see lib/marketplaceRules.ts) is applied as
// the actual final enforcement step, not shapeForPlatform's blind slice —
// callers never need to re-check the result or fall back to truncating it
// themselves.
async function rewriteToFitLimit(params: { value: string; maxLength: number; fieldLabel: string; marketplaceLabel: string }): Promise<string> {
  let current = params.value
  let attempts = 0
  const maxAttempts = 2

  while (current.length > params.maxLength && attempts < maxAttempts) {
    attempts++
    try {
      const rewritten = await withRetry(async () => {
        const completion = await groq.chat.completions.create({
          model: 'qwen/qwen3.6-27b',
          reasoning_effort: 'none',
          messages: [
            {
              role: 'user',
              content: `Rewrite the following ${params.marketplaceLabel} ${params.fieldLabel.toLowerCase()} to a maximum of ${params.maxLength} characters, including spaces, while preserving the primary product keyword and essential product information. Respond with ONLY the rewritten text — no quotes, no markdown, no commentary.\n\nCurrent text (${current.length} characters): ${current}`
            }
          ]
        })
        const text = completion.choices[0]?.message?.content
        if (!text || !text.trim()) throw new EmptyContentError()
        return text.trim()
      })
      current = rewritten.replace(/^["']+|["']+$/g, '')
    } catch {
      break
    }
  }

  return enforceCharLimit(current, params.maxLength)
}

// Field-level regenerate must use the SAME marketplace-specific rules as
// full generation, never a generic prompt — this builds a small, focused
// schema/constraint pair for exactly the one requested field group, sourced
// from the same lib/marketplaceRules.ts config full generation reads.
function buildFieldScopedPrompt(fieldGroup: FieldGroup, marketplace: string): { schemaDescription: string; constraintText: string } {
  if (fieldGroup === 'title') {
    const titleRules = getTitleRoleFields(marketplace)
    const constraintText = titleRules.length
      ? titleRules.map((r) => `- ${r.label}: maximum ${r.maxLength} characters, including spaces.`).join('\n')
      : '- Title: no strict limit verified — keep it concise and compelling.'
    const schemaDescription = `{ "title": "string"${
      titleRules.length > 1 ? ', "listViewName": "string, a more compact version of the title, see constraints above"' : ''
    } }`
    return { schemaDescription, constraintText }
  }

  if (fieldGroup === 'bullets') {
    const rule = getFieldRules(marketplace).find((r) => r.kind === 'bullets')
    const constraintText = rule
      ? `- Bullets: at most ${rule.maxCount} items${rule.maxItemLength ? `, each at most ${rule.maxItemLength} characters` : ''}.`
      : '- Bullets: no strict limit verified — keep each item concise.'
    return { schemaDescription: '{ "bullets": ["string", "string", ...] }', constraintText }
  }

  const descRule = getDescriptionRule(marketplace)
  const constraintText = descRule
    ? `- Description: maximum ${descRule.maxLength} characters.`
    : '- Description: no strict character limit verified — keep it natural, 2-4 sentences.'
  return { schemaDescription: '{ "description": "string" }', constraintText }
}

function buildUserContent(promptText: string, resolvedImageUrl: string | null) {
  return resolvedImageUrl
    ? [
        { type: 'text' as const, text: promptText },
        { type: 'image_url' as const, image_url: { url: resolvedImageUrl } }
      ]
    : promptText
}

// service_role key is read ONLY here, inside this server-only route file —
// never exported from a shared lib module, never reachable from client code.
function getSupabaseAdminClient() {
  return createSupabaseAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function isUnderGuestLimit(anonId: string): Promise<boolean> {
  const admin = getSupabaseAdminClient()
  // Milestone 12: the real column is `anonymous_id`, not `anon_id` — the old
  // name errored on every call (confirmed live), and since only `data` was
  // destructured here, that error was silently discarded and treated as "no
  // row" -> allowed. Now surfaced so the caller can fail closed on it.
  const { data, error } = await admin
    .from('guest_usage')
    .select('generation_count')
    .eq('anonymous_id', anonId)
    .maybeSingle()

  if (error) throw error
  return !data || data.generation_count < GUEST_GENERATION_LIMIT
}

async function incrementGuestUsage(anonId: string) {
  const admin = getSupabaseAdminClient()
  const { data, error } = await admin
    .from('guest_usage')
    .select('generation_count')
    .eq('anonymous_id', anonId)
    .maybeSingle()

  if (error) throw error

  if (data) {
    await admin.from('guest_usage').update({ generation_count: data.generation_count + 1 }).eq('anonymous_id', anonId)
  } else {
    await admin.from('guest_usage').insert({ anonymous_id: anonId, generation_count: 1 })
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { brandName, description, category, targetMarketplace, imageBase64, imageUrl, brandGuidelines, fieldGroup, productIntelligence } = body || {}
  const scopedFieldGroup: FieldGroup | undefined =
    fieldGroup === 'title' || fieldGroup === 'bullets' || fieldGroup === 'description' ? fieldGroup : undefined

  // hasDescription gates both the validation below and the prompt branch
  // further down (image-only mode kicks in when this is false) — computed
  // once here so both stay in sync.
  const hasDescription = !!(description && String(description).trim())

  if (!targetMarketplace) {
    return NextResponse.json({ error: 'Missing targetMarketplace' }, { status: 400 })
  }
  if (!hasDescription && !imageBase64 && !imageUrl) {
    return NextResponse.json({ error: 'Provide a description or a product image' }, { status: 400 })
  }

  const authClient = await createAuthClient()
  const { data: authData } = await authClient.auth.getClaims()
  const isGuest = !authData?.claims
  const userId = authData?.claims?.sub as string | undefined

  let anonId: string | null = null

  if (isGuest) {
    try {
      anonId = await getOrCreateAnonId()
      const allowed = await isUnderGuestLimit(anonId)
      if (!allowed) {
        return NextResponse.json(
          { error: 'Free preview limit reached. Sign in to continue generating.' },
          { status: 403 }
        )
      }
    } catch (err: any) {
      // Milestone 12: previously failed open here (logged and let generation
      // proceed) — that's exactly how the anon_id/anonymous_id column-name
      // bug made the guest limit unenforceable in practice despite looking
      // implemented. Guest generation carries a real, uncredited LLM cost,
      // so an inability to verify the limit must block the request, matching
      // the signed-in credit-check's existing fail-closed behavior below
      // rather than diverging from it.
      console.error('Guest usage check failed, blocking generation:', err.message)
      return NextResponse.json({ error: 'Could not verify guest usage limit. Please try again.' }, { status: 500 })
    }
  } else if (userId) {
    // Unlike the guest check above, this fails CLOSED on infra errors — this
    // is the actual credit-metered path now, so an infra hiccup letting
    // every signed-in generation through for free would defeat the point of
    // having credits at all.
    try {
      await assertSufficientCredits(userId, CREDIT_COSTS.listingGeneration)
    } catch (err: any) {
      if (err instanceof InsufficientCreditsError) {
        return NextResponse.json(
          { error: err.message, creditsRemaining: err.available, creditsRequired: err.required },
          { status: 403 }
        )
      }
      console.error('Credit check failed:', err.message)
      return NextResponse.json({ error: 'Could not verify credit balance. Please try again.' }, { status: 500 })
    }
  }

  try {
    // Identical to before whenever a description is present. When it's not
    // (image-only mode), the raw-description line is swapped for a plain
    // statement of that fact — there's no "Raw description: undefined" or
    // similar leaking into the prompt.
    const promptText =
      (hasDescription
        ? `Brand: ${brandName || 'N/A'}\nCategory: ${category || 'unspecified'}\nRaw description: ${description}`
        : `Brand: ${brandName || 'N/A'}\nCategory: ${category || 'unspecified'}\nNo raw description was provided for this product.`) +
      buildIntelligenceSummary(productIntelligence)

    const resolvedImageUrl = imageBase64
      ? imageBase64
      : imageUrl
        ? formatDirectImageUrl(imageUrl)
        : null

    // Empty string when hasDescription is true, so the template literal
    // below interpolates nothing there — systemPrompt is byte-for-byte the
    // same string existing callers have always gotten. This paragraph only
    // ever reaches the model on the new image-only path.
    const imageOnlyInstruction = hasDescription
      ? ''
      : `\n\nNo product description was provided for this listing — the attached image is the ONLY source of information you have. Construct the entire listing (title, description, bullets, keywordPool) purely from analyzing the image. Be as specific and concrete as possible about visible attributes: exact color, material or fabric, style, cut or shape, pattern, and any text or branding visible on the product itself. Only state what is visibly evident — do not invent specifications, materials, or use-cases you cannot actually see.`

    const marketplaceLabel = MARKETPLACE_LABELS[targetMarketplace as keyof typeof MARKETPLACE_LABELS] ?? targetMarketplace

    // Field-level regenerate ("Regenerate Title" etc.) gets a small, focused
    // prompt scoped to exactly that field and its own marketplace-specific
    // constraint — never the generic full-listing prompt below. Full
    // generation (initial or "Regenerate Entire Listing") gets every
    // field's constraint injected up front, sourced from the same
    // lib/marketplaceRules.ts config the post-generation retry step and
    // validation both read — so the model is told the real limit instead of
    // just being corrected after the fact.
    const systemPrompt = scopedFieldGroup
      ? (() => {
          const { schemaDescription, constraintText } = buildFieldScopedPrompt(scopedFieldGroup, targetMarketplace)
          return `You are an expert e-commerce SEO copywriter. Given a brand, category, and product description${resolvedImageUrl ? ', and a product image,' : ''} write ONLY the ${scopedFieldGroup} field for a ${marketplaceLabel} listing.${
            brandGuidelines ? `\nFollow these brand-specific guidelines when writing: ${brandGuidelines}` : ''
          }${imageOnlyInstruction}
Constraint — write within this from the start, do not rely on truncation:
${constraintText}
Respond ONLY with valid JSON in exactly this shape:
${schemaDescription}
CRITICAL: Output ONLY valid, raw JSON. Do NOT wrap output in markdown fences (no \`\`\`json or \`\`\`), and do NOT include any introductory or trailing commentary.`
        })()
      : `You are an expert e-commerce SEO copywriter. Given a brand, category, raw product description, and (when provided) a product image, generate high-ranking marketplace content.
When an image is provided, analyze its visual details — exact color shade, pattern, fabric texture, neckline, sleeve type, embellishments — and weave those specifics directly into the title, bullets, and keywordPool.${
          brandGuidelines ? `\nFollow these brand-specific guidelines when writing: ${brandGuidelines}` : ''
        }${imageOnlyInstruction}
This listing is for ${marketplaceLabel}. Field-specific constraints — write within these from the start, do not rely on truncation:
${describeUniversalConstraints(targetMarketplace)}
Respond ONLY with valid JSON in exactly this shape:
{
  "title": "string, compelling and keyword-rich",
  "description": "string, 2-4 sentences, benefit-focused",
  "bullets": ["string","string","string","string","string"],
  "keywordPool": ["string", ... 20 to 25 relevant, high-search-volume keywords/phrases, no duplicates],${
          getTitleRoleFields(targetMarketplace).length > 1
            ? '\n  "listViewName": "string, a more compact version of the title, see constraints above",'
            : ''
        }
  "visualAttributes": { "colour": "string or null", "material": "string or null", "pattern": "string or null", "style": "string or null" }
}
Only populate "visualAttributes" when a product image was actually provided — set each key to what you can confidently see, or null if that attribute isn't clearly visible in the image. Never guess. When no image is provided, return "visualAttributes" as an empty object {}.
CRITICAL: Output ONLY valid, raw JSON. Do NOT wrap output in markdown fences (no \`\`\`json or \`\`\`), and do NOT include any introductory or trailing commentary.`

    async function runCompletion(includeImage: boolean): Promise<string> {
      return withRetry(async () => {
        const completion = await groq.chat.completions.create({
          model: 'qwen/qwen3.6-27b',
          reasoning_effort: 'none',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: buildUserContent(promptText, includeImage ? resolvedImageUrl : null)
            }
          ]
        })

        const content = completion.choices[0]?.message?.content
        if (!content || !content.trim()) {
          throw new EmptyContentError()
        }
        return content
      })
    }

    let rawContent: string
    try {
      rawContent = await runCompletion(!!resolvedImageUrl)
    } catch (err: any) {
      if (resolvedImageUrl && isInvalidImageError(err)) {
        if (hasDescription) {
          // the image itself was rejected (unreachable / not real image bytes / unsupported
          // format) — fall back to a text-only generation rather than failing the whole
          // listing over one bad image URL
          rawContent = await runCompletion(false)
        } else {
          // Image-only mode has no description to fall back to — retrying
          // without the image would send the model an empty prompt and an
          // instruction to analyze an image that isn't there.
          throw new Error('The uploaded image could not be processed. Please try a different image.')
        }
      } else {
        throw err
      }
    }

    rawContent = rawContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()

    // Placeholder defaults for whichever fields this request didn't ask for
    // (always all of them for a full generation; just the requested group
    // for a field-level regenerate) — shapeForPlatform reads ai.title/
    // ai.description/ai.bullets unconditionally for every marketplace, and
    // the client only ever reads the specific keys it asked for back out of
    // generatedContent, so a placeholder here is never actually shown.
    const aiResult: {
      title: string
      description: string
      bullets: string[]
      keywordPool: string[]
      listViewName?: string
      keywordsFieldOverride?: string
      visualAttributes?: Record<string, string | null>
    } = { title: '', description: '', bullets: [], keywordPool: [], ...JSON.parse(rawContent) }

    // Enforce real per-field character limits by asking the model to
    // rewrite, never by slicing — only the field(s) actually in scope for
    // this request are checked. Skipped entirely (cheap, no extra Groq
    // call) whenever the first attempt already fit.
    if (!scopedFieldGroup || scopedFieldGroup === 'title') {
      const titleRules = getTitleRoleFields(targetMarketplace)
      for (let i = 0; i < titleRules.length; i++) {
        const rule = titleRules[i]
        const isSecondary = i > 0
        const currentValue = isSecondary ? aiResult.listViewName || aiResult.title || '' : aiResult.title || ''
        if (currentValue.length > rule.maxLength!) {
          const fixed = await rewriteToFitLimit({ value: currentValue, maxLength: rule.maxLength!, fieldLabel: rule.label, marketplaceLabel })
          if (isSecondary) aiResult.listViewName = fixed
          else aiResult.title = fixed
        } else if (isSecondary && !aiResult.listViewName) {
          aiResult.listViewName = currentValue
        }
      }
    }

    if (!scopedFieldGroup || scopedFieldGroup === 'description') {
      const descRule = getDescriptionRule(targetMarketplace)
      if (descRule) {
        const currentValue = aiResult.description || ''
        if (currentValue.length > descRule.maxLength!) {
          aiResult.description = await rewriteToFitLimit({
            value: currentValue,
            maxLength: descRule.maxLength!,
            fieldLabel: descRule.label,
            marketplaceLabel
          })
        }
      }
    }

    // Keywords have no "Regenerate Keywords" button — they're only ever
    // part of a full-listing generation, never a field-scoped request, so
    // this only needs to run when !scopedFieldGroup. Mirrors shapeForPlatform's
    // own amazon derivation (pool.slice(0, maxCount).join(' ')) so the value
    // checked here is exactly the one that would otherwise reach the final
    // .slice(0, 200) unexamined. Only Amazon has a verified scalar limit on
    // its keywords field today (getKeywordsLengthRule returns undefined for
    // every other marketplace), so this is a no-op elsewhere.
    if (!scopedFieldGroup) {
      const keywordsRule = getKeywordsLengthRule(targetMarketplace)
      if (keywordsRule) {
        const pool = aiResult.keywordPool || []
        const currentValue = pool.slice(0, keywordsRule.maxCount ?? pool.length).join(' ')
        if (currentValue.length > keywordsRule.maxLength!) {
          aiResult.keywordsFieldOverride = await rewriteToFitLimit({
            value: currentValue,
            maxLength: keywordsRule.maxLength!,
            fieldLabel: keywordsRule.label,
            marketplaceLabel
          })
        }
      }
    }

    // Milestone C10 — shaping now goes through the marketplace adapter
    // (lib/marketplaceAdapters.ts) instead of calling shapeForPlatform
    // directly. The adapter's shape() is shapeForPlatform itself under the
    // hood (same call, same arguments, same return value) — this is a
    // routing change, not a behavior change. getMarketplaceAdapter is
    // guaranteed to resolve here: targetMarketplace was already validated
    // upstream of this route by the client's own marketplace-selection UI
    // (§8 of TESOLUTE_PRODUCT_FOUNDATION.md), and every value that UI can
    // send is one of SUPPORTED_MARKETPLACES, which is exactly the set this
    // module builds an adapter for.
    const adapter = getMarketplaceAdapter(targetMarketplace)
    const generatedContent = adapter
      ? adapter.shape(aiResult, { brandName, description, category, imageUrl: resolvedImageUrl, intelligence: productIntelligence ?? null })
      : shapeForPlatform(targetMarketplace, aiResult, { brand_name: brandName })
    // Additive fields, computed alongside the existing shaping call rather
    // than changing shapeForPlatform's own return shape — see the comment
    // on computeGenerationMeta in lib/platformShapers.ts for why.
    const meta = computeGenerationMeta(targetMarketplace, aiResult)
    // Milestone C10 — adapter-level readiness (§7/§8), additive to the
    // response, never required by any existing client caller (the client
    // already computes an equivalent, richer result itself via
    // computeListingHealth once it has generatedContent/meta — see
    // lib/listingHealth.ts and GeneratedListingDrawer in
    // CatalogueWorkspace.tsx). Only computed for a full generation, never a
    // field-scoped regenerate: a field-scoped response's generatedContent
    // deliberately contains only the requested field's key(s) (the client
    // merges it into the existing full content afterward), so validating it
    // in isolation here would misreport every field the client hasn't
    // merged in yet as missing.
    const readiness = adapter && !scopedFieldGroup ? adapter.validate(generatedContent, null, meta) : null
    // Only ever non-empty when an image was actually analyzed — the model is
    // instructed to return {} otherwise, so a text-only generation doesn't
    // carry stale/invented visual attributes.
    const visualAttributes =
      resolvedImageUrl && aiResult.visualAttributes && Object.keys(aiResult.visualAttributes).length > 0
        ? aiResult.visualAttributes
        : null

    if (isGuest && anonId) {
      try {
        await incrementGuestUsage(anonId)
      } catch (err: any) {
        // Don't discard an already-successful generation just because the
        // usage-count bookkeeping failed.
        console.error('Failed to increment guest usage:', err.message)
      }
    } else if (userId) {
      try {
        await deductCredits(userId, CREDIT_COSTS.listingGeneration, 'generation')
      } catch (err: any) {
        // Same reasoning as the guest-usage increment above: the generation
        // already succeeded and shipped to the client — a bookkeeping write
        // failing afterward shouldn't turn that into an error response.
        console.error('Failed to deduct credits:', err.message)
      }
    }

    return NextResponse.json({ generatedContent, meta, visualAttributes, readiness })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
