import { shapeForPlatform, SUPPORTED_MARKETPLACES, MARKETPLACE_LABELS } from './platformShapers'
import { computeListingHealth, type GenerationMeta } from './listingHealth'
import { flattenRow, exportColumns } from './exportShapers'
import type { Marketplace } from './types'
import type { ProductIntelligenceData } from './productIntelligence'

// Milestone C10 (Phase 10K): Marketplace Adapter Architecture.
//
// This module is deliberately a thin, deterministic WRAPPER around three
// already-existing, already-tested, already-live-verified modules: it does
// not reimplement shaping, validation, or export logic:
//   - lib/platformShapers.ts's shapeForPlatform()   -> adapter.shape()
//   - lib/listingHealth.ts's computeListingHealth() -> adapter.validate()
//   - lib/exportShapers.ts's flattenRow()           -> adapter.exportRow()
// Wrapping (not rewriting) means every existing test, every existing live
// behavior, and every existing caller of those three functions is
// completely unaffected by this file's existence: C1-C9 regression risk
// from this module is structurally as close to zero as a new file can be.
//
// The "canonical product" concept (C8 raw fields + C9 intelligence) is
// intentionally marketplace-neutral: CanonicalProduct never contains a
// marketplace key or any marketplace-specific field name. Adapters are the
// only place marketplace-specific shape/rule knowledge lives.

// The one piece of "canonical product" data shapeForPlatform's existing
// third parameter already reads (product.brand_name, for Myntra's
// productDisplayName): narrowed into a named type instead of the `any` it
// was typed as before, with no change to shapeForPlatform's own signature
// or behavior. `intelligence` is included for completeness per C9's field
// list and so callers have one place to pass it, but note it is NOT read
// directly by shape() below: by the time shape() runs, the AI's own output
// already reflects whatever intelligence was injected into the generation
// prompt (see app/api/generate-single/route.ts's buildIntelligenceSummary,
// C9's own generation-integration point). Re-reading it here would risk a
// second, independent (and possibly contradictory) interpretation of the
// same facts: exactly what the spec's "never re-infer/duplicate" rule
// prohibits.
export type CanonicalProduct = {
  brandName: string | null
  description: string | null
  category: string | null
  imageUrl: string | null
  intelligence: ProductIntelligenceData | null
}

export type MarketplaceReadinessIssue = {
  field: string
  severity: 'error' | 'warning'
  message: string
  marketplace: Marketplace
}

// Deliberately simpler than lib/listingHealth.ts's own 4-state ListingHealth
// (ready/needs-review/missing-data/error, plus percentComplete): that
// richer model already exists, is already displayed in the workspace UI,
// and is NOT duplicated or replaced here (§8 only asks for a readiness
// result "if the existing architecture does not already provide one"; the
// richer one already does, this is an adapter-contract-level view derived
// from it). READY means every check computeListingHealth ran actually
// passed; anything else collapses to NOT_READY with the specific failing
// checks surfaced as issues, so "AI generated something" is never confused
// with "marketplace-ready."
export type MarketplaceReadiness = {
  status: 'READY' | 'NOT_READY'
  issues: MarketplaceReadinessIssue[]
}

export type MarketplaceAdapter = {
  marketplace: Marketplace
  label: string
  // Deterministic content shaping: no AI call happens here or anywhere in
  // this module. `ai` is the model's already-generated raw output (see
  // AiResult in platformShapers.ts); shaping only formats/enforces limits.
  shape: (ai: Parameters<typeof shapeForPlatform>[1], product: CanonicalProduct) => any
  // Runs AFTER shape(): validates the shaped output, never silently
  // fixes it. Mirrors computeListingHealth's exact signature/semantics.
  validate: (content: unknown, generationError: string | null, meta: GenerationMeta | null) => MarketplaceReadiness
  // Export-ready flat row for this marketplace's already-shaped content, or
  // null if the content can't be flattened (mirrors flattenRow's own
  // contract exactly: same function, not reimplemented).
  exportRow: (content: unknown) => Record<string, string> | null
  exportColumns: string[]
}

function toReadiness(marketplace: Marketplace, content: unknown, generationError: string | null, meta: GenerationMeta | null): MarketplaceReadiness {
  const health = computeListingHealth(marketplace, content ?? null, generationError, meta)

  if (health.status === 'ready') {
    return { status: 'READY', issues: [] }
  }

  const issues: MarketplaceReadinessIssue[] = health.checks
    .filter((check) => check.applicable && !check.passed)
    .map((check) => ({
      field: check.label,
      // A missing-data/error listing's failing checks are hard blockers;
      // a needs-review listing's failing checks (e.g. a length overage on
      // an otherwise-complete listing) are real but softer: same
      // distinction the existing ListingHealthBadge already draws in the
      // UI, carried into this adapter-level view rather than collapsed.
      severity: health.status === 'needs-review' ? 'warning' : 'error',
      message: [check.detail, check.subDetail].filter(Boolean).join(': ') || `${check.label} check failed`,
      marketplace
    }))

  return { status: 'NOT_READY', issues }
}

function buildAdapter(marketplace: Marketplace): MarketplaceAdapter {
  return {
    marketplace,
    label: MARKETPLACE_LABELS[marketplace],
    shape: (ai, product) => shapeForPlatform(marketplace, ai, { brand_name: product.brandName }),
    validate: (content, generationError, meta) => toReadiness(marketplace, content, generationError, meta),
    exportRow: (content) => flattenRow(marketplace, content),
    exportColumns: exportColumns[marketplace] ?? []
  }
}

// Built once, one adapter per genuinely-supported marketplace: never
// includes a "shopify" (or any other) entry that isn't independently
// verified elsewhere in the codebase (SUPPORTED_MARKETPLACES,
// MARKETPLACE_RULES, exportColumns all agree on exactly these four; see the
// C10 audit report for the explicit three-source confirmation that Shopify
// has no grounding in this repository today).
export const MARKETPLACE_ADAPTERS: Record<Marketplace, MarketplaceAdapter> = Object.fromEntries(
  SUPPORTED_MARKETPLACES.map((m) => [m, buildAdapter(m)])
) as Record<Marketplace, MarketplaceAdapter>

// C10-AC4: the one adapter-selection entry point. Returns undefined for
// any marketplace this project doesn't genuinely support (e.g. 'shopify',
// 'tatacliq') rather than fabricating a fallback adapter: callers must
// treat undefined as "not supported," the same way shapeForPlatform's own
// `default` branch and flattenRow's `default: return null` already do at
// the layer below this one.
export function getMarketplaceAdapter(marketplace: string): MarketplaceAdapter | undefined {
  return MARKETPLACE_ADAPTERS[marketplace as Marketplace]
}
