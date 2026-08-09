import {
  getFieldRule,
  getTitleRoleFields,
  getDescriptionRule,
  getKeywordsLengthRule,
  enforceCharLimit,
  type GenerationMeta
} from './marketplaceRules'

type AiResult = {
  title: string
  description: string
  bullets: string[]
  keywordPool: string[]
  // Myntra-only: a separate, shorter title variant for the List View Name
  // field (its own 30-character limit, distinct from Vendor Article Name's
  // 50). Optional because no other marketplace's prompt asks for it — when
  // absent, shapeForPlatform falls back to deriving it from `title`.
  listViewName?: string
  // Amazon-only today: the generate-single route sets this once it has
  // rewritten the joined keyword string to fit the marketplace's keywords
  // length limit (see rewriteToFitLimit there) — shapeForPlatform prefers
  // it over re-deriving from keywordPool, same pattern as listViewName.
  keywordsFieldOverride?: string
}

// Real per-field limits now live in lib/marketplaceRules.ts (the single
// source of truth every layer — this file, the generation route, and
// validation — reads from). TITLE_LIMITS stays exported, derived from that
// same source, purely so nothing else that already imports it needs to
// change.
export const TITLE_LIMITS: Record<string, number> = {
  amazon: getFieldRule('amazon', 'title')?.maxLength ?? Infinity,
  flipkart: getFieldRule('flipkart', 'title')?.maxLength ?? Infinity,
  myntra: getFieldRule('myntra', 'vendorArticleName')?.maxLength ?? Infinity,
  etsy: getFieldRule('etsy', 'title')?.maxLength ?? Infinity
}

// Marketplaces with real shaping (below) and export-column mapping
// (lib/exportShapers.ts) — the single source of truth for what the app
// actually supports end-to-end. tatacliq was previously offered in the
// dropdown but has no case in either file (falls through to the generic
// `default` below, and to `flattenRow`'s `default: return null` on export,
// which silently drops approved tatacliq products from the CSV) — dropped
// here until real support is built. shopify was never added.
export const SUPPORTED_MARKETPLACES = ['amazon', 'flipkart', 'myntra', 'etsy'] as const

// Title Case labels for display — dropdowns/UI text show these while the
// lowercase keys above stay the values passed to the API and shapers.
export const MARKETPLACE_LABELS: Record<(typeof SUPPORTED_MARKETPLACES)[number], string> = {
  amazon: 'Amazon',
  flipkart: 'Flipkart',
  myntra: 'Myntra',
  etsy: 'Etsy'
}

// Every character-limited scalar field below is enforced with
// enforceCharLimit (sentence/word-boundary-aware), never a blind slice —
// this is the DEFENSIVE final layer, not the primary compliance mechanism.
// The primary mechanism is app/api/generate-single/route.ts's pre-shape
// rewrite-to-fit pass, which in the normal case already leaves ai.title /
// ai.description / the keywords override within their limits — so these
// calls are typically no-ops here. They still matter for two real cases:
// the legacy app/api/generate-all/route.ts caller (which never runs the
// rewrite pass at all) and the rare case where even a bounded LLM rewrite
// didn't succeed. Count-based array limits (bullets/keyFeatures/tags item
// counts) are a different kind of constraint — dropping extra *items* isn't
// the "broken word" problem this addresses, so those stay plain .slice().
export function shapeForPlatform(marketplace: string, ai: AiResult, product: any) {
  const pool = ai.keywordPool || []

  switch (marketplace) {
    case 'amazon':
      return {
        title: enforceCharLimit(ai.title, TITLE_LIMITS.amazon),
        description: ai.description,
        bullets: (ai.bullets || []).slice(0, 5).map(b => enforceCharLimit(b, 200)),
        genericKeywords: enforceCharLimit(ai.keywordsFieldOverride ?? pool.slice(0, 25).join(' '), 200)
      }
    case 'flipkart':
      return {
        title: enforceCharLimit(ai.title, TITLE_LIMITS.flipkart),
        description: enforceCharLimit(ai.description || '', 2000),
        keyFeatures: (ai.bullets || []).slice(0, 5).map(b => enforceCharLimit(b, 100)),
        searchKeywords: pool.slice(0, 5).map(k => k.split(' ').slice(0, 3).join(' '))
      }
    case 'myntra':
      return {
        vendorArticleName: enforceCharLimit(ai.title, TITLE_LIMITS.myntra),
        // Prefers a model-authored compact name (see AiResult.listViewName)
        // over slicing the vendor article name text — List View Name has
        // its own 30-character limit, not just a truncated copy of the
        // (up to 50-character) vendor name. Falls back to the title itself
        // when nothing else provided it, same safety net as before.
        listViewName: enforceCharLimit(ai.listViewName || ai.title, getFieldRule('myntra', 'listViewName')?.maxLength ?? 30),
        productDetails: ai.description,
        styleNote: (ai.bullets && ai.bullets[0]) || '',
        productDisplayName: `${product.brand_name || ''} ${ai.title}`.trim(),
        tags: pool.join(', ')
      }
    case 'etsy':
      return {
        title: enforceCharLimit(ai.title, TITLE_LIMITS.etsy),
        description: ai.description,
        tags: pool.slice(0, 13)
      }
    default:
      return { title: ai.title, description: ai.description, bullets: ai.bullets, tags: pool }
  }
}

// Additive — does not change shapeForPlatform's own return shape, so the
// legacy app/api/generate-all/route.ts caller (still real code, just not
// used by the current client) is unaffected. Computed from the RAW,
// pre-truncation ai fields (title/listViewName/description), since by the
// time shapeForPlatform's own output reaches the client any still-oversized
// value has already been sliced and the overage is no longer detectable
// from the result alone. By the time this runs, the route's retry-to-fit
// pipeline (app/api/generate-single/route.ts) should already have rewritten
// anything over its limit — in the normal case these come back withinLimit:
// true, and shapeForPlatform's own .slice() calls never actually cut
// anything. If a value is STILL over after retries, that's reported here
// honestly (withinLimit: false) rather than hidden by the safety-net slice.
export function computeGenerationMeta(marketplace: string, ai: AiResult): GenerationMeta {
  const titleFields = getTitleRoleFields(marketplace).map((rule) => {
    const raw = rule.key === 'listViewName' ? ai.listViewName || ai.title || '' : ai.title || ''
    return {
      key: rule.key,
      label: rule.label,
      rawLength: raw.length,
      maxLength: rule.maxLength!,
      withinLimit: raw.length <= rule.maxLength!
    }
  })

  const descRule = getDescriptionRule(marketplace)
  const descriptionField = descRule
    ? {
        key: descRule.key,
        label: descRule.label,
        rawLength: (ai.description || '').length,
        maxLength: descRule.maxLength!,
        withinLimit: (ai.description || '').length <= descRule.maxLength!
      }
    : null

  // Prefers keywordsFieldOverride when the route's rewrite-to-fit pass set
  // one — that IS the final, enforced value, not a hypothetical "what if we
  // hadn't rewritten it" number. Without this, a corrected value stored in
  // generatedContent could disagree with what meta reports about it, which
  // is exactly the mismatch this field exists to prevent. Falls back to
  // mirroring shapeForPlatform's own derivation (pool.slice(0,25).join(' '))
  // only when no override was ever computed (nothing was over limit, or
  // this marketplace/field combination doesn't get rewritten at all).
  const keywordsRule = getKeywordsLengthRule(marketplace)
  const keywordsField = keywordsRule
    ? (() => {
        const raw = ai.keywordsFieldOverride ?? (ai.keywordPool || []).slice(0, keywordsRule.maxCount ?? Infinity).join(' ')
        return {
          key: keywordsRule.key,
          label: keywordsRule.label,
          rawLength: raw.length,
          maxLength: keywordsRule.maxLength!,
          withinLimit: raw.length <= keywordsRule.maxLength!
        }
      })()
    : null

  return {
    titleFields,
    descriptionField,
    keywordsField,
    bulletCount: (ai.bullets || []).length
  }
}