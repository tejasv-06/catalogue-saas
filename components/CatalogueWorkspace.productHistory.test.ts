// Milestone C14 (Milestone 34) — regression/wiring guard for Product
// History integration into CatalogueWorkspace.tsx and
// app/api/enrich-product/route.ts. Same source-inspection approach as the
// other CatalogueWorkspace.*.test.ts files (no jest/testing-library in this
// project) — real end-to-end behavior is covered separately by live
// browser verification.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const workspaceSource = readFileSync(join(__dirname, 'CatalogueWorkspace.tsx'), 'utf8')
const enrichRouteSource = readFileSync(join(__dirname, '..', 'app', 'api', 'enrich-product', 'route.ts'), 'utf8')
const catalogSource = readFileSync(join(__dirname, '..', 'lib', 'catalog.ts'), 'utf8')

function bodyOf(source: string, fnSignature: string, window = 3000): string {
  const start = source.indexOf(fnSignature)
  assert.ok(start !== -1, `expected to find "${fnSignature}"`)
  return source.slice(start, start + window)
}

// --- C14-AC13. Product creation generates product_created ------------------

test('AC13. ensureServerProduct records product_created only in the branch that actually calls createProduct (never on the early-return/in-flight-reuse paths)', () => {
  const body = bodyOf(workspaceSource, 'async function ensureServerProduct(', 1600)
  const createIdx = body.indexOf('const id = await createProduct(')
  const recordIdx = body.indexOf("eventType: 'product_created'")
  assert.ok(createIdx !== -1 && recordIdx !== -1)
  assert.ok(createIdx < recordIdx, 'product_created must be recorded AFTER createProduct succeeds, not before')
  // The early return (already has a serverId) and the in-flight-promise
  // reuse both happen before this point in the function body — recording
  // only inside the async IIFE that calls createProduct is what makes a
  // duplicate product_created structurally impossible (same guards that
  // already prevent a duplicate createProduct call).
  const earlyReturnIdx = body.indexOf('if (product.serverId) return product.serverId')
  assert.ok(earlyReturnIdx !== -1 && earlyReturnIdx < createIdx)
})

test('ensureServerProduct threads an explicit source (manual/csv/photo) into product_created metadata — never a guess made at record time', () => {
  const body = bodyOf(workspaceSource, 'async function ensureServerProduct(', 1600)
  assert.match(body, /metadata:\s*\{\s*source\s*\}/)
})

test('all three ensureServerProduct call sites pass an explicit, correct source', () => {
  assert.match(workspaceSource, /ensureServerProduct\(newProduct,\s*source\)/, 'commitAddProduct must thread its own source parameter through')
  assert.match(workspaceSource, /ensureServerProduct\(product,\s*'csv'\)/, 'commitCsvUpload must tag its rows as csv')
  assert.match(workspaceSource, /commitAddProduct\(true, uploadedImageUrl, '', 'photo'\)/, 'handleAddImageOnlyProduct must tag its product as photo')
})

// --- C14-AC14. Meaningful product updates generate product_updated ---------

test('AC14. the editingId branch of commitAddProduct persists via the new updateProduct before recording product_updated', () => {
  const body = bodyOf(workspaceSource, 'function commitAddProduct(', 2600)
  const editBranchIdx = body.indexOf('if (editingId) {')
  const updateIdx = body.indexOf('void updateProduct(serverId,')
  const recordIdx = body.indexOf(".then(() => recordProductHistoryEvent({ productId: serverId, eventType: 'product_updated' }))")
  assert.ok(editBranchIdx !== -1 && updateIdx !== -1 && recordIdx !== -1)
  assert.ok(editBranchIdx < updateIdx && updateIdx < recordIdx)
})

test('the edit path is skipped entirely for a product with no serverId yet or no session — never a fabricated update', () => {
  const body = bodyOf(workspaceSource, 'function commitAddProduct(', 2600)
  assert.match(body, /if \(hasSession && existing\?\.serverId\) \{/)
})

test('lib/catalog.ts exports a new, additive updateProduct that mirrors setProductIntelligence\'s own ownership pattern (RLS-only, no owner param)', () => {
  const start = catalogSource.indexOf('export async function updateProduct(')
  assert.ok(start !== -1, 'expected lib/catalog.ts to export updateProduct')
  const body = catalogSource.slice(start, start + 500)
  assert.match(body, /await requireUserId\(client\)/)
  assert.match(body, /\.from\('catalog_products'\)\s*\.update\(fields\)/)
  assert.ok(!/owner_user_id/.test(body), 'updateProduct must never accept or set owner_user_id itself — RLS is the only enforcement')
})

// --- C14-AC15. C9 enrichment generates started/completed/failed -------------

test('AC15. enrich-product route records enrichment_started only after the processing-state write succeeds', () => {
  const markProcessingIdx = enrichRouteSource.indexOf('await setProductIntelligence(productId, buildProcessingIntelligence(previous), authClient)')
  const startedIdx = enrichRouteSource.indexOf("eventType: 'enrichment_started'")
  assert.ok(markProcessingIdx !== -1 && startedIdx !== -1)
  assert.ok(markProcessingIdx < startedIdx)
})

test('AC15. enrich-product route records enrichment_completed only after setProductIntelligence(completed) succeeds', () => {
  const completedWriteIdx = enrichRouteSource.indexOf('const row = await setProductIntelligence(productId, completed, authClient)')
  const completedEventIdx = enrichRouteSource.indexOf("eventType: 'enrichment_completed'")
  assert.ok(completedWriteIdx !== -1 && completedEventIdx !== -1)
  assert.ok(completedWriteIdx < completedEventIdx)
})

test('AC15/AC22. enrich-product route records enrichment_failed on both failure paths, never on a rejected/unauthorized request', () => {
  const failedEventMatches = enrichRouteSource.match(/eventType: 'enrichment_failed'/g) ?? []
  assert.equal(failedEventMatches.length, 2, 'expected exactly two enrichment_failed recording sites: the no-input-data 400 case and the generation-error case')

  // The 401 (no session) / 404 (not found/not yours) / 409 (already
  // processing) responses all return BEFORE buildProcessingIntelligence is
  // ever persisted — none of them should have any history call near them.
  const authCheckIdx = enrichRouteSource.indexOf("return NextResponse.json({ error: 'Sign in required' }, { status: 401 })")
  const notFoundIdx = enrichRouteSource.indexOf("return NextResponse.json({ error: 'Product not found' }, { status: 404 })")
  const alreadyProcessingIdx = enrichRouteSource.indexOf('Enrichment is already in progress')
  for (const idx of [authCheckIdx, notFoundIdx, alreadyProcessingIdx]) {
    assert.ok(idx !== -1)
    const nearby = enrichRouteSource.slice(Math.max(0, idx - 200), idx + 50)
    assert.ok(!/recordProductHistoryEvent/.test(nearby), 'no history event may be recorded near a rejected/unauthorized-request return')
  }
})

test('history recording in enrich-product is fire-and-forget (void ... .catch(...)) — a history failure can never turn a successful enrichment response into an error', () => {
  const calls = enrichRouteSource.match(/void recordProductHistoryEvent\([^]*?\.catch\(/g) ?? []
  assert.equal(calls.length, 4, 'expected 4 fire-and-forget history calls: started, completed, and 2 failed sites')
})

// --- C14-AC16/AC22. listing_generated only after real persistence -----------

test('AC16/AC22. persistGenerationToCatalog records the listing event only inside the try block, after upsertListing resolves, never in the catch block', () => {
  const body = bodyOf(workspaceSource, 'async function persistGenerationToCatalog(', 3200)
  const upsertIdx = body.indexOf('const listing = await upsertListing(')
  const eventIdx = body.indexOf('void recordProductHistoryEvent({')
  const catchIdx = body.indexOf('failed to upsert catalog_listings for product')
  assert.ok(upsertIdx !== -1 && eventIdx !== -1 && catchIdx !== -1)
  assert.ok(upsertIdx < eventIdx && eventIdx < catchIdx, 'the history call must sit between the successful upsert and the catch block, never inside/after the catch')
})

// --- C14-AC16/AC17. listing_generated vs listing_edited distinction ---------

test("AC16/AC17. persistGenerationToCatalog distinguishes listing_generated (first time) from listing_edited (a prior listingServerId already existed), captured BEFORE the upsert", () => {
  const body = bodyOf(workspaceSource, 'async function persistGenerationToCatalog(', 3200)
  const hadExistingIdx = body.indexOf('const hadExistingListing = !!product.listingServerIds?.[marketplace]')
  const upsertIdx = body.indexOf('const listing = await upsertListing(')
  assert.ok(hadExistingIdx !== -1 && upsertIdx !== -1 && hadExistingIdx < upsertIdx)
  assert.match(body, /eventType: hadExistingListing \? 'listing_edited' : 'listing_generated'/)
})

// --- C14-AC18/AC19. Approval / rejection ------------------------------------

test("AC18/AC19. persistApprovalToCatalog maps the existing approve/unapprove toggle to listing_approved/listing_rejected — no second approval mechanism", () => {
  const body = bodyOf(workspaceSource, 'async function persistApprovalToCatalog(', 1600)
  const setApprovalIdx = body.indexOf('await setApproval(listingId, approved)')
  const eventIdx = body.indexOf("eventType: approved ? 'listing_approved' : 'listing_rejected'")
  assert.ok(setApprovalIdx !== -1 && eventIdx !== -1 && setApprovalIdx < eventIdx)
})

test('handleApproveMarketplace/handleUnapproveMarketplace are unchanged — persistApprovalToCatalog is still the only place approval is persisted', () => {
  assert.match(workspaceSource, /function handleApproveMarketplace\(id: string, marketplace: Marketplace\) \{/)
  assert.match(workspaceSource, /function handleUnapproveMarketplace\(id: string, marketplace: Marketplace\) \{/)
  assert.match(workspaceSource, /void persistApprovalToCatalog\(id, marketplace, true\)/)
  assert.match(workspaceSource, /void persistApprovalToCatalog\(id, marketplace, false\)/)
})

// --- C14-AC20/AC21. exported references the existing C7 export record -------

test('AC20/AC21. the exported event is recorded only after recordExport (C7) resolves, and carries that export row\'s own id — never a duplicate export record', () => {
  const start = workspaceSource.indexOf('async function performExport(')
  const end = workspaceSource.indexOf('const exportedByProduct = new Map')
  const body = workspaceSource.slice(start, end)
  const recordExportIdx = body.indexOf('void recordExport(marketplace, listingIds,')
  const thenIdx = body.indexOf('.then((exportRow) => {')
  const eventIdx = body.indexOf("eventType: 'exported'")
  const exportIdMetaIdx = body.indexOf('export_id: exportRow.id')
  assert.ok([recordExportIdx, thenIdx, eventIdx, exportIdMetaIdx].every((i) => i !== -1))
  assert.ok(recordExportIdx < thenIdx && thenIdx < eventIdx && eventIdx < exportIdMetaIdx)
})

test('C7 catalog.ts exports (recordExport, getExportHistory) are byte-identical in signature — untouched by C14', () => {
  assert.match(catalogSource, /export async function recordExport\(\s*marketplace: Marketplace,\s*listingIds: string\[\],\s*fileName: string \| null,\s*client: SupabaseClient = createClient\(\)\s*\): Promise<CatalogExportRow>/)
  assert.match(catalogSource, /export async function getExportHistory\(client: SupabaseClient = createClient\(\)\): Promise<CatalogExportRow\[\]>/)
})

// --- C14-AC23. History failure never corrupts the primary operation --------

test('AC23. every recordProductHistoryEvent call site in CatalogueWorkspace.tsx is fire-and-forget, never awaited into a path that could fail the primary operation', () => {
  // Two shapes both count as fire-and-forget here: a direct
  // `void recordProductHistoryEvent(...)` (product_created,
  // listing_generated/edited, approved/rejected, exported — 4 sites), and
  // product_updated's `void updateProduct(...).then(() =>
  // recordProductHistoryEvent(...)).catch(...)` — still a single `void`-led
  // chain with one .catch() covering both calls, just not literally
  // prefixed with "void recordProductHistoryEvent(" itself.
  const directCalls = workspaceSource.match(/void recordProductHistoryEvent\(/g) ?? []
  const chainedCalls = workspaceSource.match(/\.then\(\(\) => recordProductHistoryEvent\(/g) ?? []
  assert.equal(directCalls.length, 4)
  assert.equal(chainedCalls.length, 1)

  const totalRecordCalls = (workspaceSource.match(/recordProductHistoryEvent\(/g) ?? []).length
  assert.equal(totalRecordCalls, 5, 'expected exactly 5 total recordProductHistoryEvent call sites in CatalogueWorkspace.tsx')

  // Each of the 4 direct call sites logs under its own "Product history:"
  // prefix. The 1 chained site (product_updated) is covered by the
  // enclosing chain's own .catch(...) instead (verified separately below)
  // — still fire-and-forget, just one shared handler for both the
  // updateProduct call and the history call chained onto it.
  const productHistoryCatches = (workspaceSource.match(/console\.error\(\s*`Product history:/g) ?? []).length
  assert.equal(productHistoryCatches, 4)

  const chainedCallIdx = workspaceSource.indexOf('.then(() => recordProductHistoryEvent(')
  assert.ok(chainedCallIdx !== -1)
  const afterChainedCall = workspaceSource.slice(chainedCallIdx, chainedCallIdx + 120)
  assert.match(afterChainedCall, /\.catch\(/, 'the chained product_updated history call must still be covered by a .catch(...)')
})

// --- C14-AC24. Timeline inside the existing drawer, no new nav route -------

test('AC24/AC40. ProductHistory is mounted inside the existing GeneratedListingDrawer, not a new page/route', () => {
  const drawerStart = workspaceSource.indexOf('function GeneratedListingDrawer(')
  const productHistoryIdx = workspaceSource.indexOf('<ProductHistory')
  // The next top-level construct after the drawer in the real file — used
  // only as an upper bound to confirm <ProductHistory /> renders BEFORE
  // the drawer function ends, not to pin an exact closing-brace offset.
  const nextSectionIdx = workspaceSource.indexOf('The three input methods (Bulk Upload')
  assert.ok(drawerStart !== -1 && productHistoryIdx !== -1 && nextSectionIdx !== -1)
  assert.ok(drawerStart < productHistoryIdx && productHistoryIdx < nextSectionIdx, '<ProductHistory /> must render inside GeneratedListingDrawer')
  assert.match(workspaceSource, /<ProductHistory productId=\{product\.serverId\} \/>/)
})

test('no new route/page files were introduced for history — app/ has no product-history route', () => {
  // app/api/enrich-product, app/api/export, app/api/generate-single etc.
  // already exist; this just confirms no NEW app/**/history-ish route was
  // added by this milestone.
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const appDir = path.join(__dirname, '..', 'app')
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/history/i.test(entry.name)) found.push(full)
    }
  }
  walk(appDir)
  assert.deepEqual(found, [])
})
