import type { Marketplace } from './types'
import { MARKETPLACE_LABELS } from './platformShapers'
import { getTitleRoleFields, getDescriptionRule, getKeywordsLengthRule, type GenerationMeta, type FieldLengthFact } from './marketplaceRules'

// Real per-field length limits now live in lib/marketplaceRules.ts (the
// single source of truth) — re-exported here so nothing that already
// imports GenerationMeta from this file needs to change its import path.
export type { GenerationMeta }

// Per-marketplace field roles, matching the exact shapes shapeForPlatform
// (lib/platformShapers.ts) produces and getFieldSections (CatalogueWorkspace.tsx)
// already displays — this file adds no new field names, just checks the ones
// that already exist. `titleLimit` is only used as a fallback when `meta` is
// unavailable (an older saved session) — the real, authoritative limits for
// every title-role field come from lib/marketplaceRules.ts via
// getTitleRoleFields, not a single hardcoded number here.
export type FieldSpec = {
  titleKey: string
  titleLimit: number
  bulletsKey: string | null
  descriptionKey: string | null
  keywordsKey: string | null
  requiredKeys: string[]
}

// Exported so the review drawer can group displayed fields (Title/Bullets/
// Description/Keywords/other) using the exact same key mapping this file
// checks against — one source of truth, no risk of the two drifting apart.
export const FIELD_SPECS: Record<Marketplace, FieldSpec> = {
  amazon: {
    titleKey: 'title',
    titleLimit: 75,
    bulletsKey: 'bullets',
    descriptionKey: 'description',
    keywordsKey: 'genericKeywords',
    requiredKeys: ['title', 'description', 'bullets', 'genericKeywords']
  },
  flipkart: {
    titleKey: 'title',
    titleLimit: 100,
    bulletsKey: 'keyFeatures',
    descriptionKey: 'description',
    keywordsKey: 'searchKeywords',
    requiredKeys: ['title', 'description', 'keyFeatures', 'searchKeywords']
  },
  myntra: {
    // No bullets-equivalent field, hence bulletsKey: null — that check is
    // reported as not-applicable for Myntra rather than a false failure.
    titleKey: 'vendorArticleName',
    titleLimit: 50,
    bulletsKey: null,
    descriptionKey: 'productDetails',
    keywordsKey: 'tags',
    requiredKeys: ['vendorArticleName', 'listViewName', 'productDetails', 'styleNote', 'productDisplayName', 'tags']
  },
  etsy: {
    titleKey: 'title',
    titleLimit: 140,
    bulletsKey: null,
    descriptionKey: 'description',
    keywordsKey: 'tags',
    requiredKeys: ['title', 'description', 'tags']
  }
}

// `subDetail` is the second line the drawer shows under the raw count
// ("Title exceeds Amazon's limit" / "Within Amazon title limit") — kept
// separate from `detail` (the count itself) so the two can be rendered as
// two distinct lines without string-splitting.
export type HealthCheck = { label: string; passed: boolean; detail?: string; subDetail?: string; applicable: boolean }

export type ListingHealth = {
  status: 'ready' | 'needs-review' | 'missing-data' | 'error'
  percentComplete: number
  checks: HealthCheck[]
}

function isNonEmpty(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  return String(value).trim().length > 0
}

// Builds the Character Limit check's passed/detail/subDetail from real
// per-field facts (1 title field for amazon/flipkart/etsy, 2 for myntra —
// never a single universal limit). `fields` is either the real
// post-generation facts (meta.titleFields, raw pre-truncation lengths) or a
// same-shaped fallback computed from the already-shaped content when meta
// is unavailable (an older saved session).
// One field's "exceeds X's N-character limit by M characters" sentence —
// names the marketplace, the actual limit, and the overage, not just a bare
// count, so the seller understands what's wrong and why without needing to
// do the subtraction themselves.
function describeLengthViolation(marketplaceLabel: string, f: FieldLengthFact): string {
  const overBy = f.rawLength - f.maxLength
  return `${f.label} exceeds ${marketplaceLabel}'s ${f.maxLength}-character limit by ${overBy} character${overBy === 1 ? '' : 's'}`
}

function describeLengthOk(marketplaceLabel: string, f: FieldLengthFact): string {
  return `Within ${marketplaceLabel}'s ${f.maxLength}-character ${f.label.toLowerCase()} limit`
}

function summarizeLengthFields(marketplaceLabel: string, fields: FieldLengthFact[]): { passed: boolean; detail: string; subDetail: string } {
  const allWithin = fields.every((f) => f.withinLimit)
  const failing = fields.filter((f) => !f.withinLimit)

  if (fields.length <= 1) {
    const f = fields[0]
    return {
      passed: allWithin,
      detail: `${f.rawLength} / ${f.maxLength} characters`,
      subDetail: f.withinLimit ? describeLengthOk(marketplaceLabel, f) : describeLengthViolation(marketplaceLabel, f)
    }
  }

  return {
    passed: allWithin,
    detail: fields.map((f) => `${f.label}: ${f.rawLength} / ${f.maxLength}`).join(' · '),
    subDetail: allWithin ? `Within ${marketplaceLabel} limits` : failing.map((f) => describeLengthViolation(marketplaceLabel, f)).join('; ')
  }
}

// Exactly 7 checks, all derived from data the app already has (generation
// success, presence, real character limits, non-empty required fields) — no
// SEO/brand-voice/accuracy/conversion scoring, per explicit direction.
export function computeListingHealth(
  marketplace: Marketplace,
  content: any | null,
  generationError: string | null,
  meta: GenerationMeta | null
): ListingHealth {
  if (generationError) {
    return {
      status: 'error',
      percentComplete: 0,
      checks: [{ label: 'Generation', passed: false, detail: generationError, applicable: true }]
    }
  }

  if (!content) {
    return {
      status: 'missing-data',
      percentComplete: 0,
      checks: [{ label: 'Generation', passed: false, detail: 'Not generated yet', applicable: true }]
    }
  }

  const spec = FIELD_SPECS[marketplace]
  const marketplaceLabel = MARKETPLACE_LABELS[marketplace]
  const titleValue = content[spec.titleKey]
  const titleExists = isNonEmpty(titleValue)

  // meta may be missing, OR present but shaped like the OLDER GenerationMeta
  // (titleTruncated/rawTitleLength/titleLimit/bulletCount, from a session
  // saved before per-field titleFields/descriptionField existed) — either
  // way, `meta.titleFields` won't be a real array, so checking `meta` alone
  // isn't enough. Both cases fall back to computing straight off the
  // already-shaped content instead of a raw pre-slice length, which isn't
  // recoverable at that point. Still per-field, not a single universal
  // limit — getTitleRoleFields still returns 2 entries for Myntra even in
  // the fallback path.
  const hasCurrentMetaShape = !!meta && Array.isArray(meta.titleFields)
  const titleFields: FieldLengthFact[] = hasCurrentMetaShape
    ? meta!.titleFields
    : getTitleRoleFields(marketplace).map((rule) => {
        const raw = String(content[rule.key] ?? '')
        return { key: rule.key, label: rule.label, rawLength: raw.length, maxLength: rule.maxLength!, withinLimit: raw.length <= rule.maxLength! }
      })
  const titleLengthSummary = summarizeLengthFields(marketplaceLabel, titleFields.length > 0 ? titleFields : [
    { key: spec.titleKey, label: 'Title', rawLength: String(titleValue || '').length, maxLength: spec.titleLimit, withinLimit: true }
  ])

  const bulletsApplicable = spec.bulletsKey !== null
  const bulletsValue = spec.bulletsKey ? content[spec.bulletsKey] : null
  const bulletsExist = bulletsApplicable ? isNonEmpty(bulletsValue) : true

  const descriptionApplicable = spec.descriptionKey !== null
  const descriptionExists = spec.descriptionKey ? isNonEmpty(content[spec.descriptionKey]) : true
  const descRule = getDescriptionRule(marketplace)
  const descriptionField: FieldLengthFact | null = hasCurrentMetaShape
    ? meta!.descriptionField
    : descRule
      ? {
          key: descRule.key,
          label: descRule.label,
          rawLength: String(content[descRule.key] ?? '').length,
          maxLength: descRule.maxLength!,
          withinLimit: String(content[descRule.key] ?? '').length <= descRule.maxLength!
        }
      : null
  const descriptionWithinLimit = descriptionField ? descriptionField.withinLimit : true
  const descriptionDetail = !descriptionExists
    ? 'Missing'
    : descriptionField
      ? `${descriptionField.rawLength} / ${descriptionField.maxLength} characters`
      : undefined
  const descriptionSubDetail = descriptionField
    ? descriptionField.withinLimit
      ? describeLengthOk(marketplaceLabel, descriptionField)
      : describeLengthViolation(marketplaceLabel, descriptionField)
    : undefined

  const keywordsApplicable = spec.keywordsKey !== null
  const keywordsExist = spec.keywordsKey ? isNonEmpty(content[spec.keywordsKey]) : true
  // Only ever non-null for a marketplace with a verified scalar keywords
  // length rule (Amazon's genericKeywords today) — Flipkart/Etsy/Myntra's
  // keyword fields have no comparable raw-length-vs-limit fact, so this
  // check stays existence-only for them, same as before.
  const keywordsLengthRule = getKeywordsLengthRule(marketplace)
  const keywordsField: FieldLengthFact | null = hasCurrentMetaShape
    ? meta!.keywordsField ?? null
    : keywordsLengthRule
      ? {
          key: keywordsLengthRule.key,
          label: keywordsLengthRule.label,
          rawLength: String(content[keywordsLengthRule.key] ?? '').length,
          maxLength: keywordsLengthRule.maxLength!,
          withinLimit: String(content[keywordsLengthRule.key] ?? '').length <= keywordsLengthRule.maxLength!
        }
      : null
  const keywordsWithinLimit = keywordsField ? keywordsField.withinLimit : true
  const keywordsDetail = !keywordsExist
    ? 'Missing'
    : keywordsField
      ? `${keywordsField.rawLength} / ${keywordsField.maxLength} characters`
      : undefined
  const keywordsSubDetail = keywordsField
    ? keywordsField.withinLimit
      ? describeLengthOk(marketplaceLabel, keywordsField)
      : describeLengthViolation(marketplaceLabel, keywordsField)
    : undefined

  const missingRequiredKeys = spec.requiredKeys.filter((key) => !isNonEmpty(content[key]))
  const requiredFieldsComplete = missingRequiredKeys.length === 0

  const checks: HealthCheck[] = [
    { label: 'Generation', passed: true, applicable: true },
    { label: 'Title', passed: titleExists, detail: titleExists ? undefined : 'Missing', applicable: true },
    {
      label: 'Character limit',
      passed: titleExists ? titleLengthSummary.passed : true,
      detail: titleExists ? titleLengthSummary.detail : undefined,
      subDetail: titleExists ? titleLengthSummary.subDetail : undefined,
      applicable: true
    },
    {
      label: 'Bullets',
      passed: bulletsExist,
      detail: bulletsApplicable ? (Array.isArray(bulletsValue) ? `${bulletsValue.length} bullets` : undefined) : 'Not applicable',
      applicable: bulletsApplicable
    },
    {
      label: 'Description',
      passed: descriptionExists && descriptionWithinLimit,
      detail: descriptionDetail,
      subDetail: descriptionExists ? descriptionSubDetail : undefined,
      applicable: descriptionApplicable
    },
    {
      label: 'Keywords',
      passed: keywordsExist && keywordsWithinLimit,
      detail: keywordsDetail,
      subDetail: keywordsExist ? keywordsSubDetail : undefined,
      applicable: keywordsApplicable
    },
    {
      label: 'Required fields',
      passed: requiredFieldsComplete,
      detail: requiredFieldsComplete ? 'Complete' : `Missing: ${missingRequiredKeys.join(', ')}`,
      applicable: true
    }
  ]

  const applicableChecks = checks.filter((c) => c.applicable)
  const passedCount = applicableChecks.filter((c) => c.passed).length
  const percentComplete = Math.round((passedCount / applicableChecks.length) * 100)

  const titleWithinLimit = titleExists ? titleLengthSummary.passed : true

  let status: ListingHealth['status']
  if (!requiredFieldsComplete || !titleExists) {
    status = 'missing-data'
  } else if (!titleWithinLimit || !bulletsExist || !descriptionExists || !descriptionWithinLimit || !keywordsExist || !keywordsWithinLimit) {
    status = 'needs-review'
  } else {
    status = 'ready'
  }

  return { status, percentComplete, checks }
}
