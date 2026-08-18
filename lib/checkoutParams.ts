import { getCreditPackage, type CreditPackage } from '@/lib/creditPackages'

// Milestone C13: extracted from app/api/billing/create-checkout/route.ts
// so the actual trust boundary (packageId -> Stripe Checkout Session
// params) is unit-testable without a real Stripe network call: creating a
// Checkout Session is a live API call and can't be exercised without real
// credentials, but resolving WHAT would be sent is pure, local, and is
// exactly the logic that proves "the browser cannot choose arbitrary
// credit quantities/prices" (C13-AC3/AC4): this function's only input
// besides userId/origin is a packageId string, and every number in its
// output comes from lib/creditPackages.ts, never from a parameter.

export type CheckoutSessionParams = {
  mode: 'payment'
  lineItems: [{ priceData: { currency: string; unitAmount: number; productName: string }; quantity: 1 }]
  clientReferenceId: string
  metadata: { userId: string; packageId: string }
  successUrl: string
  cancelUrl: string
  package: CreditPackage
}

export type CheckoutParamsResult = { ok: true; params: CheckoutSessionParams } | { ok: false; error: string }

export function buildCheckoutSessionParams(input: { userId: string; packageId: string; origin: string }): CheckoutParamsResult {
  const pkg = getCreditPackage(input.packageId)
  if (!pkg) {
    return { ok: false, error: 'Unknown package' }
  }

  return {
    ok: true,
    params: {
      mode: 'payment',
      lineItems: [
        {
          priceData: { currency: pkg.currency, unitAmount: pkg.unitAmount, productName: pkg.label },
          quantity: 1
        }
      ],
      clientReferenceId: input.userId,
      metadata: { userId: input.userId, packageId: pkg.id },
      successUrl: `${input.origin}/workspace?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${input.origin}/workspace?checkout=cancel`,
      package: pkg
    }
  }
}
