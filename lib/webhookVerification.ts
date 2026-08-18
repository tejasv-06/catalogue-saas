import type Stripe from 'stripe'

// Milestone C13: extracted from app/api/billing/stripe-webhook/route.ts so
// the actual security-critical logic (signature verification, supported-
// event filtering) can be unit-tested directly with node:test, the same
// "extract pure/testable logic out of the route" pattern already
// established by lib/exportReadiness.ts. Both functions here are pure
// local operations: Stripe's webhook signature check is HMAC-based and
// makes no network call, so these are fully testable without any real
// Stripe credentials (see lib/webhookVerification.test.ts).

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebhookSignatureError'
  }
}

// C13-AC8/AC9: the one function standing between "bytes someone POSTed to
// this endpoint" and "an event this app will act on." Throws
// WebhookSignatureError for anything that doesn't verify: an invalid
// signature, a wrong secret, or a payload that doesn't match the
// signature (including a malformed/tampered body): never returns a
// partially-trusted result.
export function verifyStripeWebhookSignature(
  stripe: Stripe,
  rawBody: string,
  signature: string,
  webhookSecret: string
): Stripe.Event {
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err: any) {
    throw new WebhookSignatureError(err?.message ?? 'Invalid webhook signature')
  }
}

// C13-AC10: checkout.session.completed is the only event this app acts
// on (Stripe's own documented event for a successful Checkout in
// mode: 'payment'). Everything else: including other legitimate Stripe
// events this app simply doesn't need: must be explicitly ignored, never
// silently trigger a credit award.
export function isSupportedFulfillmentEvent(event: Stripe.Event): boolean {
  return event.type === 'checkout.session.completed'
}
