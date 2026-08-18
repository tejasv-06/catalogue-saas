import Stripe from 'stripe'

// Milestone C13: the one place STRIPE_SECRET_KEY is read. Server-only
// module (imported only by app/api/billing/* route files); never imported
// by a "use client" component, so this key can never reach the browser
// bundle. Throws clearly rather than silently proceeding with an invalid
// key if the env var is missing: the same "do not invent credentials"
// discipline this project applies everywhere else.
export function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  return new Stripe(secretKey)
}
