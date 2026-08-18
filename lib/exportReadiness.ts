import { getMarketplaceAdapter, type MarketplaceReadinessIssue } from './marketplaceAdapters'
import type { GenerationMeta } from './listingHealth'
import type { Marketplace } from './types'

// Milestone C11 (Phase 10L): Export Readiness Gate. A pure aggregation
// layer ON TOP of C10's adapter.validate(): this file does not implement
// any marketplace rule, shaping, or validation logic itself. It answers
// exactly one question C10 doesn't: "given several approved (product,
// marketplace) rows queued for a single marketplace's export file, is that
// WHOLE marketplace ready to export?" That's an export-batch concept, not a
// per-listing one, so it doesn't belong in lib/marketplaceAdapters.ts
// itself: but it calls that module for every real judgment it makes.

export type ExportReadinessStatus = 'READY' | 'MISSING_FIELDS' | 'NOT_READY'

export type MarketplaceExportReadiness = {
  marketplace: Marketplace
  status: ExportReadinessStatus
  issues: MarketplaceReadinessIssue[]
  itemCount: number
}

// The exact inputs adapter.validate() (and computeListingHealth beneath it)
// already needs for one (product, marketplace) pair: nothing new invented.
export type ExportCandidateItem = {
  productId: string
  content: unknown
  generationError: string | null
  meta: GenerationMeta | null
}

// One marketplace's worth of already-approved rows -> one aggregated
// readiness result. Three-way status is derived purely from the SAME
// error/warning severity C10's adapter.validate() already assigns (never a
// new marketplace rule): any error-severity issue anywhere -> NOT_READY;
// only warning-severity issues -> MISSING_FIELDS; no issues at all -> READY.
// Matches the milestone's own example (Flipkart "2 fields missing" =
// warning-level = MISSING_FIELDS; Myntra "required attribute missing" =
// error-level = NOT_READY).
export function evaluateMarketplaceExportReadiness(
  marketplace: Marketplace,
  items: ExportCandidateItem[]
): MarketplaceExportReadiness {
  if (items.length === 0) {
    return {
      marketplace,
      status: 'NOT_READY',
      issues: [{ field: 'Listings', severity: 'error', message: 'No approved listings for this marketplace', marketplace }],
      itemCount: 0
    }
  }

  const adapter = getMarketplaceAdapter(marketplace)
  if (!adapter) {
    // Never silently treat an unsupported marketplace as ready: see
    // C11 §13 / AC24. In practice unreachable from this app's own UI
    // (selection is limited to SUPPORTED_MARKETPLACES), but a defensive,
    // honest result if it ever is.
    return {
      marketplace,
      status: 'NOT_READY',
      issues: [{ field: 'marketplace', severity: 'error', message: `"${marketplace}" is not a supported marketplace`, marketplace }],
      itemCount: items.length
    }
  }

  const allIssues: MarketplaceReadinessIssue[] = []
  for (const item of items) {
    let readiness
    try {
      readiness = adapter.validate(item.content, item.generationError, item.meta)
    } catch (err: any) {
      // §13: a thrown validator is reported as a blocking issue, never
      // silently treated as READY.
      allIssues.push({
        field: 'Readiness check',
        severity: 'error',
        message: `Could not evaluate readiness: ${err?.message ?? 'unknown error'}`,
        marketplace
      })
      continue
    }
    if (readiness.status === 'NOT_READY') {
      allIssues.push(...readiness.issues)
    }
  }

  if (allIssues.length === 0) {
    return { marketplace, status: 'READY', issues: [], itemCount: items.length }
  }

  const status: ExportReadinessStatus = allIssues.some((i) => i.severity === 'error') ? 'NOT_READY' : 'MISSING_FIELDS'
  return { marketplace, status, issues: allIssues, itemCount: items.length }
}

// Convenience batch form: evaluates several marketplaces independently.
// Each call is fully isolated (own items, own adapter, own result array);
// nothing here shares or mutates state across marketplaces (C11 §14/AC30).
export function evaluateSelectedMarketplaces(
  marketplaces: Marketplace[],
  itemsByMarketplace: Map<Marketplace, ExportCandidateItem[]>
): MarketplaceExportReadiness[] {
  return marketplaces.map((m) => evaluateMarketplaceExportReadiness(m, itemsByMarketplace.get(m) ?? []))
}

// Only a strictly READY marketplace may reach the existing export pipeline
//: MISSING_FIELDS and NOT_READY are both excluded (per the milestone's own
// Case B: a "2 fields missing" marketplace must NOT be included), same
// exportable set either way.
export function readyMarketplaces(results: MarketplaceExportReadiness[]): Marketplace[] {
  return results.filter((r) => r.status === 'READY').map((r) => r.marketplace)
}
