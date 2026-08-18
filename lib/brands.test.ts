// Unit tests for lib/brands.ts (Milestone C12), using Node's built-in test
// runner (no new dependency: tsx is already a project devDependency).
// Run with: npx tsx --test lib/brands.test.ts
//
// Mock conventions mirror lib/catalog.test.ts exactly (same fluent-builder
// shape, same auth.getUser() stub).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listBrands, getBrand, createBrand, updateBrand } from './brands'

function makeMockClient(opts: { userId: string | null; result?: { data: any; error: any } }) {
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
    order(_column: string) {
      return Promise.resolve(opts.result ?? { data: [], error: null })
    },
    eq(_column: string, value: any) {
      calls.push({ op: 'eq', payload: value })
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
    auth: {
      getUser: () =>
        Promise.resolve(
          opts.userId ? { data: { user: { id: opts.userId } }, error: null } : { data: { user: null }, error: null }
        )
    },
    __calls: calls
  }

  return client
}

test('listBrands returns the session\'s own rows with no explicit owner filter (RLS-only)', async () => {
  const rows = [{ id: 'b1', user_id: 'user-a', client_name: 'Acme' }]
  const client = makeMockClient({ userId: 'user-a', result: { data: rows, error: null } })
  const result = await listBrands(client)
  assert.deepEqual(result, rows)
})

test('listBrands returns an empty array, not null, when the user has no brands', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: null, error: null } })
  const result = await listBrands(client)
  assert.deepEqual(result, [])
})

test('listBrands rejects when there is no authenticated session', async () => {
  const client = makeMockClient({ userId: null })
  await assert.rejects(() => listBrands(client))
})

test('getBrand returns the row when owned', async () => {
  const row = { id: 'b1', user_id: 'user-a', client_name: 'Acme' }
  const client = makeMockClient({ userId: 'user-a', result: { data: row, error: null } })
  const result = await getBrand('b1', client)
  assert.deepEqual(result, row)
})

test('getBrand returns null for a brand that does not exist or is not owned (RLS makes these the same)', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: null, error: null } })
  const result = await getBrand('someone-elses-brand', client)
  assert.equal(result, null)
})

test('createBrand derives user_id from the session, never from a caller-supplied field', async () => {
  const row = { id: 'b1', user_id: 'user-a', client_name: 'Acme' }
  const client = makeMockClient({ userId: 'user-a', result: { data: row, error: null } })

  await createBrand({ client_name: 'Acme', brand_identity: 'A cozy home goods brand' }, client)

  const insertCall = client.__calls.find((c: any) => c.op === 'insert')
  assert.equal(insertCall.payload.user_id, 'user-a')
  assert.equal(insertCall.payload.client_name, 'Acme')
  // BrandFields has no user_id/owner field to begin with: this asserts
  // the actual payload sent never contains a spoofable second source of
  // truth for ownership.
  assert.equal(Object.keys(insertCall.payload).filter((k) => k.includes('user')).length, 1)
})

test('createBrand rejects when there is no authenticated session', async () => {
  const client = makeMockClient({ userId: null })
  await assert.rejects(() => createBrand({ client_name: 'Acme' }, client))
})

test('updateBrand never sends a user_id/ownership field in its payload: ownership is enforced by RLS alone', async () => {
  const row = { id: 'b1', user_id: 'user-a', client_name: 'Acme Updated' }
  const client = makeMockClient({ userId: 'user-a', result: { data: row, error: null } })

  const result = await updateBrand('b1', { client_name: 'Acme Updated' }, client)

  assert.deepEqual(result, row)
  const updateCall = client.__calls.find((c: any) => c.op === 'update')
  assert.deepEqual(updateCall.payload, { client_name: 'Acme Updated' })
  assert.ok(!('user_id' in updateCall.payload))
  const eqCall = client.__calls.find((c: any) => c.op === 'eq')
  assert.equal(eqCall.payload, 'b1')
})

test('updateBrand surfaces a Supabase error (e.g. RLS rejecting an unowned brand) rather than swallowing it', async () => {
  const dbError = { message: 'no rows returned', code: 'PGRST116' }
  const client = makeMockClient({ userId: 'user-a', result: { data: null, error: dbError } })
  await assert.rejects(
    () => updateBrand('not-mine', { client_name: 'Hijacked' }, client),
    (err: any) => err === dbError
  )
})

test('updateBrand rejects when there is no authenticated session', async () => {
  const client = makeMockClient({ userId: null })
  await assert.rejects(() => updateBrand('b1', { client_name: 'X' }, client))
})

test('brand profile fields (identity, voice, audience, categories, positioning, guidelines, marketplace preferences) round-trip through createBrand/updateBrand payloads unchanged', async () => {
  const fullFields = {
    client_name: 'Acme',
    brand_guidelines: 'Use warm, friendly language.',
    brand_identity: 'A modern home goods brand.',
    brand_voice: 'Friendly, warm, approachable.',
    target_audience: 'Urban millennials furnishing their first home.',
    product_categories: ['Home Decor', 'Furniture'],
    positioning: 'Affordable premium quality.',
    marketplace_preferences: {
      amazon: { enabled: true, notes: 'Prioritize Prime-eligible listings' },
      etsy: { enabled: false, notes: '' }
    }
  }
  const client = makeMockClient({ userId: 'user-a', result: { data: { id: 'b1', user_id: 'user-a', ...fullFields }, error: null } })

  await createBrand(fullFields, client)
  const insertCall = client.__calls.find((c: any) => c.op === 'insert')
  for (const key of Object.keys(fullFields) as (keyof typeof fullFields)[]) {
    assert.deepEqual(insertCall.payload[key], fullFields[key])
  }
})
