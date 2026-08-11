// Unit tests for lib/productIntelligence.ts, using Node's built-in test
// runner (no new dependency — tsx is already a project devDependency).
// Run with: npx tsx --test lib/productIntelligence.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateProductIntelligenceData,
  validateMissingInformation,
  ProductIntelligenceValidationError,
  buildNotStartedIntelligence,
  buildProcessingIntelligence,
  buildCompletedIntelligence,
  buildFailedIntelligence,
  PRODUCT_INTELLIGENCE_FIELD_KEYS,
  EXAMPLE_PRODUCT_INTELLIGENCE_DATA
} from './productIntelligence'

function validField(overrides: Partial<{ value: any; confidence: any; evidence: any }> = {}) {
  return { value: 'x', confidence: 'high', ...overrides }
}

function fullValidData(overrides: Record<string, any> = {}) {
  const data: Record<string, any> = {}
  for (const key of PRODUCT_INTELLIGENCE_FIELD_KEYS) {
    data[key] = validField()
  }
  return { ...data, ...overrides }
}

test('validateProductIntelligenceData accepts a fully well-formed object', () => {
  const data = fullValidData()
  const result = validateProductIntelligenceData(data)
  assert.equal(result.product_type.value, 'x')
  assert.equal(result.product_type.confidence, 'high')
  for (const key of PRODUCT_INTELLIGENCE_FIELD_KEYS) {
    assert.ok(key in result)
  }
})

test('validateProductIntelligenceData accepts array values (e.g. colors, search_keywords)', () => {
  const data = fullValidData({ colors: validField({ value: ['red', 'blue'] }), search_keywords: validField({ value: ['a', 'b', 'c'] }) })
  const result = validateProductIntelligenceData(data)
  assert.deepEqual(result.colors.value, ['red', 'blue'])
  assert.deepEqual(result.search_keywords.value, ['a', 'b', 'c'])
})

test('validateProductIntelligenceData accepts the array-field wrapper for key_selling_points specifically', () => {
  // C9 follow-up regression — the exact field observed failing live (3/7
  // real Groq calls specifically named this field). Confirms the CORRECT
  // shape (wrapped) is accepted; the next test confirms the WRONG shape
  // (bare array, what the model was actually sending) is rejected.
  const data = fullValidData({ key_selling_points: validField({ value: ['handmade', 'unique design', 'durable'] }) })
  const result = validateProductIntelligenceData(data)
  assert.deepEqual(result.key_selling_points.value, ['handmade', 'unique design', 'durable'])
  assert.equal(result.key_selling_points.confidence, 'high')
})

test('validateProductIntelligenceData accepts null value with unknown confidence (genuinely unknown attribute)', () => {
  const data = fullValidData({ occasion: { value: null, confidence: 'unknown' } })
  const result = validateProductIntelligenceData(data)
  assert.equal(result.occasion.value, null)
  assert.equal(result.occasion.confidence, 'unknown')
})

test('validateProductIntelligenceData preserves evidence when present, omits it when absent', () => {
  const data = fullValidData({ material: validField({ evidence: 'label reads 100% cotton' }) })
  const result = validateProductIntelligenceData(data)
  assert.equal(result.material.evidence, 'label reads 100% cotton')
  assert.ok(!('evidence' in result.pattern))
})

test('validateProductIntelligenceData rejects a missing required key', () => {
  const data = fullValidData()
  delete data.material
  assert.throws(() => validateProductIntelligenceData(data), ProductIntelligenceValidationError)
})

test('validateProductIntelligenceData rejects an invalid confidence value (never fabricated)', () => {
  const data = fullValidData({ style: validField({ confidence: 'very-sure' }) })
  assert.throws(() => validateProductIntelligenceData(data), ProductIntelligenceValidationError)
})

test('validateProductIntelligenceData rejects a non-string/array/null value', () => {
  const data = fullValidData({ colors: validField({ value: 42 }) })
  assert.throws(() => validateProductIntelligenceData(data), ProductIntelligenceValidationError)
})

test('validateProductIntelligenceData rejects a non-object top level (e.g. malformed AI output)', () => {
  assert.throws(() => validateProductIntelligenceData('not an object'), ProductIntelligenceValidationError)
  assert.throws(() => validateProductIntelligenceData(null), ProductIntelligenceValidationError)
  assert.throws(() => validateProductIntelligenceData([1, 2, 3]), ProductIntelligenceValidationError)
})

// C9 follow-up — locks in the exact discovered live defect as a permanent
// regression test. The validator already rejected this correctly (that's
// how the bug was caught live in the first place) — these tests exist so a
// future change can never silently start accepting the malformed shape
// again, per the explicit instruction not to weaken the validator or
// silently coerce malformed AI output.
test('validateProductIntelligenceData rejects colors as a bare array (the exact shape the model returned live)', () => {
  const data = fullValidData()
  data.colors = ['white', 'blue'] // bare array, not { value: [...], confidence: ... }
  assert.throws(() => validateProductIntelligenceData(data), ProductIntelligenceValidationError)
})

test('validateProductIntelligenceData rejects key_selling_points as a bare array (the exact shape the model returned live)', () => {
  const data = fullValidData()
  data.key_selling_points = ['handmade', 'unique design'] // bare array
  assert.throws(() => validateProductIntelligenceData(data), ProductIntelligenceValidationError)
})

test('validateProductIntelligenceData rejects search_keywords as a bare array', () => {
  const data = fullValidData()
  data.search_keywords = ['ceramic clock', 'wall decor']
  assert.throws(() => validateProductIntelligenceData(data), ProductIntelligenceValidationError)
})

// C9 follow-up — the fix itself: app/api/enrich-product/route.ts now
// renders EXAMPLE_PRODUCT_INTELLIGENCE_DATA verbatim into the prompt as a
// concrete worked example (replacing the abstract TypeScript-union
// description that caused the live failures). This test is the single
// source of truth guaranteeing that example is, and stays, real, valid data
// — if a future edit to the example ever breaks its own shape, this fails
// immediately instead of silently corrupting every future enrichment
// prompt.
test('EXAMPLE_PRODUCT_INTELLIGENCE_DATA (rendered verbatim into the enrichment prompt) is itself valid against the real validator', () => {
  const result = validateProductIntelligenceData(EXAMPLE_PRODUCT_INTELLIGENCE_DATA)
  assert.deepEqual(result, EXAMPLE_PRODUCT_INTELLIGENCE_DATA)
})

test('EXAMPLE_PRODUCT_INTELLIGENCE_DATA demonstrates the array-field wrapper explicitly for every array-shaped field', () => {
  for (const key of ['colors', 'key_selling_points', 'search_keywords'] as const) {
    const field = EXAMPLE_PRODUCT_INTELLIGENCE_DATA[key]
    assert.ok(!Array.isArray(field), `"${key}" itself must be the wrapper object, not a bare array`)
    assert.ok(Array.isArray(field.value), `"${key}.value" must be an array`)
  }
})

test('EXAMPLE_PRODUCT_INTELLIGENCE_DATA demonstrates the null/unknown case honestly (occasion)', () => {
  assert.equal(EXAMPLE_PRODUCT_INTELLIGENCE_DATA.occasion.value, null)
  assert.equal(EXAMPLE_PRODUCT_INTELLIGENCE_DATA.occasion.confidence, 'unknown')
})

test('validateMissingInformation accepts an array of strings, defaults to [] when absent', () => {
  assert.deepEqual(validateMissingInformation(['no image provided']), ['no image provided'])
  assert.deepEqual(validateMissingInformation(undefined), [])
  assert.deepEqual(validateMissingInformation(null), [])
})

test('validateMissingInformation rejects a non-string-array', () => {
  assert.throws(() => validateMissingInformation(['ok', 42]), ProductIntelligenceValidationError)
  assert.throws(() => validateMissingInformation('not an array'), ProductIntelligenceValidationError)
})

test('buildNotStartedIntelligence returns the not_started default with no data', () => {
  const result = buildNotStartedIntelligence()
  assert.equal(result.status, 'not_started')
  assert.equal(result.data, null)
  assert.deepEqual(result.missing_information, [])
})

test('buildProcessingIntelligence carries over prior completed data rather than blanking it', () => {
  const prior = buildCompletedIntelligence(fullValidData() as any, ['no image'])
  const processing = buildProcessingIntelligence(prior)
  assert.equal(processing.status, 'processing')
  assert.equal(processing.data, prior.data)
  assert.deepEqual(processing.missing_information, ['no image'])
})

test('buildFailedIntelligence preserves prior successful data and does not fabricate new data', () => {
  const prior = buildCompletedIntelligence(fullValidData() as any, [])
  const failed = buildFailedIntelligence(prior, 'model returned malformed JSON')
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error, 'model returned malformed JSON')
  assert.equal(failed.data, prior.data)
})

test('buildFailedIntelligence with no prior success has null data, not fabricated data', () => {
  const failed = buildFailedIntelligence(null, 'Groq API error')
  assert.equal(failed.data, null)
  assert.deepEqual(failed.missing_information, [])
})

test('buildCompletedIntelligence sets status completed and stores the given data verbatim', () => {
  const data = fullValidData() as any
  const result = buildCompletedIntelligence(data, ['size not specified'])
  assert.equal(result.status, 'completed')
  assert.equal(result.error, null)
  assert.equal(result.data, data)
  assert.deepEqual(result.missing_information, ['size not specified'])
})
