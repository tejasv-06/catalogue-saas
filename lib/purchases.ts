import { createClient as createSupabaseAdminClient, type SupabaseClient } from '@supabase/supabase-js'
import type { CreditPackageId } from '@/lib/creditPackages'

// Milestone C13: server-only purchase persistence. Same discipline as
// lib/credits.ts's getSupabaseAdminClient: service_role is read ONLY here,
// never exported, never reachable from client code. This module is the
// only place that writes to credit_purchases: matches the migration's own
// design (no INSERT/UPDATE policy exists for the authenticated role at
// all, so there is no browser-facing path that could do this instead).
//
// Every exported function takes an optional trailing `client`, defaulting
// to the real admin client: same seam lib/catalog.ts's functions use,
// here so lib/purchases.test.ts can inject a mock and test the actual
// call shape (RPC parameters, payload contents, idempotency-result
// handling) without a real database.

export type PurchaseStatus = 'pending' | 'paid' | 'fulfilled' | 'failed' | 'cancelled'

export type CreditPurchaseRow = {
  id: string
  user_id: string
  stripe_checkout_session_id: string
  stripe_payment_intent_id: string | null
  stripe_event_id: string | null
  stripe_customer_id: string | null
  package_id: string
  credits: number
  amount: number
  currency: string
  status: PurchaseStatus
  created_at: string
  paid_at: string | null
  fulfilled_at: string | null
}

function getSupabaseAdminClient(): SupabaseClient {
  return createSupabaseAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Called only from app/api/billing/create-checkout/route.ts, immediately
// after a real Stripe Checkout Session has been created: credits/amount
// come from the same lib/creditPackages.ts config the Checkout Session
// itself was built from, never from the request body.
export async function createPendingPurchase(
  params: {
    userId: string
    stripeCheckoutSessionId: string
    packageId: CreditPackageId
    credits: number
    amount: number
    currency: string
  },
  client: SupabaseClient = getSupabaseAdminClient()
): Promise<CreditPurchaseRow> {
  const { data, error } = await client
    .from('credit_purchases')
    .insert({
      user_id: params.userId,
      stripe_checkout_session_id: params.stripeCheckoutSessionId,
      package_id: params.packageId,
      credits: params.credits,
      amount: params.amount,
      currency: params.currency,
      status: 'pending'
    })
    .select()
    .single()

  if (error) throw error
  return data as CreditPurchaseRow
}

export async function getPurchaseByCheckoutSessionId(
  sessionId: string,
  client: SupabaseClient = getSupabaseAdminClient()
): Promise<CreditPurchaseRow | null> {
  const { data, error } = await client.from('credit_purchases').select('*').eq('stripe_checkout_session_id', sessionId).maybeSingle()
  if (error) throw error
  return data as CreditPurchaseRow | null
}

export async function getPurchaseById(id: string, client: SupabaseClient = getSupabaseAdminClient()): Promise<CreditPurchaseRow | null> {
  const { data, error } = await client.from('credit_purchases').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data as CreditPurchaseRow | null
}

// C13 follow-up: markPurchasePaid() (a separate, unconditional "set
// status = 'paid'" UPDATE issued right before the atomic award call) used
// to exist here and was REMOVED after live testing proved it dangerous: it
// had no guard, so calling it on a replayed webhook silently reset an
// already-'fulfilled' purchase back to 'paid', erasing the exact state
// award_purchase_credits()'s idempotency guard depends on: a real,
// live-verified double-credit bug. Recording Stripe's payment identifiers
// is now folded into award_purchase_credits() itself (see
// supabase/migrations/20260810_09_fix_award_purchase_credits_atomicity.sql)
// as part of the SAME atomic statement, so there is no separate write for
// a concurrent/replayed call to land in between "verified" and "awarded."
// Do not reintroduce a standalone status-mutating call in this file
// without a WHERE-clause guard against an already-terminal status.

export async function markPurchaseFailed(id: string, client: SupabaseClient = getSupabaseAdminClient()): Promise<void> {
  const { error } = await client.from('credit_purchases').update({ status: 'failed' }).eq('id', id)
  if (error) throw error
}

export async function markPurchaseCancelled(id: string, client: SupabaseClient = getSupabaseAdminClient()): Promise<void> {
  const { error } = await client.from('credit_purchases').update({ status: 'cancelled' }).eq('id', id)
  if (error) throw error
}

// The one atomic, idempotent credit-award call: see
// supabase/migrations/20260810_09_fix_award_purchase_credits_atomicity.sql
// for the actual guarantee, and its own comment for the real bug this
// fixed: an earlier version of this pipeline called a separate
// markPurchasePaid() UPDATE immediately before this RPC on every webhook
// invocation, which unconditionally reset status back to 'paid': erasing
// this RPC's own `status <> 'fulfilled'` idempotency guard and letting a
// replayed webhook award credits twice. Recording Stripe's payment
// identifiers is now part of THIS SAME atomic statement (the
// p_stripe_* params below) instead of a prior, separate, unguarded write
//: there is no longer an intermediate state between "payment verified"
// and "credits awarded, ledger recorded, purchase fulfilled" for a
// concurrent/replayed call to land in.
//
// `alreadyFulfilled: true` means this purchase was already processed by an
// earlier call (a retried webhook): the caller must treat that as
// success, not an error, and must not have awarded credits a second time.
export async function awardPurchaseCredits(
  params: {
    purchaseId: string
    userId: string
    credits: number
    stripePaymentIntentId: string | null
    stripeEventId: string
    stripeCustomerId: string | null
  },
  client: SupabaseClient = getSupabaseAdminClient()
): Promise<{ creditsRemaining: number | null; alreadyFulfilled: boolean }> {
  const { data, error } = await client.rpc('award_purchase_credits', {
    p_purchase_id: params.purchaseId,
    p_user_id: params.userId,
    p_credits: params.credits,
    p_stripe_payment_intent_id: params.stripePaymentIntentId,
    p_stripe_event_id: params.stripeEventId,
    p_stripe_customer_id: params.stripeCustomerId
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return { creditsRemaining: row?.credits_remaining ?? null, alreadyFulfilled: !!row?.already_fulfilled }
}
