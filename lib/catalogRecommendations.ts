import type { DraftProduct, Marketplace } from './types'
import { SUPPORTED_MARKETPLACES, MARKETPLACE_LABELS } from './platformShapers'
import { computeListingHealth } from './listingHealth'
import { getMarketplaceAdapter, type MarketplaceReadinessIssue } from './marketplaceAdapters'
import { evaluateMarketplaceExportReadiness } from './exportReadiness'
import { gatherExportCandidateItems } from './catalogOperations'
import { CREDIT_COSTS } from './creditCosts'

// Milestone C15 — Catalog Intelligence & Action Center.
//
// This module is a PURE DERIVATION layer, not a new source of truth. It
// answers "what should the seller do next," by reading the exact same
// already-computed facts every other part of the app already computes and
// displays — C9's product_intelligence, C10's computeListingHealth /
// getMarketplaceAdapter().validate(), C11's evaluateMarketplaceExportReadiness,
// and DraftProduct's own approved/generatedContent state (C14's own domain).
// It never re-derives a marketplace rule, a length limit, a health check, or
// a readiness verdict — every judgment here is a direct read of one of
// those functions' own output, reformatted into a recommendation.
//
// Nothing in this file performs a mutation, a network call, or a credit
// operation — computeCatalogRecommendations is 100% synchronous and
// side-effect-free, so simply calling it (e.g. on every render) can never
// spend a credit, call an AI, or write to the database. Executing a
// recommendation is the caller's job (CatalogueWorkspace.tsx dispatches to
// the exact same handlers QueueTable/the drawer already use).

export type RecommendationActionType =
  | 'ANALYZE'
  | 'GENERATE'
  | 'FIX_LISTING'
  | 'COMPLETE_INFORMATION'
  | 'APPROVE'
  | 'EXPORT'
  | 'REVIEW_BRAND'

export type RecommendationPriority = 'critical' | 'high' | 'medium' | 'low'

export type RecommendationSource =
  | 'product_intelligence'
  | 'listing_health'
  | 'marketplace_readiness'
  | 'catalog_operations'
  | 'brand_profile'

export type CatalogActionRecommendation = {
  id: string
  productId?: string
  marketplace?: Marketplace
  actionType: RecommendationActionType
  priority: RecommendationPriority
  title: string
  reason: string
  details?: string
  creditCost?: number
  blockingIssues?: string[]
  source: RecommendationSource
  productName?: string
}

// Deliberately NOT importing components/ClientSelector's Client type here —
// lib/ modules stay independent of components/. Any object with these two
// fields (the real Client type included, via structural typing) satisfies
// this, including `selectedClient` as CatalogueWorkspace.tsx already has it.
export type BrandProfileContext = {
  brand_voice?: string | null
  target_audience?: string | null
} | null

const PRIORITY_RANK: Record<RecommendationPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 }

function productDisplayName(product: DraftProduct): string {
  return product.brandName?.trim() || 'Untitled product'
}

// --- C9 product intelligence -> ANALYZE / COMPLETE_INFORMATION ------------

function intelligenceRecommendations(product: DraftProduct): CatalogActionRecommendation[] {
  const intel = product.productIntelligence
  const name = productDisplayName(product)

  if (!intel || intel.status === 'not_started') {
    // Analyzing requires a persisted catalog_products row (C9's own
    // requirement — see app/api/enrich-product/route.ts and the drawer's
    // own `disabled={!product.serverId}` guard). A product that hasn't
    // been persisted yet (guest, or a create-product write still in
    // flight) simply has no recommendation here yet, rather than one whose
    // action button would silently do nothing.
    if (!product.serverId) return []
    return [
      {
        id: `analyze:${product.id}`,
        productId: product.id,
        actionType: 'ANALYZE',
        priority: 'high',
        title: `Analyze ${name}`,
        reason: 'This product has no product intelligence yet.',
        creditCost: 0,
        source: 'product_intelligence',
        productName: name
      }
    ]
  }

  // A request is already in flight — recommending Analyze again would just
  // invite a second, redundant call (the route itself would reject it with
  // 409, but the recommendation should never suggest a dead-end action).
  if (intel.status === 'processing') return []

  if (intel.status === 'failed') {
    return [
      {
        id: `analyze-retry:${product.id}`,
        productId: product.id,
        actionType: 'ANALYZE',
        priority: 'high',
        title: `Retry analysis for ${name}`,
        reason: intel.error ? `Product analysis failed: ${intel.error}` : 'Product analysis failed.',
        creditCost: 0,
        source: 'product_intelligence',
        productName: name
      }
    ]
  }

  // completed — only actionable when C9's own analysis reported something
  // genuinely missing; never fabricated beyond what missing_information
  // already says.
  if (intel.missing_information.length > 0) {
    return [
      {
        id: `complete-info:${product.id}`,
        productId: product.id,
        actionType: 'COMPLETE_INFORMATION',
        priority: 'medium',
        title: `Review product information for ${name}`,
        reason: `Product intelligence reports missing information: ${intel.missing_information.join(', ')}.`,
        blockingIssues: intel.missing_information,
        source: 'product_intelligence',
        productName: name
      }
    ]
  }

  return []
}

// --- C10/C14 listing health + adapter readiness -> GENERATE / FIX / APPROVE ---

// Prefers the "Required fields" issue's own message verbatim (already a
// clean, combined "Missing: a, b, c" sentence from lib/listingHealth.ts) —
// falls back to joining every issue's own message when there's no single
// combined one, but never invents new wording of its own.
function buildFixReason(issues: MarketplaceReadinessIssue[]): string {
  const requiredFieldsIssue = issues.find((i) => i.field === 'Required fields')
  if (requiredFieldsIssue) return requiredFieldsIssue.message
  return issues.map((i) => i.message).join('; ')
}

function listingRecommendations(product: DraftProduct): CatalogActionRecommendation[] {
  const name = productDisplayName(product)
  const recs: CatalogActionRecommendation[] = []

  for (const marketplace of SUPPORTED_MARKETPLACES) {
    const content = product.generatedContent[marketplace]
    const error = product.generationError[marketplace]
    const attempted = content !== null || error !== null
    const label = MARKETPLACE_LABELS[marketplace]

    if (!attempted) {
      recs.push({
        id: `generate:${product.id}:${marketplace}`,
        productId: product.id,
        marketplace,
        actionType: 'GENERATE',
        priority: 'high',
        title: `Generate ${label} listing`,
        reason: `${label} listing has not been generated yet.`,
        creditCost: CREDIT_COSTS.listingGeneration,
        source: 'listing_health',
        productName: name
      })
      continue
    }

    // Same computeListingHealth call QueueTable/the drawer already render
    // from — a true generation failure (no usable content at all) is
    // reported here exactly as it already is everywhere else.
    const health = computeListingHealth(marketplace, content, error, product.generationMeta[marketplace])

    if (health.status === 'error') {
      recs.push({
        id: `fix:${product.id}:${marketplace}`,
        productId: product.id,
        marketplace,
        actionType: 'FIX_LISTING',
        priority: 'critical',
        title: `Fix ${label} listing`,
        reason: `${label} listing generation failed and cannot proceed: ${error ?? 'unknown error'}.`,
        blockingIssues: [error ?? 'Generation failed'],
        creditCost: CREDIT_COSTS.listingGeneration,
        source: 'listing_health',
        productName: name
      })
      continue
    }

    // From here on, C10's own adapter is the ONLY authority on readiness —
    // never a second, independently-derived judgment about this listing.
    const adapter = getMarketplaceAdapter(marketplace)
    const readiness = adapter ? adapter.validate(content, error, product.generationMeta[marketplace]) : null

    if (readiness && readiness.status === 'NOT_READY') {
      // computeListingHealth's own severity split (see marketplaceAdapters.ts's
      // toReadiness): a 'missing-data'/'error' health status produces
      // error-severity issues (blocking), 'needs-review' produces
      // warning-severity ones (non-blocking) — reused verbatim, not
      // re-derived.
      const hasBlockingIssue = readiness.issues.some((i) => i.severity === 'error')
      recs.push({
        id: `fix:${product.id}:${marketplace}`,
        productId: product.id,
        marketplace,
        actionType: 'FIX_LISTING',
        priority: hasBlockingIssue ? 'critical' : 'medium',
        title: hasBlockingIssue ? `Fix ${label} listing` : `Review ${label} listing`,
        reason: buildFixReason(readiness.issues),
        blockingIssues: readiness.issues.map((i) => (i.message ? `${i.field}: ${i.message}` : i.field)),
        source: 'marketplace_readiness',
        productName: name
      })
      continue
    }

    // READY per the adapter, but not yet approved — the natural next step.
    if (!product.approved[marketplace]) {
      recs.push({
        id: `approve:${product.id}:${marketplace}`,
        productId: product.id,
        marketplace,
        actionType: 'APPROVE',
        priority: 'medium',
        title: `Approve ${label} listing`,
        reason: `${label} listing passes all marketplace readiness checks and is ready to approve.`,
        source: 'marketplace_readiness',
        productName: name
      })
    }
    // READY + approved: no per-item recommendation here — export eligibility
    // is judged at the marketplace-batch level (exportRecommendations
    // below), exactly like C11's own export flow, never per single item.
  }

  return recs
}

// --- C11 export readiness -> EXPORT (batch-level, per marketplace) -------

// Never recommends Export unless lib/exportReadiness.ts's own
// evaluateMarketplaceExportReadiness says READY — no independent readiness
// calculation exists in this file.
function exportRecommendations(products: DraftProduct[]): CatalogActionRecommendation[] {
  const recs: CatalogActionRecommendation[] = []
  for (const marketplace of SUPPORTED_MARKETPLACES) {
    const items = gatherExportCandidateItems(products, marketplace)
    if (items.length === 0) continue
    const result = evaluateMarketplaceExportReadiness(marketplace, items)
    if (result.status !== 'READY') continue
    const label = MARKETPLACE_LABELS[marketplace]
    recs.push({
      id: `export:${marketplace}`,
      marketplace,
      actionType: 'EXPORT',
      priority: 'medium',
      title: `Export ${label} listings`,
      reason: `${result.itemCount} ${label} listing${result.itemCount === 1 ? '' : 's'} approved and passing all marketplace readiness checks.`,
      source: 'marketplace_readiness'
    })
  }
  return recs
}

// --- C12 brand profile -> REVIEW_BRAND ------------------------------------

// Only ever fires when a brand/client IS selected (no brand context ->
// nothing to review) — never makes C9/C10 depend on these fields, purely
// an informational nudge.
function brandRecommendation(client: BrandProfileContext): CatalogActionRecommendation[] {
  if (!client) return []
  const missing: string[] = []
  if (!client.brand_voice || !client.brand_voice.trim()) missing.push('brand voice')
  if (!client.target_audience || !client.target_audience.trim()) missing.push('target audience')
  if (missing.length === 0) return []

  return [
    {
      id: 'review-brand',
      actionType: 'REVIEW_BRAND',
      priority: 'medium',
      title: 'Complete brand profile',
      reason: `Brand profile is missing ${missing.join(' and ')}, which can improve generation quality.`,
      blockingIssues: missing,
      source: 'brand_profile'
    }
  ]
}

// --- Sorting / filtering / summary -----------------------------------------

// Array.prototype.sort is guaranteed stable (ES2019+), and recommendations
// are generated in a fixed order (products in their existing array order,
// marketplaces in SUPPORTED_MARKETPLACES order) — so two equal-priority
// recommendations always come out in the same relative order for the same
// input, with no separate tiebreak key needed for determinism.
export function sortRecommendations(recs: CatalogActionRecommendation[]): CatalogActionRecommendation[] {
  return [...recs].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
}

export function summarizeByPriority(recs: CatalogActionRecommendation[]): Record<RecommendationPriority, number> {
  const summary: Record<RecommendationPriority, number> = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const r of recs) summary[r.priority]++
  return summary
}

export type RecommendationPriorityFilter = RecommendationPriority | 'all'

export function filterRecommendationsByPriority(
  recs: CatalogActionRecommendation[],
  filter: RecommendationPriorityFilter
): CatalogActionRecommendation[] {
  if (filter === 'all') return recs
  return recs.filter((r) => r.priority === filter)
}

// --- Entry point -----------------------------------------------------------

// Pure and synchronous — no network, no database, no AI call, no mutation.
// Safe to call on every render (or wrap in useMemo, as
// CatalogueWorkspace.tsx does) without any side effect whatsoever.
export function computeCatalogRecommendations(
  products: DraftProduct[],
  brandContext: BrandProfileContext = null
): CatalogActionRecommendation[] {
  const recs: CatalogActionRecommendation[] = []
  for (const product of products) {
    recs.push(...intelligenceRecommendations(product))
    recs.push(...listingRecommendations(product))
  }
  recs.push(...exportRecommendations(products))
  recs.push(...brandRecommendation(brandContext))
  return sortRecommendations(recs)
}
