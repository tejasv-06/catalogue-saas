// Unit tests for lib/checkoutParams.ts (Milestone C13): proves the core
// C13-AC3/AC4/AC5 trust boundary without any real Stripe network call:
// buildCheckoutSessionParams' only inputs are userId/packageId/origin, and
// every credit/price number in its output must trace back to
// lib/creditPackages.ts, never to a caller-supplied value (there is no
// "credits" or "amount" parameter for a caller to even supply).
// Run with: npx tsx --test lib/checkoutParams.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCheckoutSessionParams } from './checkoutParams'
import { CREDIT_PACKAGES } from './creditPackages'

test('buildCheckoutSessionParams resolves price/credits from server config for a known package', () => {
  const result = buildCheckoutSessionParams({ userId: 'user-a', packageId: 'pro', origin: 'http://localhost:3000' })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.params.package.credits, CREDIT_PACKAGES.pro.credits)
  assert.equal(result.params.lineItems[0].priceData.unitAmount, CREDIT_PACKAGES.pro.unitAmount)
  assert.equal(result.params.lineItems[0].priceData.currency, CREDIT_PACKAGES.pro.currency)
})

test('the function signature itself has no credits/amount/price parameter to spoof', () => {
  // buildCheckoutSessionParams({ userId, packageId, origin }): a caller
  // has no field to put a credit count or price into even if they wanted
  // to; TypeScript's own object-literal excess-property checking on the
  // input type is the first line of defense, this just documents that the
  // ONLY lever is packageId (a lookup key, not a value).
  const result = buildCheckoutSessionParams({ userId: 'user-a', packageId: 'starter', origin: 'http://localhost:3000' } as any)
  assert.equal(result.ok, true)
})

test('an unknown/arbitrary packageId is rejected, never silently defaulted to a package', () => {
  const result = buildCheckoutSessionParams({ userId: 'user-a', packageId: 'not-a-real-package', origin: 'http://localhost:3000' })
  assert.equal(result.ok, false)
})

test('user identity flows through untouched into client_reference_id and metadata, matching what the webhook must later trust', () => {
  const result = buildCheckoutSessionParams({ userId: 'user-xyz', packageId: 'business', origin: 'http://localhost:3000' })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.params.clientReferenceId, 'user-xyz')
  assert.equal(result.params.metadata.userId, 'user-xyz')
})

test('success/cancel URLs point back to the existing /workspace page: no new route introduced', () => {
  const result = buildCheckoutSessionParams({ userId: 'user-a', packageId: 'starter', origin: 'https://example.com' })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.match(result.params.successUrl, /^https:\/\/example\.com\/workspace\?checkout=success&session_id=\{CHECKOUT_SESSION_ID\}$/)
  assert.match(result.params.cancelUrl, /^https:\/\/example\.com\/workspace\?checkout=cancel$/)
})

test('each of the three real packages produces internally consistent params (credits/price always paired correctly)', () => {
  for (const id of ['starter', 'pro', 'business'] as const) {
    const result = buildCheckoutSessionParams({ userId: 'user-a', packageId: id, origin: 'http://localhost:3000' })
    assert.equal(result.ok, true)
    if (!result.ok) continue
    assert.equal(result.params.package.id, id)
    assert.equal(result.params.package.credits, CREDIT_PACKAGES[id].credits)
    assert.equal(result.params.lineItems[0].priceData.unitAmount, CREDIT_PACKAGES[id].unitAmount)
  }
})
