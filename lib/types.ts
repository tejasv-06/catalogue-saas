import { SUPPORTED_MARKETPLACES } from './platformShapers'
import type { GenerationMeta } from './listingHealth'

export type Marketplace = (typeof SUPPORTED_MARKETPLACES)[number]

// Every product can now be generated for multiple marketplaces independently
// — one credit-metered generate-single call per (product, marketplace) pair.
// Each of these three is a full record (every marketplace key always
// present, defaulting to null/false), not a partial/sparse map — that way
// `product.generatedContent[marketplace]` is always safe to read directly,
// no `?.` or `in` check needed anywhere that consumes it.
export type MarketplaceContentMap = Record<Marketplace, any | null>
export type MarketplaceApprovalMap = Record<Marketplace, boolean>
export type MarketplaceErrorMap = Record<Marketplace, string | null>
// Real, per-generation facts (title truncation, bullet count — see
// lib/listingHealth.ts) used to compute Listing Health. null until that
// marketplace has actually been generated at least once; also null for
// content restored from a saved session created before this field existed
// — computeListingHealth already treats a missing meta as "assume not
// truncated" rather than a false failure, so this is safe to be sparse.
export type MarketplaceMetaMap = Record<Marketplace, GenerationMeta | null>

export type DraftProduct = {
  id: string
  brandName: string
  description: string
  category: string
  imageFile: File | null
  imageUrl: string | null
  generatedContent: MarketplaceContentMap
  approved: MarketplaceApprovalMap
  // Generation progress only — approval is tracked independently per
  // marketplace in `approved` above, so this never encodes "approved."
  // 'partial' covers the case where some but not all of a generation run's
  // marketplaces succeeded for this product (e.g. credits ran out between
  // the first and second marketplace) — see computeProductStatus in
  // CatalogueWorkspace.
  status: 'draft' | 'partial' | 'generated'
  generationError: MarketplaceErrorMap
  skipBrandVoice: boolean
  // Both new, additive fields — always present (defaulted) on products
  // created going forward. A product restored from a saved session created
  // before this shipped won't actually have these keys after JSON.parse
  // despite what the type claims, so every read site uses `?.`/`??`
  // defensively rather than assuming the type is honored at runtime —
  // same reasoning as generationError before it, just without needing a
  // SESSION_SCHEMA_VERSION bump since nothing here is a breaking shape
  // change (old sessions still restore, they just show no health meta /
  // no detected attributes until regenerated).
  generationMeta: MarketplaceMetaMap
  // Set once per product, not per marketplace — describes the product's
  // photo, not any one marketplace's listing. Null until an image-based
  // generation actually returns attributes (see computeGenerationMeta's
  // sibling `visualAttributes` in the API response).
  visualAttributes: Record<string, string | null> | null
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
