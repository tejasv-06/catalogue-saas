import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripeClient } from '@/lib/stripeClient'
import { getCreditPackage } from '@/lib/creditPackages'
import { verifyStripeWebhookSignature, isSupportedFulfillmentEvent, WebhookSignatureError } from '@/lib/webhookVerification'
import { getPurchaseByCheckoutSessionId, markPurchaseFailed, awardPurchaseCredits } from '@/lib/purchases'

// Milestone C13: POST /api/billing/stripe-webhook. The ONLY authority in
// this whole app that ever awards purchased credits. Nothing here trusts
// anything from a browser request: every fact this route acts on (event
// authenticity, payment status, package/credit amount) is either verified
// via Stripe's own signature mechanism or resolved from this app's own
// trusted config/DB rows.
//
// Raw text, not request.json(): Stripe's signature is computed over the
// exact byte sequence of the body; re-serializing a parsed object would
// almost certainly produce a different byte sequence and fail verification
// even for a genuine event.
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error('stripe-webhook: STRIPE_WEBHOOK_SECRET is not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let stripe
  try {
    stripe = getStripeClient()
  } catch (err: any) {
    console.error('stripe-webhook: Stripe is not configured:', err?.message ?? err)
    return NextResponse.json({ error: 'Billing is not currently available' }, { status: 500 })
  }

  // C13-AC8/AC9: signature verification is mandatory and happens before
  // any parsing of the payload as a trusted event. Rejects an invalid
  // signature OR a malformed/tampered body identically (see
  // lib/webhookVerification.test.ts for direct, credential-free tests of
  // this exact function).
  let event: Stripe.Event
  try {
    event = verifyStripeWebhookSignature(stripe, rawBody, signature, webhookSecret)
  } catch (err: any) {
    if (err instanceof WebhookSignatureError) {
      console.error('stripe-webhook: signature verification failed:', err.message)
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }
    throw err
  }

  // C13-AC10: every event type not explicitly handled below is
  // acknowledged (200, so Stripe doesn't retry it forever) but never
  // awards credits.
  if (!isSupportedFulfillmentEvent(event)) {
    return NextResponse.json({ received: true, handled: false })
  }

  const session = event.data.object as Stripe.Checkout.Session

  const purchase = await getPurchaseByCheckoutSessionId(session.id)
  if (!purchase) {
    // Genuinely unexpected: every Checkout Session this app creates has a
    // pending purchase row written synchronously before the browser is
    // ever redirected to Stripe. Returning 500 lets Stripe's own retry
    // schedule give a transient DB read issue a chance to resolve, rather
    // than permanently dropping a real payment event.
    console.error(`stripe-webhook: no purchase found for checkout session ${session.id}`)
    return NextResponse.json({ error: 'Purchase not found for this session' }, { status: 500 })
  }

  // Defensive re-validation against the SAME trusted config the checkout
  // route used: not because the purchase row can't be trusted (it was
  // written server-side), but so a corrupted/tampered row can never result
  // in awarding an amount that doesn't match a real, currently-valid
  // package definition.
  const pkg = getCreditPackage(purchase.package_id)
  if (!pkg || pkg.credits !== purchase.credits) {
    console.error(`stripe-webhook: purchase ${purchase.id} package/credit mismatch against trusted config`)
    return NextResponse.json({ error: 'Package/credit mismatch' }, { status: 500 })
  }

  // C13-AC11: genuinely successful payment only. Checkout's own
  // payment_status is Stripe's authoritative signal for this, distinct
  // from the event merely having fired.
  if (session.payment_status !== 'paid') {
    try {
      await markPurchaseFailed(purchase.id)
    } catch (err: any) {
      console.error(`stripe-webhook: failed to mark purchase ${purchase.id} failed:`, err?.message ?? err)
    }
    return NextResponse.json({ received: true, handled: false, reason: 'not paid' })
  }

  try {
    // C13-AC13/AC14/AC15: the one atomic, idempotent step. Recording
    // Stripe's payment identifiers happens INSIDE this same call now (see
    // supabase/migrations/20260810_09_fix_award_purchase_credits_atomicity.sql)
    //: there is no separate prior write that could reset the purchase's
    // status between the signature check above and this award. A retried
    // delivery of this same event for an already-fulfilled purchase comes
    // back with alreadyFulfilled: true and creditsRemaining: null: this
    // is success, not an error, and must not be treated as a second award.
    const result = await awardPurchaseCredits({
      purchaseId: purchase.id,
      userId: purchase.user_id,
      credits: purchase.credits,
      stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null,
      stripeEventId: event.id,
      stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null
    })

    if (result.alreadyFulfilled) {
      return NextResponse.json({ received: true, handled: true, alreadyFulfilled: true })
    }

    return NextResponse.json({ received: true, handled: true, creditsRemaining: result.creditsRemaining })
  } catch (err: any) {
    // C13: never award partial credits, never silently swallow. A
    // thrown error here means the atomic award step itself failed (a real
    // DB error, not a guard-clause no-op): returning 500 lets Stripe
    // retry, which is safe precisely because the award step is idempotent.
    console.error(`stripe-webhook: failed to fulfill purchase ${purchase.id}:`, err?.message ?? err)
    return NextResponse.json({ error: 'Failed to fulfill purchase' }, { status: 500 })
  }
}
