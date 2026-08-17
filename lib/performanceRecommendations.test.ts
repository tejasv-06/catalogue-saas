// Unit tests for lib/performanceRecommendations.ts. Milestone C15.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getRecommendation, DIAGNOSIS_RECOMMENDATIONS } from './performanceRecommendations'
import { PERFORMANCE_THRESHOLDS } from './performanceDiagnosis'

// --- 22. Recommendation mapping ----------------------------------------------

test('22. every weak/problem diagnosis code has a recommendation', () => {
  for (const code of ['DISCOVERABILITY_WEAK', 'CTR_WEAK', 'CONVERSION_WEAK', 'ATC_WEAK', 'RETURNS_HIGH', 'RATING_WEAK'] as const) {
    assert.ok(getRecommendation(code), `expected a recommendation for ${code}`)
  }
})

test('22. getRecommendation returns null for a code with no defensible investigation to suggest', () => {
  assert.equal(getRecommendation('CTR_HEALTHY'), null)
  assert.equal(getRecommendation('TRAFFIC_HEALTHY'), null)
  assert.equal(getRecommendation('PERFORMANCE_IMPROVING'), null)
})

// --- §11 language safety: never claim causation/guaranteed improvement ------

test('no recommendation claims a change WILL improve sales/performance — only "consider"/"recommends reviewing"/"potential issue" language', () => {
  const forbiddenPhrases = [/will improve/i, /will increase/i, /will boost/i, /guaranteed/i, /this will fix/i]
  for (const [code, text] of Object.entries(DIAGNOSIS_RECOMMENDATIONS)) {
    for (const phrase of forbiddenPhrases) {
      assert.ok(!phrase.test(text as string), `recommendation for ${code} uses forbidden causal language: "${text}"`)
    }
  }
})

test('every recommendation uses one of the sanctioned investigative phrasings', () => {
  const sanctioned = [/consider/i, /recommends reviewing/i, /potential issue/i, /not enough/i]
  for (const [code, text] of Object.entries(DIAGNOSIS_RECOMMENDATIONS)) {
    const matchesOne = sanctioned.some((phrase) => phrase.test(text as string))
    assert.ok(matchesOne, `recommendation for ${code} does not use sanctioned investigative language: "${text}"`)
  }
})

test('this module contains no threshold numbers of its own — recommendations only ever read the DiagnosisCode, thresholds stay centralized in lib/performanceDiagnosis.ts', () => {
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const source = fs.readFileSync(path.join(__dirname, 'performanceRecommendations.ts'), 'utf8')
  assert.ok(!/\d+(\.\d+)?%/.test(source), 'no hardcoded percentage should appear in the recommendations module')
  assert.ok(PERFORMANCE_THRESHOLDS.CTR_WEAK_BELOW_PERCENT > 0) // sanity: the real threshold config does exist, just not duplicated here
})
