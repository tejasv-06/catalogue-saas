// Milestone C13 (Phase 10N): server-trusted credit package configuration.
// The ONLY source of truth for "packageId -> credits -> price" anywhere in
// this app. The browser sends a packageId string and nothing else; every
// number that actually matters (credits, price) is resolved here, never
// accepted from a request body. See app/api/billing/create-checkout/route.ts
// and app/api/billing/stripe-webhook/route.ts: both import from this file,
// neither defines its own numbers.
//
// PLACEHOLDER PRICING: audited the repository before writing this file
// (grep for "stripe"/pricing across the whole project returned nothing):
// no production pricing exists anywhere to reuse. These three packages and
// their prices are non-production placeholders, isolated to this one file,
// only so the checkout/webhook architecture has something concrete to
// compile and test against. Real pricing must be supplied by the business
// before this goes live: do not treat these numbers as approved pricing.
//
// No pre-created Stripe Price ID is required for any package: the checkout
// route builds Stripe's Checkout Session with inline `price_data` (currency
// + unit_amount + product name) sourced from this same config, rather than
// referencing a Price object that would need to already exist in the Stripe
// Dashboard. This keeps "packageId -> price" a single, auditable source
// instead of splitting it between this file and Stripe's own dashboard.

export type CreditPackageId = 'starter' | 'pro' | 'business'

export type CreditPackage = {
  id: CreditPackageId
  label: string
  credits: number
  // Smallest currency unit (cents), matching Stripe's own unit_amount
  // convention: avoids a float-money bug class entirely.
  unitAmount: number
  currency: 'usd'
}

export const CREDIT_PACKAGES: Record<CreditPackageId, CreditPackage> = {
  starter: { id: 'starter', label: 'Starter: 50 credits', credits: 50, unitAmount: 500, currency: 'usd' },
  pro: { id: 'pro', label: 'Pro: 200 credits', credits: 200, unitAmount: 1500, currency: 'usd' },
  business: { id: 'business', label: 'Business: 600 credits', credits: 600, unitAmount: 4000, currency: 'usd' }
}

export const CREDIT_PACKAGE_IDS = Object.keys(CREDIT_PACKAGES) as CreditPackageId[]

// The one function every caller (checkout route, webhook route, tests)
// uses to turn an untrusted string into trusted package data: returns
// undefined for anything not in CREDIT_PACKAGES, never a best-effort guess.
//
// hasOwnProperty guard is deliberate, not defensive-programming theater: a
// plain object literal inherits from Object.prototype, so a caller-supplied
// packageId of "__proto__" or "constructor" would otherwise resolve
// through the prototype chain instead of returning undefined: caught by
// this file's own test suite. This is exactly the class of input C13's
// "browser cannot choose arbitrary credit quantities" requirement exists
// to guard against, so it gets the same rigor as any other untrusted input.
export function getCreditPackage(packageId: string): CreditPackage | undefined {
  if (!Object.prototype.hasOwnProperty.call(CREDIT_PACKAGES, packageId)) return undefined
  return CREDIT_PACKAGES[packageId as CreditPackageId]
}
