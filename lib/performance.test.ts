// Unit tests for lib/performance.ts. Milestone C15. Same mock-Supabase-
// client convention as lib/catalog.test.ts/lib/productHistory.test.ts.
//
// Final architecture correction: commitPerformanceImport no longer takes
// ImportResolution[] (a productId chosen per row): it takes
// CanonicalPerformanceRecord[] directly and looks up product_id
// opportunistically via getExternalIdMappings, leaving it null when no
// mapping exists. classifyImportRows/ImportResolution/isNewMapping are
// gone: there is no "matched/unmatched" gate on import anymore.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getExternalIdMappings,
  createExternalIdMapping,
  commitPerformanceImport,
  getProductPerformance,
  getMarketplacePerformanceHistory,
  getBrandsForMarketplace,
  getBrandScopesForMarketplace,
  getProductExternalIds,
  removeExternalIdMapping,
  setProductExternalId
} from './performance'
import type { CanonicalPerformanceRecord } from './performanceAdapters'

function record(overrides: Partial<CanonicalPerformanceRecord> = {}): CanonicalPerformanceRecord {
  return {
    marketplace: 'myntra',
    externalProductId: 'style-1',
    periodStart: '2026-08-01',
    periodEnd: '2026-08-07',
    periodType: 'weekly',
    impressions: 100,
    clicks: 5,
    addToCarts: 1,
    purchases: 1,
    revenue: null,
    returns: null,
    returnRate: 0,
    rating: null,
    considerationRate: null,
    conversionRate: 20,
    ctr: null,
    source: 'myntra_impress_report',
    metadata: null,
    ...overrides
  }
}

test('matching is strictly by (marketplace, external_id): never by name/brand/title/MRP (§7)', () => {
  const source = readFileSync(join(__dirname, 'performance.ts'), 'utf8')
  assert.ok(!/brand_name|brandName|title|mrp|Mrp|MRP/.test(source.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')))
})

// --- Mock client, mirroring lib/catalog.test.ts's pattern -------------------

function makeMockClient(opts: { userId: string | null; result?: { data: any; error: any } }) {
  const calls: { op: string; table?: string; payload?: any; options?: any; column?: string; value?: any }[] = []
  const builder: any = {
    select(columns?: any) {
      calls.push({ op: 'select', column: columns })
      return builder
    },
    eq(column: string, value: any) {
      calls.push({ op: 'eq', column, value })
      return builder
    },
    is(column: string, value: any) {
      calls.push({ op: 'is', column, value })
      return builder
    },
    not(column: string, operator: string, value: any) {
      calls.push({ op: 'not', column, value: [operator, value] })
      return builder
    },
    upsert(payload: any, options: any) {
      calls.push({ op: 'upsert', payload, options })
      return builder
    },
    insert(payload: any) {
      calls.push({ op: 'insert', payload })
      return builder
    },
    delete() {
      calls.push({ op: 'delete' })
      return builder
    },
    single() {
      return Promise.resolve(opts.result ?? { data: null, error: null })
    },
    order(column: string, options: any) {
      calls.push({ op: 'order', column, options })
      return builder
    },
    then(onFulfilled: any, onRejected?: any) {
      return Promise.resolve(opts.result ?? { data: [], error: null }).then(onFulfilled, onRejected)
    }
  }
  const client: any = {
    from(table: string) {
      calls.push({ op: 'from', table })
      return builder
    },
    auth: {
      getUser: () =>
        Promise.resolve(opts.userId ? { data: { user: { id: opts.userId } }, error: null } : { data: { user: null }, error: null })
    },
    __calls: calls
  }
  return client
}

// --- 23. Ownership protection -------------------------------------------------

test('23. getExternalIdMappings rejects for a guest (no session)', async () => {
  const client = makeMockClient({ userId: null })
  await assert.rejects(() => getExternalIdMappings('myntra', client))
})

test('23. createExternalIdMapping rejects for a guest (no session)', async () => {
  const client = makeMockClient({ userId: null })
  await assert.rejects(() => createExternalIdMapping('product-1', 'myntra', 'style-1', client))
})

test('23. commitPerformanceImport rejects for a guest (no session)', async () => {
  const client = makeMockClient({ userId: null })
  await assert.rejects(() => commitPerformanceImport('myntra', 'Acme Co', [record()], client))
})

test('23. getProductPerformance rejects for a guest (no session)', async () => {
  const client = makeMockClient({ userId: null })
  await assert.rejects(() => getProductPerformance('product-1', undefined, client))
})

test('23. owner_user_id is always derived from the session, never accepted as a caller-supplied parameter', async () => {
  const client = makeMockClient({
    userId: 'user-a',
    result: { data: [{ id: 'row-1', product_id: 'product-1', owner_user_id: 'user-a', marketplace: 'myntra', external_product_id: 'style-1' }], error: null }
  })
  await commitPerformanceImport('myntra', 'Acme Co', [record()], client)
  const insertCall = client.__calls.find((c: any) => c.op === 'insert')
  assert.equal(insertCall.payload[0].owner_user_id, 'user-a')
})

// --- 14. Historical snapshot preservation (append-only) -----------------------

test('14. commitPerformanceImport only ever INSERTs: it never calls .update() or .delete() on marketplace_performance', () => {
  const source = readFileSync(join(__dirname, 'performance.ts'), 'utf8')
  const start = source.indexOf('export async function commitPerformanceImport')
  const end = source.indexOf('\n// --- Reads', start)
  const body = source.slice(start, end)
  assert.ok(!/\.update\(/.test(body))
  assert.ok(!/\.delete\(/.test(body))
  assert.match(body, /\.insert\(payload\)/)
})

test('14. every row in one commit shares one import_batch_id: the historical-snapshot identity', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: [{ id: 'row-1' }], error: null } })
  await commitPerformanceImport('myntra', 'Acme Co', [record({ externalProductId: 'style-1' }), record({ externalProductId: 'style-2' })], client)
  const insertCall = client.__calls.find((c: any) => c.op === 'insert')
  assert.equal(insertCall.payload.length, 2)
  assert.equal(insertCall.payload[0].import_batch_id, insertCall.payload[1].import_batch_id)
  assert.ok(insertCall.payload[0].import_batch_id)
})

test('commitPerformanceImport rejects an empty record list rather than issuing a pointless empty insert', async () => {
  const client = makeMockClient({ userId: 'user-a' })
  await assert.rejects(() => commitPerformanceImport('myntra', 'Acme Co', [], client))
})

// --- Final architecture correction: import never requires/creates a match ---

test('commitPerformanceImport imports a row with NO existing mapping: product_id is null, never required, and the insert is never blocked by it', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: [], error: null } })
  await commitPerformanceImport('myntra', 'Acme Co', [record({ externalProductId: 'style-unlinked' })], client)
  const insertCall = client.__calls.find((c: any) => c.op === 'insert')
  assert.equal(insertCall.payload.length, 1)
  assert.equal(insertCall.payload[0].product_id, null)
})

test('commitPerformanceImport sets product_id opportunistically when an existing mapping is found: same (marketplace, external_id) lookup as before, just not a precondition anymore', async () => {
  const client = makeMockClient({
    userId: 'user-a',
    result: { data: [{ external_id: 'style-1', product_id: 'product-a' }], error: null }
  })
  await commitPerformanceImport('myntra', 'Acme Co', [record({ externalProductId: 'style-1' })], client)
  const insertCall = client.__calls.find((c: any) => c.op === 'insert')
  assert.equal(insertCall.payload[0].product_id, 'product-a')
})

test('commitPerformanceImport never writes to catalog_product_external_ids: it only reads (select) existing mappings, never creates one', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: [{ id: 'row-1' }], error: null } })
  await commitPerformanceImport('myntra', 'Acme Co', [record({ externalProductId: 'style-brand-new' })], client)
  assert.ok(!client.__calls.some((c: any) => c.op === 'upsert'), 'commit must never write a mapping: that is setProductExternalId\'s job, a separate optional action')
})

test('a report with a mix of linked and unlinked Style IDs imports ALL of them in one call: no per-row gate', async () => {
  const client = makeMockClient({
    userId: 'user-a',
    result: { data: [{ external_id: 'style-known', product_id: 'product-a' }], error: null }
  })
  await commitPerformanceImport(
    'myntra',
    'Acme Co',
    [record({ externalProductId: 'style-known' }), record({ externalProductId: 'style-unknown-1' }), record({ externalProductId: 'style-unknown-2' })],
    client
  )
  const insertCall = client.__calls.find((c: any) => c.op === 'insert')
  assert.equal(insertCall.payload.length, 3)
  assert.equal(insertCall.payload.find((p: any) => p.external_product_id === 'style-known').product_id, 'product-a')
  assert.equal(insertCall.payload.find((p: any) => p.external_product_id === 'style-unknown-1').product_id, null)
  assert.equal(insertCall.payload.find((p: any) => p.external_product_id === 'style-unknown-2').product_id, null)
})

test('zero-value metrics are preserved through commit: 0 is never coerced to null', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: [], error: null } })
  await commitPerformanceImport(
    'myntra',
    'Acme Co',
    [record({ impressions: 0, clicks: 0, addToCarts: 0, purchases: 0, returnRate: 0, considerationRate: 0, conversionRate: 0 })],
    client
  )
  const insertCall = client.__calls.find((c: any) => c.op === 'insert')
  const row = insertCall.payload[0]
  assert.equal(row.impressions, 0)
  assert.equal(row.clicks, 0)
  assert.equal(row.add_to_carts, 0)
  assert.equal(row.purchases, 0)
  assert.equal(row.return_rate, 0)
  assert.equal(row.consideration_rate, 0)
  assert.equal(row.conversion_rate, 0)
})

test('Brand/Article Type/Gender/Seller MRP/Inventory Age/RPLC pass through in metadata exactly as the caller supplied them: commit never recomputes or strips them', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: [], error: null } })
  const metadata = { brand: 'Acme Co', articleType: 'Category A', gender: 'Unisex', sellerId: '57985', sellerMrp: 5572, inventoryAge: 230, rplc: 2.664553 }
  await commitPerformanceImport('myntra', 'Acme Co', [record({ metadata })], client)
  const insertCall = client.__calls.find((c: any) => c.op === 'insert')
  assert.deepEqual(insertCall.payload[0].metadata, metadata)
})

// --- Brand/seller scoping (migration 20260810_14) ---------------------------
// Every uploaded report is scoped to (owner, brand, marketplace, period):
// two different brands' reports must never blend into one catalog's
// statistics, even for the same owner and marketplace. brand is derived
// by the CALLER from the report's own Brand column
// (lib/performanceAdapters.ts's groupRecordsByReportBrand): this layer's
// job is just to validate/store whatever it's handed, never to prompt
// for one.

test('commitPerformanceImport rejects an empty-string brand', async () => {
  const client = makeMockClient({ userId: 'user-a' })
  await assert.rejects(() => commitPerformanceImport('myntra', '', [record()], client))
})

test('commitPerformanceImport rejects a whitespace-only brand', async () => {
  const client = makeMockClient({ userId: 'user-a' })
  await assert.rejects(() => commitPerformanceImport('myntra', '   ', [record()], client))
})

test('commitPerformanceImport accepts brand: null (the "unspecified" scope, e.g. a report format with no Brand column) and stores null on every row, without rejecting', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: [], error: null } })
  await commitPerformanceImport('myntra', null, [record({ externalProductId: 'style-1' }), record({ externalProductId: 'style-2' })], client)
  const insertCall = client.__calls.find((c: any) => c.op === 'insert')
  assert.equal(insertCall.payload[0].brand, null)
  assert.equal(insertCall.payload[1].brand, null)
})

test('commitPerformanceImport trims the brand and stores it on every inserted row', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: [], error: null } })
  await commitPerformanceImport(
    'myntra',
    '  Acme Co  ',
    [record({ externalProductId: 'style-1' }), record({ externalProductId: 'style-2' })],
    client
  )
  const insertCall = client.__calls.find((c: any) => c.op === 'insert')
  assert.equal(insertCall.payload[0].brand, 'Acme Co')
  assert.equal(insertCall.payload[1].brand, 'Acme Co')
})

test('getMarketplacePerformanceHistory scopes by both marketplace and a named brand', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: [], error: null } })
  await getMarketplacePerformanceHistory('myntra', 'Acme Co', client)
  const eqCalls = client.__calls.filter((c: any) => c.op === 'eq')
  assert.deepEqual(eqCalls.map((c: any) => ({ column: c.column, value: c.value })), [
    { column: 'marketplace', value: 'myntra' },
    { column: 'brand', value: 'Acme Co' }
  ])
})

test('getMarketplacePerformanceHistory queries the "unspecified" (brand IS NULL) scope with .is(), not .eq(), when brand is null', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: [], error: null } })
  await getMarketplacePerformanceHistory('myntra', null, client)
  const isCall = client.__calls.find((c: any) => c.op === 'is')
  assert.deepEqual({ column: isCall.column, value: isCall.value }, { column: 'brand', value: null })
  assert.ok(!client.__calls.some((c: any) => c.op === 'eq' && c.column === 'brand'), 'must not .eq the brand column when querying the unspecified scope')
})

test('getBrandsForMarketplace rejects for a guest (no session)', async () => {
  const client = makeMockClient({ userId: null })
  await assert.rejects(() => getBrandsForMarketplace('myntra', client))
})

test('getBrandsForMarketplace excludes NULL brands and returns distinct, sorted named brands', async () => {
  const client = makeMockClient({
    userId: 'user-a',
    result: { data: [{ brand: 'Zeta Co' }, { brand: 'Acme Co' }, { brand: 'Acme Co' }], error: null }
  })
  const result = await getBrandsForMarketplace('myntra', client)
  assert.deepEqual(result, ['Acme Co', 'Zeta Co'])
  assert.ok(client.__calls.some((c: any) => c.op === 'not' && c.column === 'brand'), 'must exclude NULL brand rows from the named-brand list')
})

test('getBrandScopesForMarketplace rejects for a guest (no session)', async () => {
  const client = makeMockClient({ userId: null })
  await assert.rejects(() => getBrandScopesForMarketplace('myntra', client))
})

test('getBrandScopesForMarketplace surfaces the "unspecified" (brand IS NULL) scope as a real, selectable option when legacy rows exist: never silently hides pre-brand-scoping data', async () => {
  const client = makeMockClient({
    userId: 'user-a',
    result: { data: [{ brand: null }, { brand: 'Acme Co' }], error: null }
  })
  const result = await getBrandScopesForMarketplace('myntra', client)
  assert.deepEqual(result, [
    { brand: null, label: 'Unspecified brand (legacy import)' },
    { brand: 'Acme Co', label: 'Acme Co' }
  ])
})

test('getBrandScopesForMarketplace with only named brands: no unspecified entry', async () => {
  const client = makeMockClient({
    userId: 'user-a',
    result: { data: [{ brand: 'Zeta Co' }, { brand: 'Acme Co' }], error: null }
  })
  const result = await getBrandScopesForMarketplace('myntra', client)
  assert.deepEqual(result, [
    { brand: 'Acme Co', label: 'Acme Co' },
    { brand: 'Zeta Co', label: 'Zeta Co' }
  ])
})

// --- 24. Credit neutrality ----------------------------------------------------

test('24. lib/performance.ts never imports lib/credits.ts or touches user_credits/credit_transactions', () => {
  const source = readFileSync(join(__dirname, 'performance.ts'), 'utf8')
  assert.ok(!/lib\/credits/.test(source))
  assert.ok(!/user_credits/.test(source))
  assert.ok(!/credit_transactions/.test(source))
})

test('24. lib/performanceAdapters.ts, performanceMetrics.ts, performanceDiagnosis.ts, performanceRecommendations.ts, performanceIntelligence.ts, performanceNarrative.ts are all credit-neutral (no credits import anywhere in the C15 module set)', () => {
  for (const file of ['performanceAdapters.ts', 'performanceMetrics.ts', 'performanceDiagnosis.ts', 'performanceRecommendations.ts', 'performanceIntelligence.ts', 'performanceNarrative.ts']) {
    const source = readFileSync(join(__dirname, file), 'utf8')
    assert.ok(!/lib\/credits/.test(source), `${file} must not import lib/credits.ts`)
  }
})

// --- Reads: product-scoped, newest-first -------------------------------------

test('getProductPerformance orders newest period first', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: [], error: null } })
  await getProductPerformance('product-1', undefined, client)
  const orderCall = client.__calls.find((c: any) => c.op === 'order')
  assert.equal(orderCall.column, 'period_start')
  assert.deepEqual(orderCall.options, { ascending: false })
})

test('getProductPerformance scopes strictly to the given product_id', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: [], error: null } })
  await getProductPerformance('product-1', undefined, client)
  const eqCall = client.__calls.find((c: any) => c.op === 'eq')
  assert.deepEqual({ column: eqCall.column, value: eqCall.value }, { column: 'product_id', value: 'product-1' })
})

// --- Marketplace-wide history (Seller Performance Intelligence layer) ------
// Unlike getProductPerformance (scoped to one product_id), this is
// account-wide within one marketplace: every row, every product,
// including unlinked ones (product_id null). Powers lib/performanceIntelligence.ts.

test('getMarketplacePerformanceHistory rejects for a guest (no session)', async () => {
  const client = makeMockClient({ userId: null })
  await assert.rejects(() => getMarketplacePerformanceHistory('myntra', 'Acme Co', client))
})

test('getMarketplacePerformanceHistory scopes strictly to the given marketplace, never to a single product_id', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: [], error: null } })
  await getMarketplacePerformanceHistory('myntra', 'Acme Co', client)
  const eqCall = client.__calls.find((c: any) => c.op === 'eq')
  assert.deepEqual({ column: eqCall.column, value: eqCall.value }, { column: 'marketplace', value: 'myntra' })
  assert.ok(!client.__calls.some((c: any) => c.op === 'eq' && c.column === 'product_id'), 'must not filter by product_id: that would exclude unlinked rows')
})

test('getMarketplacePerformanceHistory orders newest period first', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: [], error: null } })
  await getMarketplacePerformanceHistory('myntra', 'Acme Co', client)
  const orderCall = client.__calls.find((c: any) => c.op === 'order')
  assert.equal(orderCall.column, 'period_start')
  assert.deepEqual(orderCall.options, { ascending: false })
})

test('getMarketplacePerformanceHistory includes rows with product_id null (unlinked): carries productId through on every returned record', async () => {
  const client = makeMockClient({
    userId: 'user-a',
    result: {
      data: [
        { product_id: null, marketplace: 'myntra', external_product_id: 'style-unlinked', period_start: '2026-08-08', period_end: '2026-08-14', period_type: 'weekly' },
        { product_id: 'product-a', marketplace: 'myntra', external_product_id: 'style-linked', period_start: '2026-08-08', period_end: '2026-08-14', period_type: 'weekly' }
      ],
      error: null
    }
  })
  const result = await getMarketplacePerformanceHistory('myntra', 'Acme Co', client)
  assert.equal(result.length, 2)
  assert.equal(result.find((r) => r.externalProductId === 'style-unlinked')?.productId, null)
  assert.equal(result.find((r) => r.externalProductId === 'style-linked')?.productId, 'product-a')
})

// --- Proactive marketplace-id fields (product-side, pre-import) -------------
// These write into the exact same catalog_product_external_ids table
// commitPerformanceImport reads from: same key, same table, just entered
// by a human ahead of time (or after the fact). This is the ONLY place a
// mapping is ever created: never derived from brand/category/price, and
// never a precondition for importing a report.

test('getProductExternalIds rejects for a guest (no session)', async () => {
  const client = makeMockClient({ userId: null })
  await assert.rejects(() => getProductExternalIds('product-1', client))
})

test('getProductExternalIds scopes strictly to the given product_id and returns a marketplace -> external_id map', async () => {
  const client = makeMockClient({
    userId: 'user-a',
    result: { data: [{ marketplace: 'myntra', external_id: 'style-99' }], error: null }
  })
  const result = await getProductExternalIds('product-1', client)
  const eqCall = client.__calls.find((c: any) => c.op === 'eq')
  assert.deepEqual({ column: eqCall.column, value: eqCall.value }, { column: 'product_id', value: 'product-1' })
  assert.equal(result.get('myntra'), 'style-99')
})

test('removeExternalIdMapping rejects for a guest (no session)', async () => {
  const client = makeMockClient({ userId: null })
  await assert.rejects(() => removeExternalIdMapping('product-1', 'myntra', client))
})

test('removeExternalIdMapping issues a delete scoped to both product_id and marketplace', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: null, error: null } })
  await removeExternalIdMapping('product-1', 'myntra', client)
  const deleteCall = client.__calls.find((c: any) => c.op === 'delete')
  assert.ok(deleteCall, 'expected a .delete() call')
  const eqCalls = client.__calls.filter((c: any) => c.op === 'eq')
  assert.deepEqual(eqCalls.map((c: any) => c.column), ['product_id', 'marketplace'])
  assert.deepEqual(eqCalls.map((c: any) => c.value), ['product-1', 'myntra'])
})

test('setProductExternalId rejects an empty/whitespace-only id without issuing any write', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: [], error: null } })
  await assert.rejects(() => setProductExternalId('product-1', 'myntra', '   ', client))
  assert.ok(!client.__calls.some((c: any) => c.op === 'upsert' || c.op === 'delete'))
})

test('setProductExternalId with no prior mapping: upserts the new id and never calls delete', async () => {
  const client = makeMockClient({ userId: 'user-a', result: { data: [], error: null } })
  await setProductExternalId('product-1', 'myntra', 'style-new', client)
  assert.ok(!client.__calls.some((c: any) => c.op === 'delete'))
  const upsertCall = client.__calls.find((c: any) => c.op === 'upsert')
  assert.equal(upsertCall.payload.external_id, 'style-new')
  assert.equal(upsertCall.payload.product_id, 'product-1')
})

test('setProductExternalId when the product already has a DIFFERENT id for that marketplace: removes the stale mapping before upserting the new one', async () => {
  const client = makeMockClient({
    userId: 'user-a',
    result: { data: [{ marketplace: 'myntra', external_id: 'style-old' }], error: null }
  })
  await setProductExternalId('product-1', 'myntra', 'style-new', client)
  const deleteIdx = client.__calls.findIndex((c: any) => c.op === 'delete')
  const upsertIdx = client.__calls.findIndex((c: any) => c.op === 'upsert')
  assert.ok(deleteIdx !== -1 && upsertIdx !== -1 && deleteIdx < upsertIdx)
  const upsertCall = client.__calls.find((c: any) => c.op === 'upsert')
  assert.equal(upsertCall.payload.external_id, 'style-new')
})

test('setProductExternalId re-saving the SAME id it already has: does not call delete', async () => {
  const client = makeMockClient({
    userId: 'user-a',
    result: { data: [{ marketplace: 'myntra', external_id: 'style-same' }], error: null }
  })
  await setProductExternalId('product-1', 'myntra', 'style-same', client)
  assert.ok(!client.__calls.some((c: any) => c.op === 'delete'))
})
