import { SUPPORTED_MARKETPLACES } from './platformShapers'
import type { GenerationMeta } from './listingHealth'
import type { ProductIntelligence } from './productIntelligence'

export type Marketplace = (typeof SUPPORTED_MARKETPLACES)[number]

// Every product can now be generated for multiple marketplaces independently
//: one credit-metered generate-single call per (product, marketplace) pair.
// Each of these three is a full record (every marketplace key always
// present, defaulting to null/false), not a partial/sparse map: that way
// `product.generatedContent[marketplace]` is always safe to read directly,
// no `?.` or `in` check needed anywhere that consumes it.
export type MarketplaceContentMap = Record<Marketplace, any | null>
export type MarketplaceApprovalMap = Record<Marketplace, boolean>
export type MarketplaceErrorMap = Record<Marketplace, string | null>
// Real, per-generation facts (title truncation, bullet count: see
// lib/listingHealth.ts) used to compute Listing Health. null until that
// marketplace has actually been generated at least once; also null for
// content restored from a saved session created before this field existed
//: computeListingHealth already treats a missing meta as "assume not
// truncated" rather than a false failure, so this is safe to be sparse.
export type MarketplaceMetaMap = Record<Marketplace, GenerationMeta | null>

// Milestone C17.1: Manual Entry's multi-image cap, and one slot in its
// in-progress (not-yet-submitted) image picker. A slot is either a freshly
// picked, not-yet-uploaded File, or an already-uploaded/persisted URL:
// never both at once, mirroring the existing single-image imageFile/imageUrl
// mutual-exclusivity, just per-slot. Purely form state (LeftPanel/
// CatalogueWorkspace); DraftProduct.imageUrls above is always the resolved
// string[] once a slot's file (if any) has been uploaded.
export const MAX_MANUAL_IMAGES = 5

export type ManualImageSlot = {
  file: File | null
  url: string | null
}

export type DraftProduct = {
  id: string
  // Milestone 22 (Step C2): the server-side catalog_products.id once a
  // catalog dual-write has actually created one, additive and optional so
  // every existing read site (including a session restored from before this
  // field existed) stays correct without a schema-version bump. `id` above
  // remains the sole client-local identity used everywhere in the UI; this
  // is never used as a React key or for any existing lookup/comparison.
  serverId?: string
  // Milestone 23 (Step C3): per-marketplace catalog_listings.id, populated
  // once the corresponding C2 upsertListing() call has actually succeeded.
  // Sparse/optional like serverId above, for the same reason: a marketplace
  // with no entry here means "no persisted listing yet" (dual-write never
  // ran, hasn't succeeded yet, or predates C2): approval/export persistence
  // (CatalogueWorkspace) must treat that as "skip," never invent an id.
  listingServerIds?: Partial<Record<Marketplace, string>>
  brandName: string
  description: string
  category: string
  imageFile: File | null
  imageUrl: string | null
  // Milestone C17.1: up to MAX_MANUAL_IMAGES uploaded image URLs, in the
  // seller's chosen display order; imageUrl above always mirrors
  // imageUrls[0] (or null when empty) so every existing single-image
  // consumer (generation, Product Intelligence, thumbnails, exports) keeps
  // working unchanged, reading only the primary image. Always populated at
  // every construction site going forward (commitAddProduct, CSV bulk
  // upload, catalog hydration): a product legitimately has zero images,
  // never a missing field, so this is required, not optional, in the type.
  // A product restored from a saved LOCAL session created before this
  // shipped won't actually have this key after JSON.parse despite what the
  // type claims (same caveat as generationMeta/visualAttributes below):
  // the one restore call site falls back to imageUrl-as-a-single-element-
  // array for that case.
  imageUrls: string[]
  generatedContent: MarketplaceContentMap
  approved: MarketplaceApprovalMap
  // Generation progress only: approval is tracked independently per
  // marketplace in `approved` above, so this never encodes "approved."
  // 'partial' covers the case where some but not all of a generation run's
  // marketplaces succeeded for this product (e.g. credits ran out between
  // the first and second marketplace): see computeProductStatus in
  // CatalogueWorkspace.
  status: 'draft' | 'partial' | 'generated'
  generationError: MarketplaceErrorMap
  skipBrandVoice: boolean
  // Both new, additive fields: always present (defaulted) on products
  // created going forward. A product restored from a saved session created
  // before this shipped won't actually have these keys after JSON.parse
  // despite what the type claims, so every read site uses `?.`/`??`
  // defensively rather than assuming the type is honored at runtime:
  // same reasoning as generationError before it, just without needing a
  // SESSION_SCHEMA_VERSION bump since nothing here is a breaking shape
  // change (old sessions still restore, they just show no health meta /
  // no detected attributes until regenerated).
  generationMeta: MarketplaceMetaMap
  // Set once per product, not per marketplace: describes the product's
  // photo, not any one marketplace's listing. Null until an image-based
  // generation actually returns attributes (see computeGenerationMeta's
  // sibling `visualAttributes` in the API response).
  visualAttributes: Record<string, string | null> | null
  // Milestone 32 (C9): canonical Product Intelligence, additive/optional
  // like serverId above: absent entirely for a product added before this
  // shipped (until it's re-hydrated from the server or explicitly
  // analyzed), present-but-null-status only after being fetched/reconciled.
  // Distinct from visualAttributes above: that's a narrow, 4-key byproduct
  // of ONE marketplace's generation call; this is the richer, pre-generation
  // canonical layer, set via a dedicated "Analyze Product" action.
  productIntelligence?: ProductIntelligence | null
}

function emptyMarketplaceRecord<T>(fill: T): Record<Marketplace, T> {
  return Object.fromEntries(SUPPORTED_MARKETPLACES.map((m) => [m, fill])) as Record<Marketplace, T>
}

export function emptyGeneratedContent(): MarketplaceContentMap {
  return emptyMarketplaceRecord(null)
}

export function emptyApproved(): MarketplaceApprovalMap {
  return emptyMarketplaceRecord(false)
}

export function emptyGenerationError(): MarketplaceErrorMap {
  return emptyMarketplaceRecord(null)
}

export function emptyGenerationMeta(): MarketplaceMetaMap {
  return emptyMarketplaceRecord(null)
}

export type CsvSummary = {
  fileName: string
  total: number
  added: number
  skipped: number
}

export type PendingCsvUpload = {
  fileName: string
  total: number
  matchingProducts: DraftProduct[]
  mismatchedProducts: DraftProduct[]
}
