import { SUPPORTED_MARKETPLACES } from './platformShapers'

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
