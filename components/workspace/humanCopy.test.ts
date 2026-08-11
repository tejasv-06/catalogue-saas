// Unit tests for components/workspace/humanCopy.ts (Milestone C17). Pure
// presentation-translation logic only — every scenario here is built from
// REAL computeListingHealth output (via shapeForPlatform, the same
// convention lib/listingHealth.test.ts and friends already use), never a
// hand-typed fake status, so a test failure here would mean the human
// copy actually drifted from what lib/listingHealth.ts really reports.
// Run with: npx tsx --test components/workspace/humanCopy.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { marketplaceChipFor, explainMissing, readinessSentence, CHIP_TONE_CLASS } from './humanCopy'
import { computeListingHealth } from '@/lib/listingHealth'
import { shapeForPlatform } from '@/lib/platformShapers'
import { getMarketplaceAdapter } from '@/lib/marketplaceAdapters'

const sampleAi = {
  title: 'Handwoven Jute Doormat',
  description: 'A durable, eco-friendly doormat woven from natural jute fiber.',
  bullets: ['100% natural jute', 'Non-slip backing', 'Absorbs moisture', 'Fits standard doorways', 'Easy to clean'],
  keywordPool: ['jute doormat', 'eco-friendly mat', 'natural fiber rug', 'entrance mat', 'doormat']
}

// --- marketplaceChipFor ---

test('marketplaceChipFor: not attempted -> "Not started", never the raw ready/needs-review vocabulary', () => {
  const chip = marketplaceChipFor(false, null)
  assert.equal(chip.tone, 'not-started')
  assert.equal(chip.label, 'Not started')
})

test('marketplaceChipFor: a fully ready listing -> "Complete"', () => {
  const content = shapeForPlatform('amazon', sampleAi, { brand_name: 'Acme' })
  const health = computeListingHealth('amazon', content, null, null)
  assert.equal(health.status, 'ready') // sanity: this fixture really is ready
  const chip = marketplaceChipFor(true, health)
  assert.deepEqual(chip, { tone: 'complete', label: 'Complete' })
})

test('marketplaceChipFor: a generation error -> "Couldn\'t generate", never the word "error" itself', () => {
  const health = computeListingHealth('amazon', null, 'Model returned empty content', null)
  const chip = marketplaceChipFor(true, health)
  assert.equal(chip.tone, 'blocked')
  assert.ok(!/error/i.test(chip.label))
})

test('marketplaceChipFor: missing required Myntra fields -> a real count of missing details, not "missing-data"', () => {
  const incomplete = { vendorArticleName: 'Only a name' }
  const health = computeListingHealth('myntra', incomplete, null, null)
  assert.equal(health.status, 'missing-data')
  const chip = marketplaceChipFor(true, health)
  assert.equal(chip.tone, 'blocked')
  assert.match(chip.label, /\d+ details? needed/)
})

test('marketplaceChipFor: a needs-review listing (over the title limit) -> "Needs a look"', () => {
  const content = {
    title: 'X'.repeat(100),
    description: 'A description.',
    bullets: ['a', 'b', 'c', 'd', 'e'],
    genericKeywords: 'k'
  }
  const health = computeListingHealth('amazon', content, null, null)
  assert.equal(health.status, 'needs-review')
  const chip = marketplaceChipFor(true, health)
  assert.deepEqual(chip, { tone: 'attention', label: 'Needs a look' })
})

test('every MarketplaceChipTone has a defined color class (CHIP_TONE_CLASS is exhaustive)', () => {
  for (const tone of ['complete', 'attention', 'blocked', 'not-started'] as const) {
    assert.ok(CHIP_TONE_CLASS[tone], `expected a class for tone "${tone}"`)
  }
})

// --- explainMissing ---

test('explainMissing returns null for a ready listing — nothing to explain', () => {
  const content = shapeForPlatform('etsy', sampleAi, { brand_name: 'Acme' })
  const health = computeListingHealth('etsy', content, null, null)
  assert.equal(explainMissing('Etsy', health), null)
})

test('explainMissing names the real failing checks in plain language for a missing-data listing', () => {
  const health = computeListingHealth('myntra', { vendorArticleName: 'x' }, null, null)
  const sentence = explainMissing('Myntra', health)
  assert.ok(sentence)
  assert.match(sentence!, /^Myntra needs /)
  assert.match(sentence!, /before it's complete\.$/)
})

test('explainMissing gives a distinct, honest sentence for an outright generation failure', () => {
  const health = computeListingHealth('amazon', null, 'timeout', null)
  const sentence = explainMissing('Amazon', health)
  assert.match(sentence!, /couldn't generate/i)
})

// --- readinessSentence ---

test('readinessSentence: READY -> a plain "content is complete" sentence', () => {
  const content = shapeForPlatform('flipkart', sampleAi, { brand_name: 'Acme' })
  const readiness = getMarketplaceAdapter('flipkart')!.validate(content, null, null)
  assert.equal(readiness.status, 'READY')
  assert.equal(readinessSentence('Flipkart', readiness), 'Your Flipkart content is complete.')
})

test('readinessSentence: NOT_READY -> the real first issue message, not a generic string', () => {
  const readiness = getMarketplaceAdapter('myntra')!.validate({ vendorArticleName: 'x' }, null, null)
  assert.equal(readiness.status, 'NOT_READY')
  const sentence = readinessSentence('Myntra', readiness)
  assert.match(sentence, /^Myntra: /)
  assert.equal(sentence, `Myntra: ${readiness.issues[0].message}`)
})
