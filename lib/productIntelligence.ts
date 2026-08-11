// Milestone 32 (C9 / Phase 10J) — Product Intelligence types, schema
// validation, and pure defaults. Deliberately no Supabase/Groq import here,
// same reasoning as lib/catalogReconciliation.ts (C4): the highest-risk
// logic in this milestone — trusting AI output shape before it's ever
// persisted — should be unit-testable with plain node:test, not only
// live-verified. lib/catalog.ts (persistence) and
// app/api/enrich-product/route.ts (orchestration) both import from here;
// this file imports from neither.

export type ProductIntelligenceConfidence = 'high' | 'medium' | 'low' | 'unknown'

export type ProductIntelligenceField = {
  value: string | string[] | null
  confidence: ProductIntelligenceConfidence
  // Optional short justification ("visible tag reads '100% cotton'") — only
  // included when the model actually gave one; never fabricated if absent.
  evidence?: string | null
}

export const PRODUCT_INTELLIGENCE_FIELD_KEYS = [
  'product_type',
  'material',
  'pattern',
  'colors',
  'style',
  'occasion',
  'target_customer',
  'key_selling_points',
  'search_keywords'
] as const

export type ProductIntelligenceFieldKey = (typeof PRODUCT_INTELLIGENCE_FIELD_KEYS)[number]

export type ProductIntelligenceData = Record<ProductIntelligenceFieldKey, ProductIntelligenceField>

// C9 follow-up — root-cause fix for a discovered live defect: across 7 real
// Groq calls, the model reliably returned array-shaped fields (colors,
// key_selling_points) as bare arrays (`"colors": ["red","blue"]`) instead of
// the required `{ value, confidence }` wrapper
// (`"colors": {"value": ["red","blue"], "confidence": "high"}`), and
// validateProductIntelligenceData correctly rejected every one — the
// validator was never the problem. The root cause was the prompt describing
// the shape with abstract TypeScript-union pseudocode
// (`"value": string | string[] | null`) instead of a concrete worked
// example, which the model appears to misread specifically for
// conceptually-list-like fields. This constant is a full, real,
// already-valid ProductIntelligenceData object that
// app/api/enrich-product/route.ts renders verbatim into the prompt as the
// "here is exactly what a correct response looks like" example — kept here,
// next to the canonical types/validator (not duplicated in the route file),
// so the prompt's example and the validator's actual schema can never drift
// apart. A test in productIntelligence.test.ts asserts this example passes
// validateProductIntelligenceData, so a future edit that breaks the example
// fails a fast unit test instead of silently corrupting every future
// enrichment prompt.
export const EXAMPLE_PRODUCT_INTELLIGENCE_DATA: ProductIntelligenceData = {
  product_type: {
    value: 'ceramic wall clock',
    confidence: 'high',
    evidence: 'described as "ceramic wall clock" in the raw text'
  },
  material: { value: 'ceramic', confidence: 'high' },
  pattern: { value: 'hand-painted floral', confidence: 'medium' },
  colors: { value: ['white', 'blue'], confidence: 'high' },
  style: { value: 'rustic', confidence: 'medium' },
  occasion: { value: null, confidence: 'unknown' },
  target_customer: { value: 'home decor buyers', confidence: 'low' },
  key_selling_points: {
    value: ['handmade', 'unique hand-painted design', 'durable ceramic construction'],
    confidence: 'medium'
  },
  search_keywords: {
    value: ['ceramic wall clock', 'handmade wall decor', 'boho wall clock'],
    confidence: 'medium'
  }
}

export type ProductIntelligenceStatus = 'not_started' | 'processing' | 'completed' | 'failed'

export type ProductIntelligence = {
  status: ProductIntelligenceStatus
  updated_at: string | null
  error: string | null
  missing_information: string[]
  data: ProductIntelligenceData | null
}

export class ProductIntelligenceValidationError extends Error {
  constructor(message: string) {
    super(`Product intelligence validation failed: ${message}`)
    this.name = 'ProductIntelligenceValidationError'
  }
}

const CONFIDENCE_VALUES: ProductIntelligenceConfidence[] = ['high', 'medium', 'low', 'unknown']

function isValidFieldValue(value: unknown): value is string | string[] | null {
  if (value === null) return true
  if (typeof value === 'string') return true
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

// C9-AC6/AC7 — the one function every AI response passes through before it
// can ever reach persistence. Throws (never coerces/guesses/drops-silently)
// on any structural mismatch, so a malformed model response becomes an
// explicit 'failed' enrichment status upstream, never a half-valid record
// silently written as if it were trustworthy.
export function validateProductIntelligenceData(raw: unknown): ProductIntelligenceData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ProductIntelligenceValidationError('top-level data must be a non-null object')
  }

  const obj = raw as Record<string, unknown>
  const result = {} as ProductIntelligenceData

  for (const key of PRODUCT_INTELLIGENCE_FIELD_KEYS) {
    const field = obj[key]
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      throw new ProductIntelligenceValidationError(`"${key}" must be an object`)
    }
    const f = field as Record<string, unknown>

    if (!isValidFieldValue(f.value)) {
      throw new ProductIntelligenceValidationError(`"${key}.value" must be a string, string array, or null`)
    }
    if (typeof f.confidence !== 'string' || !CONFIDENCE_VALUES.includes(f.confidence as ProductIntelligenceConfidence)) {
      throw new ProductIntelligenceValidationError(
        `"${key}.confidence" must be one of ${CONFIDENCE_VALUES.join(', ')}`
      )
    }
    if (f.evidence !== undefined && f.evidence !== null && typeof f.evidence !== 'string') {
      throw new ProductIntelligenceValidationError(`"${key}.evidence" must be a string or null when present`)
    }

    result[key] = {
      value: f.value as string | string[] | null,
      confidence: f.confidence as ProductIntelligenceConfidence,
      ...(f.evidence !== undefined ? { evidence: f.evidence as string | null } : {})
    }
  }

  return result
}

export function validateMissingInformation(raw: unknown): string[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw) || !raw.every((v) => typeof v === 'string')) {
    throw new ProductIntelligenceValidationError('"missing_information" must be an array of strings when present')
  }
  return raw
}

export function buildNotStartedIntelligence(): ProductIntelligence {
  return { status: 'not_started', updated_at: null, error: null, missing_information: [], data: null }
}

export function buildProcessingIntelligence(previous: ProductIntelligence | null): ProductIntelligence {
  return {
    status: 'processing',
    updated_at: new Date().toISOString(),
    error: null,
    // A retry stays on top of whatever the last completed run found, rather
    // than blanking the UI back to nothing while the new attempt runs.
    missing_information: previous?.missing_information ?? [],
    data: previous?.data ?? null
  }
}

export function buildCompletedIntelligence(data: ProductIntelligenceData, missingInformation: string[]): ProductIntelligence {
  return { status: 'completed', updated_at: new Date().toISOString(), error: null, missing_information: missingInformation, data }
}

// C9-AC9 — a failed attempt never destroys a previously-completed result;
// only status/error/timestamp move, data/missing_information carry over
// from whatever was last known good (or stay null/[] if nothing ever
// succeeded before).
export function buildFailedIntelligence(previous: ProductIntelligence | null, error: string): ProductIntelligence {
  return {
    status: 'failed',
    updated_at: new Date().toISOString(),
    error,
    missing_information: previous?.missing_information ?? [],
    data: previous?.data ?? null
  }
}
