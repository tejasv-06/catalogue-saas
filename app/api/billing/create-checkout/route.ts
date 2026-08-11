import { NextResponse } from 'next/server'
import { createClient as createAuthClient } from '@/lib/supabase/server'
import { buildCheckoutSessionParams } from '@/lib/checkoutParams'
import { getStripeClient } from '@/lib/stripeClient'
import { createPendingPurchase } from '@/lib/purchases'

// Milestone C13 — POST /api/billing/create-checkout.
//
// The ONLY trusted input from the browser is `packageId` (a string looked
// up against lib/creditPackages.ts's fixed config, via
// lib/checkoutParams.ts's buildCheckoutSessionParams — see that file's
// tests for direct, credential-free proof that no credit/price value can
// come from anywhere but that config). No credit amount, no price, no user
// id, and no purchase/payment status is ever accepted from the request
// body — this route is the one place that resolves packageId ->
// credits/price, and every other part of the C13 pipeline (the pending
// purchase row, the Checkout Session's own price_data, the eventual
// webhook fulfillment) is built from what THIS route decided, never from
// anything the client could still influence after this point.
export async function POST(request: Request) {
  // Identity comes from the authenticated session only — never from the
  // request body. Same pattern as every other authenticated route in this
  // app (generate-single, enrich-product, ...).
  const authClient = await createAuthClient()
  const { data: authData } = await authClient.auth.getClaims()
  const userId = authData?.claims?.sub as string | undefined

  if (!userId) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const packageId = body?.packageId

  if (!packageId || typeof packageId !== 'string') {
    return NextResponse.json({ error: 'Missing packageId' }, { status: 400 })
  }

  const origin = request.headers.get('origin') || new URL(request.url).origin
  const result = buildCheckoutSessionParams({ userId, packageId, origin })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  const { params } = result

  let stripe
  try {
    stripe = getStripeClient()
  } catch (err: any) {
    console.error('create-checkout: Stripe is not configured:', err?.message ?? err)
    return NextResponse.json({ error: 'Billing is not currently available' }, { status: 500 })
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: params.mode,
      line_items: [
        {
          price_data: {
            currency: params.lineItems[0].priceData.currency,
            unit_amount: params.lineItems[0].priceData.unitAmount,
            product_data: { name: params.lineItems[0].priceData.productName }
          },
          quantity: params.lineItems[0].quantity
        }
      ],
      client_reference_id: params.clientReferenceId,
      metadata: params.metadata,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl
    })

    if (!session.url) {
      throw new Error('Stripe did not return a Checkout URL')
    }

    // Pending purchase row — created only after the real Checkout Session
    // exists, using that session's own id (never a client-supplied value)
    // as the row's idempotency key (credit_purchases_checkout_session_idx).
    await createPendingPurchase({
      userId,
      stripeCheckoutSessionId: session.id,
      packageId: params.package.id,
      credits: params.package.credits,
      amount: params.package.unitAmount,
      currency: params.package.currency
    })

    // Only the Checkout URL is returned — no credit amount, no purchase
    // id, nothing the browser could misuse as "proof" of anything.
    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error('create-checkout: failed to create Stripe session:', err?.message ?? err)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 })
  }
}
