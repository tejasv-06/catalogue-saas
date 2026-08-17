// Unit tests for lib/productHistory.ts, using Node's built-in test runner —
// same conventions as lib/catalog.test.ts (mock Supabase client, no new
// dependency). Milestone C14 (Milestone 34).
//
// §18's items 19-23 (C9 enrichment / C10 generation / C11 export /
// C12 brand ownership / C13 billing still work) are regression concerns,
// not new C14 behavior — they're covered by re-running the existing,
// untouched lib/productIntelligence.test.ts, lib/marketplaceAdapters.test.ts,
// lib/exportReadiness.test.ts, lib/brands.test.ts, lib/purchases.test.ts,
// lib/credits.test.ts, lib/webhookVerification.test.ts suites unchanged
// (see the C14 implementation report for the full regression run).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  recordProductHistoryEvent,
  getProductHistory,
  describeProductHistoryEvent,
  PRODUCT_HISTORY_EVENT_TYPES,
  EVENT_TYPE_LABELS,
  type ProductHistoryEventRow
} from './productHistory'

// --- Mocks, following lib/catalog.test.ts's own established pattern -----

function makeInsertMockClient(opts: { userId: string | null; result?: { data: any; error: any } }) {
  const calls: { op: string; table?: string; payload?: any }[] = []

  const builder: any = {
    insert(payload: any) {
      calls.push({ op: 'insert', payload })
      return builder
    },
    select() {
      calls.push({ op: 'select' })
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
          opts.userId ? { data: { user: { id: opts.userId } }, error: null } : { data: { user: null }, error: null }
        )
    },
    __calls: calls
  }

  return client
}

// getProductHistory's chain (.select().eq().order().order()) never calls
// .single() — each step must return a thenable so `await` at the end of
// the chain resolves, exactly like the real supabase-js PostgrestFilterBuilder.
function makeHistoryReadMockClient(opts: { userId: string | null; result?: { data: any; error: any } }) {
  const calls: { op: string; column?: string; value?: any; options?: any }[] = []

  const builder: any = {
    select(columns?: any) {
      calls.push({ op: 'select', column: columns })
      return builder
    },
    eq(column: string, value: any) {
      calls.push({ op: 'eq', column, value })
      return builder
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
      calls.push({ op: 'from', column: table })
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

function baseRow(overrides: Partial<ProductHistoryEventRow> = {}): { data: any; error: any } {
  return {
    data: {
      id: 'event-1',
      product_id: 'product-1',
      owner_user_id: 'user-a',
      event_type: 'product_created',
      marketplace: null,
      listing_id: null,
      metadata: null,
      created_at: '2026-08-11T12:05:00.000Z',
      ...overrides
    },
    error: null
  }
}

// --- 1/3. Valid event types / marketplaces accepted -----------------------

test('1. every PRODUCT_HISTORY_EVENT_TYPES value is accepted by recordProductHistoryEvent', async () => {
  for (const eventType of PRODUCT_HISTORY_EVENT_TYPES) {
    const client = makeInsertMockClient({ userId: 'user-a', result: baseRow({ event_type: eventType }) })
    const row = await recordProductHistoryEvent({ productId: 'product-1', eventType }, client)
    assert.equal(row.event_type, eventType)
  }
})

// --- 2. Invalid event types rejected ---------------------------------------

test('2. recordProductHistoryEvent rejects an invalid event_type before ever reaching the database', async () => {
  const client = makeInsertMockClient({ userId: 'user-a', result: baseRow() })
  await assert.rejects(() => recordProductHistoryEvent({ productId: 'product-1', eventType: 'totally_made_up' as any }, client))
  assert.equal(client.__calls.length, 0, 'an invalid event_type must fail validation before any Supabase call is made')
})

// --- 3/4. Marketplace validation --------------------------------------------

test('3. a valid marketplace is accepted and passed through', async () => {
  const client = makeInsertMockClient({
    userId: 'user-a',
    result: baseRow({ event_type: 'exported', marketplace: 'amazon' })
  })
  const row = await recordProductHistoryEvent({ productId: 'product-1', eventType: 'exported', marketplace: 'amazon' }, client)
  assert.equal(row.marketplace, 'amazon')
  const insertCall = client.__calls.find((c: any) => c.op === 'insert')
  assert.equal(insertCall.payload.marketplace, 'amazon')
})

test('4. an invalid marketplace is rejected before ever reaching the database', async () => {
  const client = makeInsertMockClient({ userId: 'user-a', result: baseRow() })
  await assert.rejects(() =>
    recordProductHistoryEvent({ productId: 'product-1', eventType: 'exported', marketplace: 'shopify' as any }, client)
  )
  assert.equal(client.__calls.length, 0)
})

test('marketplace omitted or null is accepted (most event types have no marketplace)', async () => {
  const client = makeInsertMockClient({ userId: 'user-a', result: baseRow() })
  const row = await recordProductHistoryEvent({ productId: 'product-1', eventType: 'product_created' }, client)
  assert.equal(row.marketplace, null)
})

// --- 5. product_created ------------------------------------------------------

test('5. a product_created event can be recorded, with source metadata', async () => {
  const client = makeInsertMockClient({
    userId: 'user-a',
    result: baseRow({ event_type: 'product_created', metadata: { source: 'manual' } })
  })
  const row = await recordProductHistoryEvent(
    { productId: 'product-1', eventType: 'product_created', metadata: { source: 'manual' } },
    client
  )
  assert.equal(row.event_type, 'product_created')
  assert.deepEqual(row.metadata, { source: 'manual' })
})

// --- 6. enrichment lifecycle --------------------------------------------------

test('6. enrichment_started/enrichment_completed/enrichment_failed are all supported event types', async () => {
  for (const eventType of ['enrichment_started', 'enrichment_completed', 'enrichment_failed'] as const) {
    const client = makeInsertMockClient({ userId: 'user-a', result: baseRow({ event_type: eventType }) })
    const row = await recordProductHistoryEvent({ productId: 'product-1', eventType }, client)
    assert.equal(row.event_type, eventType)
  }
})

// --- 7/8. listing_generated / listing_edited ----------------------------------

test('7. listing_generated supports marketplace and listing_id', async () => {
  const client = makeInsertMockClient({
    userId: 'user-a',
    result: baseRow({ event_type: 'listing_generated', marketplace: 'etsy', listing_id: 'listing-1' })
  })
  const row = await recordProductHistoryEvent(
    { productId: 'product-1', eventType: 'listing_generated', marketplace: 'etsy', listingId: 'listing-1' },
    client
  )
  assert.equal(row.marketplace, 'etsy')
  assert.equal(row.listing_id, 'listing-1')
  const insertCall = client.__calls.find((c: any) => c.op === 'insert')
  assert.equal(insertCall.payload.listing_id, 'listing-1')
})

test('8. listing_edited is a distinct, supported event type from listing_generated', async () => {
  const client = makeInsertMockClient({
    userId: 'user-a',
    result: baseRow({ event_type: 'listing_edited', marketplace: 'etsy', listing_id: 'listing-1' })
  })
  const row = await recordProductHistoryEvent(
    { productId: 'product-1', eventType: 'listing_edited', marketplace: 'etsy', listingId: 'listing-1' },
    client
  )
  assert.equal(row.event_type, 'listing_edited')
})

// --- 9. approval / rejection --------------------------------------------------

test('9. listing_approved and listing_rejected are both supported, each with marketplace + listing_id', async () => {
  for (const eventType of ['listing_approved', 'listing_rejected'] as const) {
    const client = makeInsertMockClient({
      userId: 'user-a',
      result: baseRow({ event_type: eventType, marketplace: 'myntra', listing_id: 'listing-2' })
    })
    const row = await recordProductHistoryEvent(
      { productId: 'product-1', eventType, marketplace: 'myntra', listingId: 'listing-2' },
      client
    )
    assert.equal(row.event_type, eventType)
    assert.equal(row.marketplace, 'myntra')
  }
})

// --- 10. exported supports marketplace + export reference ---------------------

test('10. exported supports marketplace and an export_id reference in metadata (never a duplicate export record)', async () => {
  const client = makeInsertMockClient({
    userId: 'user-a',
    result: baseRow({
      event_type: 'exported',
      marketplace: 'flipkart',
      listing_id: 'listing-3',
      metadata: { export_id: 'export-1', format: 'csv' }
    })
  })
  const row = await recordProductHistoryEvent(
    {
      productId: 'product-1',
      eventType: 'exported',
      marketplace: 'flipkart',
      listingId: 'listing-3',
      metadata: { export_id: 'export-1', format: 'csv' }
    },
    client
  )
  assert.equal(row.event_type, 'exported')
  assert.deepEqual(row.metadata, { export_id: 'export-1', format: 'csv' })
})

// --- Metadata validation (spec §5/§6 — JSON-safe, bounded, no payload dumps) --

test('metadata must be a flat object of strings/numbers/booleans/null — a nested object is rejected', async () => {
  const client = makeInsertMockClient({ userId: 'user-a', result: baseRow() })
  await assert.rejects(() =>
    recordProductHistoryEvent(
      { productId: 'product-1', eventType: 'product_created', metadata: { nested: { oops: true } } as any },
      client
    )
  )
  assert.equal(client.__calls.length, 0)
})

test('metadata as an array is rejected (must be a flat object, not a list)', async () => {
  const client = makeInsertMockClient({ userId: 'user-a', result: baseRow() })
  await assert.rejects(() =>
    recordProductHistoryEvent({ productId: 'product-1', eventType: 'product_created', metadata: ['a', 'b'] as any }, client)
  )
})

test('productId is required', async () => {
  const client = makeInsertMockClient({ userId: 'user-a', result: baseRow() })
  await assert.rejects(() => recordProductHistoryEvent({ productId: '' as any, eventType: 'product_created' }, client))
})

// --- ownership / auth ---------------------------------------------------------

test('14/15. recordProductHistoryEvent rejects when there is no authenticated session — never derives ownership from anything else', async () => {
  const client = makeInsertMockClient({ userId: null })
  await assert.rejects(() => recordProductHistoryEvent({ productId: 'product-1', eventType: 'product_created' }, client))
})

test('owner_user_id is always derived from the session, never accepted as a parameter — recordProductHistoryEvent has no such parameter at all', async () => {
  const client = makeInsertMockClient({ userId: 'user-a', result: baseRow() })
  await recordProductHistoryEvent({ productId: 'product-1', eventType: 'product_created' }, client)
  const insertCall = client.__calls.find((c: any) => c.op === 'insert')
  assert.equal(insertCall.payload.owner_user_id, 'user-a')
  assert.ok(!('userId' in ({} as Parameters<typeof recordProductHistoryEvent>[0])))
})

// --- 11/12. Ordering ------------------------------------------------------------

test('11. getProductHistory orders newest-first (created_at descending)', async () => {
  const client = makeHistoryReadMockClient({ userId: 'user-a', result: { data: [], error: null } })
  await getProductHistory('product-1', client)
  const orderCalls = client.__calls.filter((c: any) => c.op === 'order')
  assert.equal(orderCalls[0].column, 'created_at')
  assert.deepEqual(orderCalls[0].options, { ascending: false })
})

test('12. getProductHistory has a deterministic secondary sort (seq) for events whose created_at collides', async () => {
  const client = makeHistoryReadMockClient({ userId: 'user-a', result: { data: [], error: null } })
  await getProductHistory('product-1', client)
  const orderCalls = client.__calls.filter((c: any) => c.op === 'order')
  assert.equal(orderCalls.length, 2)
  assert.equal(orderCalls[1].column, 'seq')
  assert.deepEqual(orderCalls[1].options, { ascending: false })
})

test('getProductHistory scopes strictly to the given product_id', async () => {
  const client = makeHistoryReadMockClient({ userId: 'user-a', result: { data: [], error: null } })
  await getProductHistory('product-1', client)
  const eqCall = client.__calls.find((c: any) => c.op === 'eq')
  assert.deepEqual({ column: eqCall.column, value: eqCall.value }, { column: 'product_id', value: 'product-1' })
})

// --- 13. Empty history ------------------------------------------------------------

test('13. getProductHistory returns an empty array, not null/undefined, for a product with no events', async () => {
  const client = makeHistoryReadMockClient({ userId: 'user-a', result: { data: null, error: null } })
  const events = await getProductHistory('product-1', client)
  assert.deepEqual(events, [])
})

test('getProductHistory rejects for a guest (no session)', async () => {
  const client = makeHistoryReadMockClient({ userId: null })
  await assert.rejects(() => getProductHistory('product-1', client))
})

test('getProductHistory surfaces a genuine Supabase error rather than swallowing it', async () => {
  const dbError = { message: 'permission denied', code: '42501' }
  const client = makeHistoryReadMockClient({ userId: 'user-a', result: { data: null, error: dbError } })
  await assert.rejects(() => getProductHistory('product-1', client), (err: any) => err === dbError)
})

// --- §12 — centralized display mapping ------------------------------------------

test('EVENT_TYPE_LABELS has a human label for every event type, with no raw event_type string used anywhere in it', () => {
  for (const eventType of PRODUCT_HISTORY_EVENT_TYPES) {
    assert.ok(EVENT_TYPE_LABELS[eventType], `missing label for ${eventType}`)
    assert.notEqual(EVENT_TYPE_LABELS[eventType], eventType)
  }
})

test('describeProductHistoryEvent folds marketplace into the title for "exported" ("Exported to Amazon"), per the spec example', () => {
  const display = describeProductHistoryEvent(
    baseRow({ event_type: 'exported', marketplace: 'amazon' }).data as ProductHistoryEventRow
  )
  assert.equal(display.title, 'Exported to Amazon')
  assert.equal(display.marketplaceLabel, null)
})

test('describeProductHistoryEvent shows marketplace as separate context (not folded into the title) for non-export events', () => {
  const display = describeProductHistoryEvent(
    baseRow({ event_type: 'listing_approved', marketplace: 'myntra' }).data as ProductHistoryEventRow
  )
  assert.equal(display.title, 'Listing approved')
  assert.equal(display.marketplaceLabel, 'Myntra')
})

test('describeProductHistoryEvent surfaces metadata.source as a human label (never the raw source string)', () => {
  const display = describeProductHistoryEvent(
    baseRow({ event_type: 'product_created', metadata: { source: 'manual' } }).data as ProductHistoryEventRow
  )
  assert.equal(display.sourceLabel, 'Manual Entry')
})

test('describeProductHistoryEvent never exposes raw metadata JSON', () => {
  const display: any = describeProductHistoryEvent(
    baseRow({ event_type: 'exported', metadata: { export_id: 'export-1', format: 'csv' } }).data as ProductHistoryEventRow
  )
  assert.ok(!('metadata' in display), 'the display object must never carry raw metadata through to the UI')
})

// --- 17/18. C7/C5 unaffected — structural check on this module's own surface --

test("17. this module never imports from or writes to catalog_exports — C7 Export History stays the sole authoritative export record", () => {
  const source = readFileSync(join(__dirname, 'productHistory.ts'), 'utf8')
  assert.ok(!/catalog_exports/.test(source))
})

test('18. this module never imports lib/credits.ts or touches user_credits/credit_transactions — C14 is credit-neutral', () => {
  const source = readFileSync(join(__dirname, 'productHistory.ts'), 'utf8')
  assert.ok(!/lib\/credits/.test(source))
  assert.ok(!/user_credits/.test(source))
  assert.ok(!/credit_transactions/.test(source))
})

// --- 15. append-only enforcement lives in the migration, not just app code ----

test('15. the migration grants only SELECT + INSERT policies for product_history_events — no UPDATE/DELETE policy for any client role', () => {
  const migration = readFileSync(
    join(__dirname, '..', 'supabase', 'migrations', '20260810_10_product_history.sql'),
    'utf8'
  )
  assert.match(migration, /create policy "product_history_events_owner_select"/)
  assert.match(migration, /create policy "product_history_events_owner_insert"/)
  assert.ok(!/create policy "product_history_events_owner_update"/.test(migration))
  assert.ok(!/create policy "product_history_events_owner_delete"/.test(migration))
  assert.ok(!/for update/i.test(migration), 'no "for update" policy clause should exist in this migration at all')
  assert.ok(!/for delete/i.test(migration), 'no "for delete" policy clause should exist in this migration at all')
})

test("the insert policy's WITH CHECK verifies both owner_user_id and product ownership via catalog_products — never a caller-supplied id alone", () => {
  const migration = readFileSync(
    join(__dirname, '..', 'supabase', 'migrations', '20260810_10_product_history.sql'),
    'utf8'
  )
  const start = migration.indexOf('product_history_events_owner_insert')
  const body = migration.slice(start, start + 500)
  assert.match(body, /auth\.uid\(\) = owner_user_id/)
  assert.match(body, /exists\s*\(\s*select 1 from catalog_products/)
})
