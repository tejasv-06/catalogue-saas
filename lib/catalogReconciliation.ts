import { SUPPORTED_MARKETPLACES } from '@/lib/platformShapers'
import {
  emptyGeneratedContent,
  emptyApproved,
  emptyGenerationError,
  emptyGenerationMeta,
  type DraftProduct,
  type Marketplace
} from '@/lib/types'
import type { CatalogSnapshot, CatalogProductRow, CatalogListingRow, CatalogListingApprovalRow } from '@/lib/catalog'

// Milestone 26 (Step C4) — pure reconciliation logic, deliberately kept out
// of CatalogueWorkspace.tsx's closures (unlike C2/C3's persistence helpers)
// specifically so this — the highest-risk logic in the milestone — can be
// unit-tested for real with node:test, not just live-verified. Nothing here
// touches Supabase directly; it only transforms already-fetched rows.

export type ComputeStatus = (
  generatedContent: DraftProduct['generatedContent'],
  attemptedMarketplaces: Marketplace[]
) => DraftProduct['status']

function attemptedMarketplacesOf(
  generatedContent: DraftProduct['generatedContent'],
  generationError: DraftProduct['generationError']
): Marketplace[] {
  return SUPPORTED_MARKETPLACES.filter((m) => generatedContent[m] !== null || generationError[m] !== null)
}

// CRITICAL NULL-CONTENT RULE — a catalog_listings row with
// shaped_content === null (a pre-Milestone-25 row, or a failed dual-write)
// must never overwrite valid local content. Content/meta/error/id are
// treated as one atomic unit per marketplace: only taken from the server
// when shaped_content is actually present, identical whether merging into
// an existing local product or constructing a server-only one.
// listingServerIds is the one exception — a listing row's own id is real
// and worth capturing regardless of whether its content happens to be
// null, since a future regenerate (upsert on the existing
// (product_id, marketplace) row) and any approval/export action both need
// it either way.
function applyListing(
  listing: CatalogListingRow,
  generatedContent: DraftProduct['generatedContent'],
  generationMeta: DraftProduct['generationMeta'],
  generationError: DraftProduct['generationError'],
  approved: DraftProduct['approved'],
  listingServerIds: Partial<Record<Marketplace, string>>,
  approvalsByListing: Map<string, CatalogListingApprovalRow>
) {
  listingServerIds[listing.marketplace] = listing.id
  if (listing.shaped_content !== null) {
    generatedContent[listing.marketplace] = listing.shaped_content
    generationMeta[listing.marketplace] = listing.generation_meta
    generationError[listing.marketplace] = listing.generation_error
  }
  const approval = approvalsByListing.get(listing.id)
  if (approval) approved[listing.marketplace] = approval.approved
}

// A local DraftProduct with a matching serverId — server listing data wins
// per marketplace only when non-null (see applyListing); brandName,
// description, category, imageUrl, imageFile, skipBrandVoice, and
// visualAttributes are NOT touched here and stay exactly as the local copy
// has them (Rules 9–11) — none of those are reconstructed from the server.
export function mergeDraftWithServer(
  local: DraftProduct,
  serverProduct: CatalogProductRow,
  listings: CatalogListingRow[],
  approvalsByListing: Map<string, CatalogListingApprovalRow>,
  computeStatus: ComputeStatus
): DraftProduct {
  const generatedContent = { ...local.generatedContent }
  const generationMeta = { ...local.generationMeta }
  const generationError = { ...local.generationError }
  const approved = { ...local.approved }
  const listingServerIds = { ...local.listingServerIds }

  for (const listing of listings) {
    applyListing(listing, generatedContent, generationMeta, generationError, approved, listingServerIds, approvalsByListing)
  }

  return {
    ...local,
    serverId: serverProduct.id,
    listingServerIds,
    generatedContent,
    generationMeta,
    generationError,
    approved,
    status: computeStatus(generatedContent, attemptedMarketplacesOf(generatedContent, generationError))
  }
}

// A server product with no matching local DraftProduct (e.g. a fresh
// browser/device with no localStorage session at all).
export function buildDraftFromServer(
  serverProduct: CatalogProductRow,
  listings: CatalogListingRow[],
  approvalsByListing: Map<string, CatalogListingApprovalRow>,
  computeStatus: ComputeStatus
): DraftProduct {
  const generatedContent = emptyGeneratedContent()
  const generationMeta = emptyGenerationMeta()
  const generationError = emptyGenerationError()
  const approved = emptyApproved()
  const listingServerIds: Partial<Record<Marketplace, string>> = {}

  for (const listing of listings) {
    applyListing(listing, generatedContent, generationMeta, generationError, approved, listingServerIds, approvalsByListing)
  }

  return {
    id: serverProduct.id,
    serverId: serverProduct.id,
    listingServerIds,
    brandName: serverProduct.brand_name ?? '',
    description: serverProduct.description ?? '',
    category: serverProduct.category ?? '',
    imageFile: null,
    imageUrl: serverProduct.image_url,
    // Milestone C17 — mirrors the server's own client_id so a product
    // hydrated fresh from the server (no local match) is still correctly
    // scoped to its brand for "My Products" filtering.
    clientId: serverProduct.client_id,
    generatedContent,
    approved,
    status: computeStatus(generatedContent, attemptedMarketplacesOf(generatedContent, generationError)),
    generationError,
    // Rule 9 — not persisted server-side (only catalog_products.client_id
    // is; there is no per-product "was brand voice skipped" column), so a
    // server-only-hydrated product always defaults to false, same as a
    // brand-new product does today. Documented limitation, not a schema
    // change.
    skipBrandVoice: false,
    generationMeta,
    // Rule 11 — not persisted anywhere in catalog_listings; a
    // server-only-hydrated product can never show "Detected from image"
    // until regenerated. Documented limitation, not a schema change.
    visualAttributes: null
  }
}

// Matches server catalog_products to local DraftProducts using ONLY
// DraftProduct.serverId (Rule 6) — never brand name/description/category/
// image/array position/content, no fuzzy matching. A local product whose
// serverId doesn't match any current server row (deleted server-side, or
// simply not synced yet) is preserved unchanged, same as a product with no
// serverId at all (Rule 5) — this function only ever adds or updates, it
// never removes a local product on its own.
export function reconcileCatalog(
  localProducts: DraftProduct[],
  server: CatalogSnapshot,
  computeStatus: ComputeStatus
): DraftProduct[] {
  const listingsByProduct = new Map<string, CatalogListingRow[]>()
  for (const listing of server.listings) {
    const list = listingsByProduct.get(listing.product_id) ?? []
    list.push(listing)
    listingsByProduct.set(listing.product_id, list)
  }

  const approvalsByListing = new Map(server.approvals.map((a) => [a.listing_id, a]))

  const localByServerId = new Map<string, DraftProduct>()
  for (const p of localProducts) {
    if (p.serverId) localByServerId.set(p.serverId, p)
  }

  const mergedServerIds = new Set<string>()
  const reconciled: DraftProduct[] = []

  for (const serverProduct of server.products) {
    const listings = listingsByProduct.get(serverProduct.id) ?? []
    const localMatch = localByServerId.get(serverProduct.id)
    if (localMatch) {
      reconciled.push(mergeDraftWithServer(localMatch, serverProduct, listings, approvalsByListing, computeStatus))
      mergedServerIds.add(serverProduct.id)
    } else {
      reconciled.push(buildDraftFromServer(serverProduct, listings, approvalsByListing, computeStatus))
    }
  }

  for (const local of localProducts) {
    if (!local.serverId || !mergedServerIds.has(local.serverId)) {
      reconciled.push(local)
    }
  }

  return reconciled
}
