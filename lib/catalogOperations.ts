import type { DraftProduct, Marketplace } from './types'
import { SUPPORTED_MARKETPLACES } from './platformShapers'
import { computeListingHealth } from './listingHealth'
import type { ExportCandidateItem } from './exportReadiness'

// Milestone C14 (Seller Operations & Catalog Management Engine) — pure,
// derived catalog-command-center logic. Every function here is a VIEW over
// state that already exists on DraftProduct; nothing here persists
// anything, computes a new score, or duplicates C9/C10/C11's own rules —
// "attempted" (content !== null || error !== null) and per-row health both
// come from the exact same computeListingHealth call every other part of
// the app already uses (QueueTable, computeListingSummary in
// CatalogueWorkspace.tsx). This module only adds: needs-attention
// detection, product-level search/filter, and sorting — the "which rows
// exist and in what order" layer, not a new judgment about readiness.

// --- Needs Attention -------------------------------------------------

export type AttentionItem = {
  productId: string
  marketplace: Marketplace
  status: 'error' | 'missing-data'
  reason: string
}

// Only ever considers a (product, marketplace) pair that's actually been
// attempted (content or error present) — a product that hasn't been
// generated yet is "not started," not "needs attention." Mirrors the exact
// attempted-check computeListingSummary already uses.
export function computeNeedsAttention(products: DraftProduct[]): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const product of products) {
    for (const marketplace of SUPPORTED_MARKETPLACES) {
      const content = product.generatedContent[marketplace]
      const error = product.generationError[marketplace]
      if (content === null && error === null) continue

      const health = computeListingHealth(marketplace, content, error, product.generationMeta[marketplace])
      if (health.status !== 'error' && health.status !== 'missing-data') continue

      const failedCheck = health.checks.find((c) => c.applicable && !c.passed)
      items.push({
        productId: product.id,
        marketplace,
        status: health.status,
        reason: failedCheck?.detail || (health.status === 'error' ? 'Generation failed' : 'Missing required data')
      })
    }
  }
  return items
}

// --- Search / Filters -------------------------------------------------

export type ApprovalFilter = 'all' | 'approved' | 'unapproved' | 'partially-approved'

export type ProductFilters = {
  search: string
  brand: string // 'all' or an exact brandName value drawn from getAvailableBrands
  category: string // 'all' or an exact category value drawn from getAvailableCategories
  marketplace: Marketplace | 'all' // matches products that have ATTEMPTED this marketplace
  approval: ApprovalFilter
  attentionOnly: boolean
}

export const DEFAULT_PRODUCT_FILTERS: ProductFilters = {
  search: '',
  brand: 'all',
  category: 'all',
  marketplace: 'all',
  approval: 'all',
  attentionOnly: false
}

export function hasActiveFilters(filters: ProductFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.brand !== 'all' ||
    filters.category !== 'all' ||
    filters.marketplace !== 'all' ||
    filters.approval !== 'all' ||
    filters.attentionOnly
  )
}

// Real values only — populated from whatever the seller has actually
// entered, never a fabricated taxonomy. Sorted, de-duplicated, blanks
// excluded (a product with no brand/category shouldn't produce a
// meaningless "" filter option).
export function getAvailableBrands(products: DraftProduct[]): string[] {
  const set = new Set(products.map((p) => p.brandName?.trim()).filter((v): v is string => !!v))
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

export function getAvailableCategories(products: DraftProduct[]): string[] {
  const set = new Set(products.map((p) => p.category?.trim()).filter((v): v is string => !!v))
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

function attemptedMarketplacesOf(product: DraftProduct): Marketplace[] {
  return SUPPORTED_MARKETPLACES.filter((m) => product.generatedContent[m] !== null || product.generationError[m] !== null)
}

function matchesApprovalFilter(product: DraftProduct, filter: ApprovalFilter): boolean {
  if (filter === 'all') return true
  const attempted = attemptedMarketplacesOf(product)
  const approvedCount = attempted.filter((m) => product.approved[m]).length

  if (filter === 'unapproved') return attempted.length > 0 && approvedCount === 0
  if (filter === 'approved') return attempted.length > 0 && approvedCount === attempted.length
  // partially-approved: at least one approved, at least one attempted-but-not-approved
  return approvedCount > 0 && approvedCount < attempted.length
}

function matchesSearch(product: DraftProduct, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    product.brandName?.toLowerCase().includes(q) ||
    product.category?.toLowerCase().includes(q) ||
    product.description?.toLowerCase().includes(q) ||
    false
  )
}

export function matchesProductFilters(product: DraftProduct, filters: ProductFilters, attentionProductIds: Set<string>): boolean {
  if (filters.attentionOnly && !attentionProductIds.has(product.id)) return false
  if (!matchesSearch(product, filters.search)) return false
  if (filters.brand !== 'all' && product.brandName !== filters.brand) return false
  if (filters.category !== 'all' && product.category !== filters.category) return false
  if (filters.marketplace !== 'all' && !attemptedMarketplacesOf(product).includes(filters.marketplace)) return false
  if (!matchesApprovalFilter(product, filters.approval)) return false
  return true
}

export function filterProducts(products: DraftProduct[], filters: ProductFilters): DraftProduct[] {
  if (!filters.attentionOnly && !hasActiveFilters(filters)) return products
  const attentionProductIds = filters.attentionOnly ? new Set(computeNeedsAttention(products).map((i) => i.productId)) : new Set<string>()
  return products.filter((p) => matchesProductFilters(p, filters, attentionProductIds))
}

// --- Export candidate gathering -------------------------------------------------

// Milestone C11 (originally inline in CatalogueWorkspace.tsx, moved here for
// C15 reuse) — the exact inputs lib/exportReadiness.ts's
// evaluateMarketplaceExportReadiness() needs for one marketplace, gathered
// from every approved row for that marketplace (same eligibility rule
// computeExportableCounts uses — approved[marketplace], not health/Ready
// status). Pure extraction, no marketplace-rule logic lives here; that's
// entirely inside the C10 adapter this data gets handed to. Both
// CatalogueWorkspace.tsx's own export flow and lib/catalogRecommendations.ts
// (C15) call this exact function so a marketplace's export-readiness
// verdict can never drift between the two.
export function gatherExportCandidateItems(products: DraftProduct[], marketplace: Marketplace): ExportCandidateItem[] {
  return products
    .filter((p) => p.approved[marketplace])
    .map((p) => ({
      productId: p.id,
      content: p.generatedContent[marketplace],
      generationError: p.generationError[marketplace],
      meta: p.generationMeta[marketplace]
    }))
}

// --- Sorting -------------------------------------------------

export type ProductSortKey = 'newest' | 'oldest' | 'brand-az' | 'brand-za' | 'attention-first'

export const SORT_OPTIONS: { id: ProductSortKey; label: string }[] = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'brand-az', label: 'Brand A-Z' },
  { id: 'brand-za', label: 'Brand Z-A' },
  { id: 'attention-first', label: 'Needs attention first' }
]

// draftProducts is already creation-ordered (each add appends) — "newest
// first" is therefore a plain reverse, not a timestamp sort (DraftProduct
// carries no created-at field of its own to sort by).
export function sortProducts(products: DraftProduct[], key: ProductSortKey): DraftProduct[] {
  const copy = [...products]
  switch (key) {
    case 'oldest':
      return copy
    case 'newest':
      return copy.reverse()
    case 'brand-az':
      return copy.sort((a, b) => (a.brandName || '').localeCompare(b.brandName || ''))
    case 'brand-za':
      return copy.sort((a, b) => (b.brandName || '').localeCompare(a.brandName || ''))
    case 'attention-first': {
      const attentionIds = new Set(computeNeedsAttention(products).map((i) => i.productId))
      return copy.sort((a, b) => Number(attentionIds.has(b.id)) - Number(attentionIds.has(a.id)))
    }
    default:
      return copy
  }
}
