// Unit tests for lib/catalogReconciliation.ts, using Node's built-in test
// runner (no new dependency — tsx is already a project devDependency).
// Run with: npx tsx --test lib/catalogReconciliation.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeDraftWithServer, buildDraftFromServer, reconcileCatalog, type ComputeStatus } from './catalogReconciliation'
import { emptyGeneratedContent, emptyApproved, emptyGenerationError, emptyGenerationMeta, type DraftProduct } from './types'
import type { CatalogProductRow, CatalogListingRow, CatalogListingApprovalRow, CatalogSnapshot } from './catalog'

// Mirrors CatalogueWorkspace.tsx's own computeProductStatus exactly (see
// that file) — reimplemented here only because it's a component-internal
// closure, not exported; the logic itself is 3 lines and not part of what
// this milestone changed.
const computeStatus: ComputeStatus = (generatedContent, attempted) => {
  const succeeded = attempted.filter((m) => generatedContent[m] !== null).length
  if (succeeded === 0) return 'draft'
  if (succeeded === attempted.length) return 'generated'
  return 'partial'
}

function makeLocalProduct(overrides: Partial<DraftProduct> = {}): DraftProduct {
  return {
    id: 'local-1',
    brandName: 'Acme',
    description: 'desc',
    category: 'cat',
    imageFile: null,
    imageUrl: null,
    generatedContent: emptyGeneratedContent(),
    approved: emptyApproved(),
    status: 'draft',
    generationError: emptyGenerationError(),
    skipBrandVoice: false,
    generationMeta: emptyGenerationMeta(),
    visualAttributes: null,
    ...overrides
  }
}

function makeServerProduct(overrides: Partial<CatalogProductRow> = {}): CatalogProductRow {
  return {
    id: 'server-1',
    owner_user_id: 'user-a',
    client_id: null,
    brand_name: 'Server Acme',
    description: 'server desc',
    category: 'server cat',
    image_url: 'https://x/y.jpg',
    created_at: '',
    updated_at: '',
    ...overrides
  }
}

function makeListing(overrides: Partial<CatalogListingRow> = {}): CatalogListingRow {
  return {
    id: 'listing-1',
    product_id: 'server-1',
    owner_user_id: 'user-a',
    marketplace: 'amazon',
    shaped_content: null,
    generation_meta: null,
    generation_error: null,
    created_at: '',
    updated_at: '',
    ...overrides
  }
}

test('buildDraftFromServer: constructs a full DraftProduct from a server-only product', () => {
  const server = makeServerProduct()
  const listing = makeListing({ shaped_content: { title: 'Real Title' }, generation_meta: { bulletCount: 5 } as any })

  const result = buildDraftFromServer(server, [listing], new Map(), computeStatus)

  assert.equal(result.id, 'server-1')
  assert.equal(result.serverId, 'server-1')
  assert.equal(result.brandName, 'Server Acme')
  assert.equal(result.imageUrl, 'https://x/y.jpg')
  assert.equal(result.imageFile, null)
  assert.equal(result.skipBrandVoice, false)
  assert.equal(result.visualAttributes, null)
  assert.deepEqual(result.listingServerIds, { amazon: 'listing-1' })
  assert.deepEqual(result.generatedContent.amazon, { title: 'Real Title' })
  assert.equal(result.status, 'generated')
})

test('CRITICAL NULL-CONTENT RULE: buildDraftFromServer leaves generatedContent null when shaped_content is null (nothing local to fall back to)', () => {
  const server = makeServerProduct()
  const listing = makeListing({ shaped_content: null })

  const result = buildDraftFromServer(server, [listing], new Map(), computeStatus)

  assert.equal(result.generatedContent.amazon, null)
  // The listing id is still captured even though content is null — a
  // future regenerate/approval/export still needs a real id to act on.
  assert.equal(result.listingServerIds?.amazon, 'listing-1')
})

test('CRITICAL NULL-CONTENT RULE: mergeDraftWithServer never overwrites valid local content with a null server listing', () => {
  const local = makeLocalProduct({
    serverId: 'server-1',
    generatedContent: { ...emptyGeneratedContent(), amazon: { title: 'Good Local Content' } },
    generationMeta: { ...emptyGenerationMeta(), amazon: { bulletCount: 3 } as any }
  })
  const server = makeServerProduct()
  const nullListing = makeListing({ shaped_content: null, generation_meta: null })

  const result = mergeDraftWithServer(local, server, [nullListing], new Map(), computeStatus)

  assert.deepEqual(result.generatedContent.amazon, { title: 'Good Local Content' })
  assert.deepEqual(result.generationMeta.amazon, { bulletCount: 3 })
  // listingServerIds is still updated from the server row even though its
  // content was rejected — the id itself is real and needed for future
  // approval/export/regenerate actions.
  assert.equal(result.listingServerIds?.amazon, 'listing-1')
})

test('mergeDraftWithServer: server content wins when non-null', () => {
  const local = makeLocalProduct({
    serverId: 'server-1',
    generatedContent: { ...emptyGeneratedContent(), amazon: { title: 'Stale Local' } }
  })
  const server = makeServerProduct()
  const listing = makeListing({ shaped_content: { title: 'Fresh Server Content' } })

  const result = mergeDraftWithServer(local, server, [listing], new Map(), computeStatus)

  assert.deepEqual(result.generatedContent.amazon, { title: 'Fresh Server Content' })
})

test('mergeDraftWithServer: does not touch brandName, description, imageFile, skipBrandVoice, or visualAttributes', () => {
  const local = makeLocalProduct({
    serverId: 'server-1',
    brandName: 'Local Brand Name',
    description: 'local description',
    skipBrandVoice: true,
    visualAttributes: { colour: 'blue' }
  })
  const server = makeServerProduct({ brand_name: 'Different Server Name' })

  const result = mergeDraftWithServer(local, server, [], new Map(), computeStatus)

  assert.equal(result.brandName, 'Local Brand Name')
  assert.equal(result.description, 'local description')
  assert.equal(result.skipBrandVoice, true)
  assert.deepEqual(result.visualAttributes, { colour: 'blue' })
})

test('mergeDraftWithServer: approvals are applied from the approvals map', () => {
  const local = makeLocalProduct({ serverId: 'server-1' })
  const server = makeServerProduct()
  const listing = makeListing({ shaped_content: { title: 't' } })
  const approval: CatalogListingApprovalRow = {
    id: 'approval-1',
    listing_id: 'listing-1',
    owner_user_id: 'user-a',
    approved: true,
    approved_by: 'user-a',
    approved_at: '',
    created_at: '',
    updated_at: ''
  }

  const result = mergeDraftWithServer(local, server, [listing], new Map([['listing-1', approval]]), computeStatus)

  assert.equal(result.approved.amazon, true)
})

test('reconcileCatalog: local product with no serverId is preserved unchanged', () => {
  const local = makeLocalProduct({ id: 'local-only', serverId: undefined, brandName: 'Never Synced' })
  const snapshot: CatalogSnapshot = { products: [], listings: [], approvals: [] }

  const result = reconcileCatalog([local], snapshot, computeStatus)

  assert.equal(result.length, 1)
  assert.equal(result[0], local) // same object reference — untouched
})

test('reconcileCatalog: local product whose serverId has no matching server row is preserved, not dropped', () => {
  const local = makeLocalProduct({ id: 'orphan', serverId: 'deleted-server-id' })
  const snapshot: CatalogSnapshot = { products: [], listings: [], approvals: [] }

  const result = reconcileCatalog([local], snapshot, computeStatus)

  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'orphan')
})

test('reconcileCatalog: matches by serverId ONLY, never by brand name/description/etc', () => {
  // Same brandName/description as the server product, but no serverId at
  // all — must NOT be fuzzy-matched into a merge; must appear twice
  // (the local one preserved, plus a separate server-constructed one).
  const local = makeLocalProduct({ id: 'local-1', brandName: 'Acme', description: 'desc', serverId: undefined })
  const server = makeServerProduct({ id: 'server-1', brand_name: 'Acme', description: 'desc' })
  const snapshot: CatalogSnapshot = { products: [server], listings: [], approvals: [] }

  const result = reconcileCatalog([local], snapshot, computeStatus)

  assert.equal(result.length, 2)
  assert.ok(result.some((p) => p.id === 'local-1' && p.serverId === undefined))
  assert.ok(result.some((p) => p.id === 'server-1' && p.serverId === 'server-1'))
})

test('reconcileCatalog: a server product with a real local match merges into ONE product, not two', () => {
  const local = makeLocalProduct({ id: 'local-1', serverId: 'server-1' })
  const server = makeServerProduct({ id: 'server-1' })
  const snapshot: CatalogSnapshot = { products: [server], listings: [], approvals: [] }

  const result = reconcileCatalog([local], snapshot, computeStatus)

  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'local-1') // local identity preserved through the merge
  assert.equal(result[0].serverId, 'server-1')
})

test('reconcileCatalog: mixed scenario — one merge, one server-only, one local-only, all present exactly once', () => {
  const mergedLocal = makeLocalProduct({ id: 'a', serverId: 'sa' })
  const localOnly = makeLocalProduct({ id: 'b', serverId: undefined })
  const serverA = makeServerProduct({ id: 'sa' })
  const serverOnly = makeServerProduct({ id: 'sb' })
  const snapshot: CatalogSnapshot = { products: [serverA, serverOnly], listings: [], approvals: [] }

  const result = reconcileCatalog([mergedLocal, localOnly], snapshot, computeStatus)

  assert.equal(result.length, 3)
  assert.ok(result.some((p) => p.id === 'a' && p.serverId === 'sa'))
  assert.ok(result.some((p) => p.id === 'b'))
  assert.ok(result.some((p) => p.id === 'sb' && p.serverId === 'sb'))
})
