// Unit tests for lib/catalog.ts, using Node's built-in test runner (no new
// dependency — tsx is already a project devDependency).
// Run with: npx tsx --test lib/catalog.test.ts
//
// The repository has no existing test framework/config (verified before
// writing this — no jest/vitest, no *.test.* files anywhere else), so this
// intentionally introduces nothing beyond what's already installed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProduct, upsertListing, setApproval, recordExport, getCatalog, getExportHistory, getProductById, setProductIntelligence, deleteProduct } from './catalog'
import { buildCompletedIntelligence, PRODUCT_INTELLIGENCE_FIELD_KEYS } from './productIntelligence'

// Minimal fake of the subset of the Supabase client's fluent query builder
// these functions actually call. Records every call so tests can assert on
// the exact payload sent, not just the final resolved value.
function makeMockClient(opts: { userId: string | null; result?: { data: any; error: any } }) {
  const calls: { table?: string; op: string; payload?: any; options?: any }[] = []

  const builder: any = {
    insert(payload: any) {
      calls.push({ op: 'insert', payload })
      return builder
    },
    upsert(payload: any, options: any) {
      calls.push({ op: 'upsert', payload, options })
      return builder
    },
    select(columns?: any) {
      calls.push({ op: 'select', payload: columns })
      return builder
    },
    single() {
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
          opts.userId
            ? { data: { user: { id: opts.userId } }, error: null }
            : { data: { user: null }, error: null }
        )
    },
    __calls: calls
  }

  return client
}

test('createProduct maps fields correctly and derives owner_user_id from the session', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: { id: 'product-1' }, error: null } })

  const id = await createProduct(
    { brand_name: 'Acme', description: 'desc', category: 'cat', image_url: 'https://x/y.jpg', client_id: 'client-1' },
    client
  )

  assert.equal(id, 'product-1')
  const insertCall = client.__calls.find((c: any) => c.op === 'insert')
  assert.deepEqual(insertCall.payload, {
    owner_user_id: 'user-a',
    brand_name: 'Acme',
    description: 'desc',
    category: 'cat',
    image_url: 'https://x/y.jpg',
    // Milestone C17.1 — defaults to [] when the caller omits image_urls.
    image_urls: [],
    client_id: 'client-1'
  })
})

test('createProduct defaults client_id to null when omitted', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: { id: 'product-2' }, error: null } })

  await createProduct({ brand_name: 'Acme', description: null, category: null, image_url: null }, client)

  const insertCall = client.__calls.find((c: any) => c.op === 'insert')
  assert.equal(insertCall.payload.client_id, null)
})

test('upsertListing maps fields correctly and upserts on (product_id, marketplace)', async () => {
  const row = { id: 'listing-1', product_id: 'product-1', owner_user_id: 'user-a', marketplace: 'amazon' }
  const client = makeMockClient({ userId: 'user-a', result: { data: row, error: null } })

  const result = await upsertListing(
    'product-1',
    'amazon',
    { shaped_content: { title: 't' }, generation_meta: null, generation_error: null },
    client
  )

  assert.deepEqual(result, row)
  const upsertCall = client.__calls.find((c: any) => c.op === 'upsert')
  assert.deepEqual(upsertCall.payload, {
    product_id: 'product-1',
    owner_user_id: 'user-a',
    marketplace: 'amazon',
    shaped_content: { title: 't' },
    generation_meta: null,
    generation_error: null
  })
  assert.deepEqual(upsertCall.options, { onConflict: 'product_id,marketplace' })
})

test('setApproval derives approved_by from the authenticated session, not caller input', async () => {
  const row = { id: 'approval-1', listing_id: 'listing-1', approved: true, approved_by: 'user-a' }
  const client = makeMockClient({ userId: 'user-a', result: { data: row, error: null } })

  await setApproval('listing-1', true, client)

  const upsertCall = client.__calls.find((c: any) => c.op === 'upsert')
  assert.equal(upsertCall.payload.approved_by, 'user-a')
  assert.equal(upsertCall.payload.owner_user_id, 'user-a')
  assert.equal(upsertCall.payload.approved, true)
  assert.equal(typeof upsertCall.payload.approved_at, 'string')
  assert.deepEqual(upsertCall.options, { onConflict: 'listing_id' })
})

test('recordExport derives item_count from listingIds.length, not a caller-supplied count', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: { id: 'export-1' }, error: null } })

  await recordExport('flipkart', ['l1', 'l2', 'l3'], 'flipkart-listings.csv', client)

  const insertCall = client.__calls.find((c: any) => c.op === 'insert')
  assert.equal(insertCall.payload.item_count, 3)
  assert.deepEqual(insertCall.payload.listing_ids, ['l1', 'l2', 'l3'])
  assert.equal(insertCall.payload.owner_user_id, 'user-a')
})

test('all five functions reject when there is no authenticated session', async () => {
  const client = makeMockClient({ userId: null })

  await assert.rejects(() => createProduct({ brand_name: null, description: null, category: null, image_url: null }, client))
  await assert.rejects(() =>
    upsertListing('product-1', 'amazon', { shaped_content: null, generation_meta: null, generation_error: null }, client)
  )
  await assert.rejects(() => setApproval('listing-1', true, client))
  await assert.rejects(() => recordExport('amazon', [], null, client))
  await assert.rejects(() => getCatalog(client))
})

test('Supabase errors are surfaced, not swallowed', async () => {
  const dbError = { message: 'unique constraint violation', code: '23505' }
  const client = makeMockClient({ userId: 'user-a', result: { data: null, error: dbError } })

  await assert.rejects(
    () => createProduct({ brand_name: null, description: null, category: null, image_url: null }, client),
    (err: any) => err === dbError
  )
})

// getCatalog's usage pattern (from(table).select('*') awaited directly, no
// .single()/.upsert()) doesn't fit makeMockClient's chain above, so it gets
// its own small mock.
function makeGetCatalogMockClient(opts: {
  userId: string | null
  productsResult?: { data: any; error: any }
  listingsResult?: { data: any; error: any }
  approvalsResult?: { data: any; error: any }
}) {
  const results: Record<string, { data: any; error: any }> = {
    catalog_products: opts.productsResult ?? { data: [], error: null },
    catalog_listings: opts.listingsResult ?? { data: [], error: null },
    catalog_listing_approvals: opts.approvalsResult ?? { data: [], error: null }
  }
  return {
    from(table: string) {
      return { select: () => Promise.resolve(results[table] ?? { data: [], error: null }) }
    },
    auth: {
      getUser: () =>
        Promise.resolve(
          opts.userId ? { data: { user: { id: opts.userId } }, error: null } : { data: { user: null }, error: null }
        )
    }
  } as any
}

test('getCatalog fetches all three tables and returns them typed, with no owner filter (RLS-only)', async () => {
  const products = [{ id: 'p1', owner_user_id: 'user-a', client_id: null, brand_name: 'X' }]
  const listings = [{ id: 'l1', product_id: 'p1', marketplace: 'amazon', shaped_content: { title: 't' } }]
  const approvals = [{ id: 'a1', listing_id: 'l1', approved: true }]
  const client = makeGetCatalogMockClient({
    userId: 'user-a',
    productsResult: { data: products, error: null },
    listingsResult: { data: listings, error: null },
    approvalsResult: { data: approvals, error: null }
  })

  const result = await getCatalog(client)

  assert.deepEqual(result.products, products)
  assert.deepEqual(result.listings, listings)
  assert.deepEqual(result.approvals, approvals)
})

test('getCatalog surfaces an error from any of the three tables', async () => {
  const dbError = { message: 'permission denied', code: '42501' }
  const client = makeGetCatalogMockClient({ userId: 'user-a', listingsResult: { data: null, error: dbError } })

  await assert.rejects(() => getCatalog(client), (err: any) => err === dbError)
})

test('getCatalog returns empty arrays, not null/undefined, when a table has no rows', async () => {
  const client = makeGetCatalogMockClient({ userId: 'user-a' })
  const result = await getCatalog(client)
  assert.deepEqual(result, { products: [], listings: [], approvals: [] })
})

// Milestone 29 (C7) — getExportHistory's own mock: select().order() awaited
// directly (no .single()/.upsert()), so it doesn't fit makeMockClient's
// chain above either, same reasoning as makeGetCatalogMockClient.
function makeExportHistoryMockClient(opts: { userId: string | null; result?: { data: any; error: any } }) {
  const calls: { op: string; payload?: any }[] = []
  return {
    from(table: string) {
      calls.push({ op: 'from', payload: table })
      return {
        select(columns?: any) {
          calls.push({ op: 'select', payload: columns })
          return {
            order(column: string, options: any) {
              calls.push({ op: 'order', payload: { column, options } })
              return Promise.resolve(opts.result ?? { data: [], error: null })
            }
          }
        }
      }
    },
    auth: {
      getUser: () =>
        Promise.resolve(
          opts.userId ? { data: { user: { id: opts.userId } }, error: null } : { data: { user: null }, error: null }
        )
    },
    __calls: calls
  } as any
}

test('getExportHistory derives ownership from the authenticated session, not a caller-supplied id', async () => {
  const rows = [{ id: 'export-1', owner_user_id: 'user-a', marketplace: 'amazon', item_count: 2 }]
  const client = makeExportHistoryMockClient({ userId: 'user-a', result: { data: rows, error: null } })

  // getExportHistory takes no user/owner parameter at all — the only way it
  // can know "whose" history to read is the session on the client passed in.
  const result = await getExportHistory(client)

  assert.deepEqual(result, rows)
})

test('getExportHistory returns rows with the fields the UI needs (marketplace, item_count, file_name, created_at)', async () => {
  const row = {
    id: 'export-1',
    owner_user_id: 'user-a',
    marketplace: 'flipkart',
    listing_ids: ['l1', 'l2'],
    item_count: 2,
    file_name: 'flipkart-listings.csv',
    created_at: '2026-08-10T12:00:00.000Z'
  }
  const client = makeExportHistoryMockClient({ userId: 'user-a', result: { data: [row], error: null } })

  const [result] = await getExportHistory(client)

  assert.equal(result.marketplace, 'flipkart')
  assert.equal(result.item_count, 2)
  assert.equal(result.file_name, 'flipkart-listings.csv')
  assert.equal(result.created_at, '2026-08-10T12:00:00.000Z')
})

test('getExportHistory returns an empty array, not null/undefined, when the user has no exports', async () => {
  const client = makeExportHistoryMockClient({ userId: 'user-a', result: { data: null, error: null } })
  const result = await getExportHistory(client)
  assert.deepEqual(result, [])
})

test('getExportHistory rejects when there is no authenticated session (guest)', async () => {
  const client = makeExportHistoryMockClient({ userId: null })
  await assert.rejects(() => getExportHistory(client))
})

test('getExportHistory surfaces a Supabase error rather than swallowing it', async () => {
  const dbError = { message: 'permission denied', code: '42501' }
  const client = makeExportHistoryMockClient({ userId: 'user-a', result: { data: null, error: dbError } })
  await assert.rejects(() => getExportHistory(client), (err: any) => err === dbError)
})

// Milestone 32 (C9) — getProductById's mock: select().eq().maybeSingle().
function makeProductByIdMockClient(opts: { userId: string | null; result?: { data: any; error: any } }) {
  return {
    from(_table: string) {
      return {
        select(_columns?: any) {
          return {
            eq(_column: string, _value: any) {
              return {
                maybeSingle() {
                  return Promise.resolve(opts.result ?? { data: null, error: null })
                }
              }
            }
          }
        }
      }
    },
    auth: {
      getUser: () =>
        Promise.resolve(
          opts.userId ? { data: { user: { id: opts.userId } }, error: null } : { data: { user: null }, error: null }
        )
    }
  } as any
}

test('getProductById returns the row when it exists and is owned (RLS-scoped)', async () => {
  const row = { id: 'product-1', owner_user_id: 'user-a', brand_name: 'Acme', product_intelligence: null }
  const client = makeProductByIdMockClient({ userId: 'user-a', result: { data: row, error: null } })

  const result = await getProductById('product-1', client)
  assert.deepEqual(result, row)
})

test('getProductById returns null for a product that does not exist or is not owned — RLS makes these indistinguishable, which is the point', async () => {
  const client = makeProductByIdMockClient({ userId: 'user-a', result: { data: null, error: null } })
  const result = await getProductById('someone-elses-product', client)
  assert.equal(result, null)
})

test('getProductById rejects when there is no authenticated session', async () => {
  const client = makeProductByIdMockClient({ userId: null })
  await assert.rejects(() => getProductById('product-1', client))
})

// Milestone 32 (C9) — setProductIntelligence's mock: update().eq().select().single().
function makeSetIntelligenceMockClient(opts: { userId: string | null; result?: { data: any; error: any } }) {
  const calls: { op: string; payload?: any }[] = []
  return {
    from(_table: string) {
      return {
        update(payload: any) {
          calls.push({ op: 'update', payload })
          return {
            eq(_column: string, value: any) {
              calls.push({ op: 'eq', payload: value })
              return {
                select() {
                  return {
                    single() {
                      return Promise.resolve(opts.result ?? { data: null, error: null })
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    auth: {
      getUser: () =>
        Promise.resolve(
          opts.userId ? { data: { user: { id: opts.userId } }, error: null } : { data: { user: null }, error: null }
        )
    },
    __calls: calls
  } as any
}

function fullIntelligenceData() {
  const data: Record<string, any> = {}
  for (const key of PRODUCT_INTELLIGENCE_FIELD_KEYS) data[key] = { value: 'x', confidence: 'high' }
  return data as any
}

test('setProductIntelligence updates exactly product_intelligence, targeting the given product id, never a caller-supplied owner', async () => {
  const intelligence = buildCompletedIntelligence(fullIntelligenceData(), [])
  const row = { id: 'product-1', owner_user_id: 'user-a', product_intelligence: intelligence }
  const client = makeSetIntelligenceMockClient({ userId: 'user-a', result: { data: row, error: null } })

  const result = await setProductIntelligence('product-1', intelligence, client)

  assert.deepEqual(result, row)
  const updateCall = client.__calls.find((c: any) => c.op === 'update')
  assert.deepEqual(updateCall.payload, { product_intelligence: intelligence })
  assert.deepEqual(Object.keys(updateCall.payload), ['product_intelligence']) // never owner_user_id
  const eqCall = client.__calls.find((c: any) => c.op === 'eq')
  assert.equal(eqCall.payload, 'product-1')
})

test('setProductIntelligence rejects when there is no authenticated session', async () => {
  const client = makeSetIntelligenceMockClient({ userId: null })
  await assert.rejects(() => setProductIntelligence('product-1', buildCompletedIntelligence(fullIntelligenceData(), []), client))
})

test('setProductIntelligence surfaces a Supabase error (e.g. RLS rejecting an unowned product) rather than swallowing it', async () => {
  const dbError = { message: 'no rows returned', code: 'PGRST116' }
  const client = makeSetIntelligenceMockClient({ userId: 'user-a', result: { data: null, error: dbError } })
  await assert.rejects(
    () => setProductIntelligence('not-mine', buildCompletedIntelligence(fullIntelligenceData(), []), client),
    (err: any) => err === dbError
  )
})

// Milestone C17 — regression coverage for the confirmed delete-doesn't-persist
// bug: deleteProduct's mock: delete().eq().select() awaited directly (no
// .single()), matching the real .select('id') call that turns "RLS matched
// zero rows" into a real thrown error instead of a silent no-op.
function makeDeleteProductMockClient(opts: { userId: string | null; result?: { data: any; error: any } }) {
  const calls: { op: string; payload?: any }[] = []
  return {
    from(table: string) {
      calls.push({ op: 'from', payload: table })
      return {
        delete() {
          calls.push({ op: 'delete' })
          return {
            eq(column: string, value: any) {
              calls.push({ op: 'eq', payload: { column, value } })
              return {
                select(columns?: any) {
                  calls.push({ op: 'select', payload: columns })
                  return Promise.resolve(opts.result ?? { data: [], error: null })
                }
              }
            }
          }
        }
      }
    },
    auth: {
      getUser: () =>
        Promise.resolve(
          opts.userId ? { data: { user: { id: opts.userId } }, error: null } : { data: { user: null }, error: null }
        )
    },
    __calls: calls
  } as any
}

test('deleteProduct issues a real DELETE against catalog_products, filtered by the given id', async () => {
  const client = makeDeleteProductMockClient({ userId: 'user-a', result: { data: [{ id: 'product-1' }], error: null } })

  await deleteProduct('product-1', client)

  const fromCall = client.__calls.find((c: any) => c.op === 'from')
  assert.equal(fromCall.payload, 'catalog_products')
  assert.ok(client.__calls.some((c: any) => c.op === 'delete'))
  const eqCall = client.__calls.find((c: any) => c.op === 'eq')
  assert.deepEqual(eqCall.payload, { column: 'id', value: 'product-1' })
})

test('deleteProduct throws when the delete affects zero rows (product not found, or not owned by this session) — never a silent no-op', async () => {
  const client = makeDeleteProductMockClient({ userId: 'user-a', result: { data: [], error: null } })
  await assert.rejects(() => deleteProduct('someone-elses-product', client))
})

test('deleteProduct surfaces a genuine Supabase error rather than swallowing it', async () => {
  const dbError = { message: 'permission denied', code: '42501' }
  const client = makeDeleteProductMockClient({ userId: 'user-a', result: { data: null, error: dbError } })
  await assert.rejects(() => deleteProduct('product-1', client), (err: any) => err === dbError)
})

test('deleteProduct rejects when there is no authenticated session (guest) — never attempts an unauthenticated delete', async () => {
  const client = makeDeleteProductMockClient({ userId: null })
  await assert.rejects(() => deleteProduct('product-1', client))
})
