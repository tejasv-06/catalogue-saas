// Single source of truth for every per-marketplace, per-field generation
// constraint: initial generation, bulk generation, retry, field-level
// regeneration, validation (lib/listingHealth.ts), and export
// (lib/exportShapers.ts, which just flattens already-shaped content, so it
// inherits these rules for free) all read from this one file instead of
// keeping their own copies of the same numbers.
//
// Deliberately a leaf module: imports nothing from platformShapers.ts,
// types.ts, or listingHealth.ts, so those can all safely import from here
// without any risk of a circular dependency.
//
// `verified: true` means the limit is real and actually enforced today
// (traceable to a concrete rule previously hardcoded in
// lib/platformShapers.ts's shapeForPlatform). `verified: false` means we do
// NOT have a confirmed real marketplace rule for that field: no number is
// invented for it; `notes` explains what's known and what isn't.
type MarketplaceKey = 'amazon' | 'flipkart' | 'myntra' | 'etsy'

export type FieldConstraintKind = 'title' | 'bullets' | 'description' | 'keywords' | 'other'

export type FieldRule = {
  key: string
  label: string
  kind: FieldConstraintKind
  maxLength?: number
  maxCount?: number
  maxItemLength?: number
  maxItemWords?: number
  verified: boolean
  notes?: string
}

// A single field's real length vs. its verified limit, computed from the
// RAW model output before any shapeForPlatform truncation: this is what
// makes it possible to tell "the model wrote 158 characters" apart from
// "the stored title is 75 characters because it got cut off."
export type FieldLengthFact = {
  key: string
  label: string
  rawLength: number
  maxLength: number
  withinLimit: boolean
}

// Recorded once per generation (initial, retry, or field-level regenerate)
// alongside the shaped content. titleFields holds one entry per verified
// title-role field for the marketplace (1 for amazon/flipkart/etsy, 2 for
// myntra): never a single universal "the title limit."
export type GenerationMeta = {
  titleFields: FieldLengthFact[]
  descriptionField: FieldLengthFact | null
  // Only ever non-null for a marketplace with a verified scalar length rule
  // on its keywords field (Amazon's genericKeywords today: a joined
  // string, capped at 200 characters, the same class of silent-truncation
  // risk title/description had). Flipkart/Etsy/Myntra's keyword fields are
  // either count-based (no raw-vs-shaped length to compare) or unverified,
  // so this stays null for them: never a fabricated rule.
  keywordsField: FieldLengthFact | null
  bulletCount: number
}

export const MARKETPLACE_RULES: Record<MarketplaceKey, FieldRule[]> = {
  amazon: [
    { key: 'title', label: 'Title', kind: 'title', maxLength: 75, verified: true },
    {
      key: 'bullets',
      label: 'Bullets',
      kind: 'bullets',
      maxCount: 5,
      maxItemLength: 200,
      verified: true
    },
    {
      key: 'description',
      label: 'Description',
      kind: 'description',
      verified: false,
      notes: 'No character limit is enforced in this codebase today. Amazon\'s real limit varies by category and is not verified here: do not invent one.'
    },
    {
      key: 'genericKeywords',
      label: 'Generic Keywords',
      kind: 'keywords',
      maxCount: 25,
      maxLength: 200,
      verified: true,
      notes: 'Up to 25 keywords are joined with spaces, then the combined string is capped at 200 characters total.'
    }
  ],
  flipkart: [
    { key: 'title', label: 'Title', kind: 'title', maxLength: 100, verified: true },
    { key: 'description', label: 'Description', kind: 'description', maxLength: 2000, verified: true },
    {
      key: 'keyFeatures',
      label: 'Key Features',
      kind: 'bullets',
      maxCount: 5,
      maxItemLength: 100,
      verified: true
    },
    {
      key: 'searchKeywords',
      label: 'Search Keywords',
      kind: 'keywords',
      maxCount: 5,
      maxItemWords: 3,
      verified: true,
      notes: 'Each keyword phrase is capped at 3 words, not a character count.'
    }
  ],
  myntra: [
    { key: 'vendorArticleName', label: 'Vendor Article Name', kind: 'title', maxLength: 50, verified: true },
    // A separate, shorter limit from Vendor Article Name: both are
    // title-derived but not interchangeable, which is exactly why this
    // config is field-specific rather than one universal per-marketplace
    // title limit.
    { key: 'listViewName', label: 'List View Name', kind: 'title', maxLength: 30, verified: true },
    {
      key: 'productDisplayName',
      label: 'Product Display Name',
      kind: 'title',
      verified: false,
      notes: 'Built as "brand + title" with no enforced limit today. Not verified against a real Myntra constraint.'
    },
    {
      key: 'productDetails',
      label: 'Product Details',
      kind: 'description',
      verified: false,
      notes: 'No character limit is enforced in this codebase today.'
    },
    {
      key: 'styleNote',
      label: 'Style Note',
      kind: 'other',
      verified: false,
      notes: 'Derived from the first generated bullet, no enforced limit today.'
    },
    {
      key: 'tags',
      label: 'Tags',
      kind: 'keywords',
      verified: false,
      notes: 'Joined keyword pool with no enforced count or length limit today.'
    }
  ],
  etsy: [
    { key: 'title', label: 'Title', kind: 'title', maxLength: 140, verified: true },
    {
      key: 'description',
      label: 'Description',
      kind: 'description',
      verified: false,
      notes: 'No character limit is enforced in this codebase today.'
    },
    {
      key: 'tags',
      label: 'Tags',
      kind: 'keywords',
      maxCount: 13,
      verified: true,
      notes: 'Item count (13) matches Etsy\'s real tag limit and is enforced. Etsy also caps each tag at 20 characters, but that per-tag limit is NOT currently enforced or verified in this codebase: flagged, not invented.'
    }
  ]
}

export function getFieldRules(marketplace: string): FieldRule[] {
  return MARKETPLACE_RULES[marketplace as MarketplaceKey] ?? []
}

// The deterministic, non-negotiable final guarantee that a value fits a
// character limit: used as the last step after an LLM rewrite attempt
// (never as the primary compliance mechanism on its own) and as the
// defensive fallback inside shapeForPlatform. Unlike a blind slice, this
// prefers cutting at the last sentence boundary, then the last word
// boundary, before falling back to a hard cut: so a still-oversized value
// reads as an intentionally shorter sentence/phrase rather than text
// chopped off mid-word. The 50%/60% floors exist so a limit reached very
// early in the string (e.g. one long word right at the start) doesn't throw
// away almost the entire value just to land on a boundary.
export function enforceCharLimit(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  const truncated = value.slice(0, maxLength)
  const sentenceEnd = Math.max(truncated.lastIndexOf('. '), truncated.lastIndexOf('! '), truncated.lastIndexOf('? '))
  if (sentenceEnd > maxLength * 0.5) return truncated.slice(0, sentenceEnd + 1).trim()
  const wordEnd = truncated.lastIndexOf(' ')
  if (wordEnd > maxLength * 0.6) return truncated.slice(0, wordEnd).trim()
  return truncated.trim()
}

export function getFieldRule(marketplace: string, key: string): FieldRule | undefined {
  return getFieldRules(marketplace).find((r) => r.key === key)
}

// Every title-role field with a verified, enforceable character limit: one
// entry for amazon/flipkart/etsy (title), two for myntra (vendorArticleName
// + listViewName, each with its own real limit).
export function getTitleRoleFields(marketplace: string): FieldRule[] {
  return getFieldRules(marketplace).filter((r) => r.kind === 'title' && r.maxLength != null)
}

// The one description-role field with a verified character limit, if any
// (only Flipkart today): null for marketplaces with no confirmed limit,
// deliberately not a fabricated one.
export function getDescriptionRule(marketplace: string): FieldRule | undefined {
  return getFieldRules(marketplace).find((r) => r.kind === 'description' && r.maxLength != null)
}

// The one keywords-role field with a verified scalar character limit, if
// any (only Amazon's genericKeywords today: a joined string with a real
// combined-length cap, unlike Flipkart/Etsy's count-based keyword rules,
// which don't have a comparable "raw length vs limit" to check).
export function getKeywordsLengthRule(marketplace: string): FieldRule | undefined {
  return getFieldRules(marketplace).find((r) => r.kind === 'keywords' && r.maxLength != null)
}

export function getUnverifiedFields(marketplace: string): FieldRule[] {
  return getFieldRules(marketplace).filter((r) => !r.verified)
}

function describeFieldConstraint(rule: FieldRule): string {
  const parts: string[] = []
  if (rule.maxLength != null) parts.push(`maximum ${rule.maxLength} characters (including spaces)`)
  if (rule.maxCount != null) parts.push(`at most ${rule.maxCount} items`)
  if (rule.maxItemLength != null) parts.push(`each item at most ${rule.maxItemLength} characters`)
  if (rule.maxItemWords != null) parts.push(`each item at most ${rule.maxItemWords} words`)
  if (parts.length === 0) return 'no strict limit is verified for this field: keep it natural and reasonably concise'
  return parts.join(', ')
}

// Human-readable constraints block for the FULL-listing generation prompt,
// phrased in terms of the universal title/bullets/description/keywords
// fields the model writes before marketplace-shaping happens: built
// entirely from MARKETPLACE_RULES so the prompt can never drift from what's
// actually enforced/checked elsewhere.
export function describeUniversalConstraints(marketplace: string): string {
  const titleRules = getTitleRoleFields(marketplace)
  const bulletsRule = getFieldRules(marketplace).find((r) => r.kind === 'bullets')
  const descRule = getFieldRules(marketplace).find((r) => r.kind === 'description')
  const keywordsRule = getFieldRules(marketplace).find((r) => r.kind === 'keywords')

  const lines: string[] = []
  const [primaryTitle, secondaryTitle] = titleRules

  if (primaryTitle) lines.push(`- Title: ${describeFieldConstraint(primaryTitle)}.`)
  if (secondaryTitle) {
    lines.push(
      `- Also include "listViewName" in the JSON: a more compact version of the title, ${describeFieldConstraint(secondaryTitle)}.`
    )
  }
  if (bulletsRule) lines.push(`- Bullets: ${describeFieldConstraint(bulletsRule)}.`)
  if (descRule?.maxLength) lines.push(`- Description: ${describeFieldConstraint(descRule)}.`)
  if (keywordsRule?.maxCount) {
    lines.push(`- Keywords: provide around ${keywordsRule.maxCount} relevant keywords/phrases${keywordsRule.maxItemWords ? `, ${describeFieldConstraint(keywordsRule)}` : ''}.`)
  }
  return lines.join('\n')
}
