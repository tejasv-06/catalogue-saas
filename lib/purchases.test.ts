// Unit tests for lib/purchases.ts (Milestone C13), using Node's built-in
// test runner. Run with: npx tsx --test lib/purchases.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createPendingPurchase,
  getPurchaseByCheckoutSessionId,
  markPurchasePaid,
  markPurchaseFailed,
  markPurchaseCancelled,
  awardPurchaseCredits
} from './purchases'

// Mirrors lib/catalog.test.ts's makeMockClient convention exactly — same
// fluent-builder shape, records every call so tests can assert on the
// exact payload/parameters sent.
function makeMockClient(opts: { result?: { data: any; error: any }; rpcResult?: { data: any; error: any } }) {
  const calls: { table?: string; op: string; payload?: any }[] = []

  const builder: any = {
    insert(payload: any) {
      calls.push({ op: 'insert', payload })
      return builder
    },
    update(payload: any) {
      calls.push({ op: 'update', payload })
      return builder
    },
    select(columns?: any) {
      calls.push({ op: 'select', payload: columns })
      return builder
    },
    eq(column: string, value: any) {
      calls.push({ op: 'eq', payload: { column, value } })
      return builder
    },
    single() {
      return Promise.resolve(opts.result ?? { data: null, error: null })
    },
    maybeSingle() {
      return Promise.resolve(opts.result ?? { data: null, error: null })
    }
  }

  const client: any = {
    from(table: string) {
      calls.push({ op: 'from', table })
      return builder
    },
    rpc(fn: string, params: any) {
      calls.push({ op: 'rpc', table: fn, payload: params })
      return Promise.resolve(opts.rpcResult ?? { data: null, error: null })
    },
    __calls: calls
  }

  return client
}

test('createPendingPurchase inserts status "pending" and never a caller-suppliable status', async () => {
  const row = { id: 'pur-1', status: 'pending' }
  const client = makeMockClient({ result: { data: row, error: null } })

  await createPendingPurchase(
    { userId: 'user-a', stripeCheckoutSessionId: 'cs_test_1', packageId: 'pro', credits: 200, amount: 1500, currency: 'usd' },
    client
  )

  const insertCall = client.__calls.find((c: any) => c.op === 'insert')
  assert.equal(insertCall.payload.status, 'pending')
  assert.equal(insertCall.payload.user_id, 'user-a')
  assert.equal(insertCall.payload.credits, 200)
  assert.equal(insertCall.payload.amount, 1500)
})

test('getPurchaseByCheckoutSessionId looks up by the Stripe session id, not by user-suppliable fields', async () => {
  const row = { id: 'pur-1', stripe_checkout_session_id: 'cs_test_1' }
  const client = makeMockClient({ result: { data: row, error: null } })

  const result = await getPurchaseByCheckoutSessionId('cs_test_1', client)
  assert.deepEqual(result, row)
  const eqCall = client.__calls.find((c: any) => c.op === 'eq')
  assert.deepEqual(eqCall.payload, { column: 'stripe_checkout_session_id', value: 'cs_test_1' })
})

test('getPurchaseByCheckoutSessionId returns null for a nonexistent session — never throws for "not found"', async () => {
  const client = makeMockClient({ result: { data: null, error: null } })
  const result = await getPurchaseByCheckoutSessionId('cs_does_not_exist', client)
  assert.equal(result, null)
})

test('markPurchasePaid sets status "paid" and records Stripe identifiers, nothing else', async () => {
  const client = makeMockClient({ result: { data: null, error: null } })
  await markPurchasePaid(
    'pur-1',
    { stripePaymentIntentId: 'pi_1', stripeEventId: 'evt_1', stripeCustomerId: 'cus_1' },
    client
  )
  const updateCall = client.__calls.find((c: any) => c.op === 'update')
  assert.equal(updateCall.payload.status, 'paid')
  assert.equal(updateCall.payload.stripe_payment_intent_id, 'pi_1')
  assert.equal(updateCall.payload.stripe_event_id, 'evt_1')
  assert.ok(!('credits_remaining' in updateCall.payload), 'markPurchasePaid must never touch credits directly')
})

test('markPurchaseFailed / markPurchaseCancelled only ever set their own status — zero credit-related fields', async () => {
  const failedClient = makeMockClient({ result: { data: null, error: null } })
  await markPurchaseFailed('pur-1', failedClient)
  assert.deepEqual(failedClient.__calls.find((c: any) => c.op === 'update').payload, { status: 'failed' })

  const cancelledClient = makeMockClient({ result: { data: null, error: null } })
  await markPurchaseCancelled('pur-1', cancelledClient)
  assert.deepEqual(cancelledClient.__calls.find((c: any) => c.op === 'update').payload, { status: 'cancelled' })
})

// --- awardPurchaseCredits: the atomic, idempotent RPC call ---

test('awardPurchaseCredits calls the award_purchase_credits RPC with exactly purchaseId/userId/credits', async () => {
  const client = makeMockClient({ rpcResult: { data: [{ credits_remaining: 250, already_fulfilled: false }], error: null } })

  const result = await awardPurchaseCredits('pur-1', 'user-a', 200, client)

  const rpcCall = client.__calls.find((c: any) => c.op === 'rpc')
  assert.equal(rpcCall.table, 'award_purchase_credits')
  assert.deepEqual(rpcCall.payload, { p_purchase_id: 'pur-1', p_user_id: 'user-a', p_credits: 200 })
  assert.equal(result.creditsRemaining, 250)
  assert.equal(result.alreadyFulfilled, false)
})

test('awardPurchaseCredits reports alreadyFulfilled: true for a purchase the RPC found already fulfilled (idempotent replay) — C13-AC14/AC15', async () => {
  // Mirrors exactly what award_purchase_credits() returns when its own
  // `status <> 'fulfilled'` guard matches zero rows: credits_remaining is
  // null (nothing was credited this call) and already_fulfilled is true.
  const client = makeMockClient({ rpcResult: { data: [{ credits_remaining: null, already_fulfilled: true }], error: null } })

  const result = await awardPurchaseCredits('pur-1', 'user-a', 200, client)

  assert.equal(result.alreadyFulfilled, true)
  assert.equal(result.creditsRemaining, null)
})

test('awardPurchaseCredits handles a single-row (non-array) RPC response the same way as an array response', async () => {
  const client = makeMockClient({ rpcResult: { data: { credits_remaining: 50, already_fulfilled: false }, error: null } })
  const result = await awardPurchaseCredits('pur-1', 'user-a', 50, client)
  assert.equal(result.creditsRemaining, 50)
})

test('awardPurchaseCredits surfaces a Supabase/RPC error rather than swallowing it', async () => {
  const dbError = { message: 'function award_purchase_credits does not exist', code: '42883' }
  const client = makeMockClient({ rpcResult: { data: null, error: dbError } })
  await assert.rejects(() => awardPurchaseCredits('pur-1', 'user-a', 200, client), (err: any) => err === dbError)
})

test('awardPurchaseCredits never accepts a caller-supplied credit amount beyond the explicit `credits` parameter — the function signature has no separate "amount"/"price" field to spoof', async () => {
  const client = makeMockClient({ rpcResult: { data: [{ credits_remaining: 10, already_fulfilled: false }], error: null } })
  await awardPurchaseCredits('pur-1', 'user-a', 10, client)
  const rpcCall = client.__calls.find((c: any) => c.op === 'rpc')
  assert.deepEqual(Object.keys(rpcCall.payload).sort(), ['p_credits', 'p_purchase_id', 'p_user_id'])
})
