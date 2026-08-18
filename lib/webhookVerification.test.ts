// Unit tests for lib/webhookVerification.ts (Milestone C13).
//
// Uses the real `stripe` SDK's webhook signing helpers directly: signature
// verification is pure HMAC-SHA256, entirely local, no network call and no
// real Stripe account needed (Stripe's own test suites use exactly this
// pattern: a syntactically-valid but fake test key, used only to construct
// a Stripe client object; it is never used to make an API call in this
// file). This is the one place in C13's test suite that proves the actual
// security mechanism (not just the application logic around it) works,
// without requiring real credentials this environment doesn't have.
//
// Run with: npx tsx --test lib/webhookVerification.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import Stripe from 'stripe'
import { verifyStripeWebhookSignature, isSupportedFulfillmentEvent, WebhookSignatureError } from './webhookVerification'

// Not a real Stripe secret: never used for a network call anywhere in
// this file, only to satisfy the SDK constructor.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'mock_sk_test_key_for_testing_only');
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'mock_whsec_key_for_testing_only';

function makeCheckoutCompletedPayload(overrides: Record<string, any> = {}) {
  return JSON.stringify({
    id: 'evt_test_123',
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_123',
        object: 'checkout.session',
        payment_status: 'paid',
        payment_intent: 'pi_test_123',
        customer: 'cus_test_123',
        ...overrides
      }
    }
  })
}

test('verifyStripeWebhookSignature accepts a genuinely, correctly signed payload', () => {
  const payload = makeCheckoutCompletedPayload()
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })

  const event = verifyStripeWebhookSignature(stripe, payload, header, WEBHOOK_SECRET)
  assert.equal(event.type, 'checkout.session.completed')
})

test('verifyStripeWebhookSignature rejects a signature computed with the WRONG secret (C13-AC8/AC9)', () => {
  const payload = makeCheckoutCompletedPayload()
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_a_completely_different_secret' })

  assert.throws(() => verifyStripeWebhookSignature(stripe, payload, header, WEBHOOK_SECRET), WebhookSignatureError)
})

test('verifyStripeWebhookSignature rejects a tampered payload (valid signature for DIFFERENT bytes)', () => {
  const originalPayload = makeCheckoutCompletedPayload()
  const header = stripe.webhooks.generateTestHeaderString({ payload: originalPayload, secret: WEBHOOK_SECRET })
  // Same header/signature, but the body an attacker actually sent differs
  // from what was signed: e.g. trying to inflate the credited amount by
  // editing the event after the fact.
  const tamperedPayload = makeCheckoutCompletedPayload({ payment_status: 'unpaid' })

  assert.throws(() => verifyStripeWebhookSignature(stripe, tamperedPayload, header, WEBHOOK_SECRET), WebhookSignatureError)
})

test('verifyStripeWebhookSignature rejects a malformed/garbage signature header', () => {
  const payload = makeCheckoutCompletedPayload()
  assert.throws(
    () => verifyStripeWebhookSignature(stripe, payload, 'not-a-real-stripe-signature-header', WEBHOOK_SECRET),
    WebhookSignatureError
  )
})

test('verifyStripeWebhookSignature rejects a malformed body even with a syntactically-plausible header', () => {
  const payload = makeCheckoutCompletedPayload()
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })
  assert.throws(
    () => verifyStripeWebhookSignature(stripe, '{not valid json at all', header, WEBHOOK_SECRET),
    WebhookSignatureError
  )
})

test('isSupportedFulfillmentEvent accepts checkout.session.completed', () => {
  const payload = makeCheckoutCompletedPayload()
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })
  const event = verifyStripeWebhookSignature(stripe, payload, header, WEBHOOK_SECRET)
  assert.equal(isSupportedFulfillmentEvent(event), true)
})

test('isSupportedFulfillmentEvent rejects every other event type: C13-AC10, no credit award for unsupported events', () => {
  for (const type of ['payment_intent.succeeded', 'charge.refunded', 'customer.created', 'invoice.paid']) {
    const payload = JSON.stringify({ id: 'evt_x', object: 'event', type, data: { object: {} } })
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })
    const event = verifyStripeWebhookSignature(stripe, payload, header, WEBHOOK_SECRET)
    assert.equal(isSupportedFulfillmentEvent(event), false, `expected ${type} to be unsupported`)
  }
})
