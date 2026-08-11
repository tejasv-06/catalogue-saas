"use client"

import type { DraftProduct, Marketplace } from '@/lib/types'
import type { ReadinessFilter } from '@/components/CatalogueWorkspace'
import type { CatalogActionRecommendation } from '@/lib/catalogRecommendations'
import { SUPPORTED_MARKETPLACES, MARKETPLACE_LABELS } from '@/lib/platformShapers'
import { computeListingHealth } from '@/lib/listingHealth'
import { marketplaceChipFor, explainMissing, CHIP_TONE_CLASS } from '@/components/workspace/humanCopy'
import ProductThumbnail from '@/components/ProductThumbnail'
import EmptyQueueState from '@/components/workspace/EmptyQueueState'
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonSecondarySmallClass,
  linkButtonClass,
  linkButtonDestructiveClass,
  cardClass
} from '@/lib/uiClasses'

// Milestone C17 — "My Products." Renamed conceptually (still QueueTable.tsx
// as a file — a rename would only touch code, this is a seller-facing IA
// change, not a code-cleanliness one) from a per-(product, marketplace) row
// table into one CARD per PRODUCT: the product is the object the seller
// interacts with, marketplace status is a compact chip row within it, and
// the "Health"/"Issues" column jargon is gone — every fact shown here still
// comes from the exact same computeListingHealth call C1-C16 already made,
// just translated to plain language (see humanCopy.ts) and grouped by
// product instead of exploded into one row per marketplace.

// Whether a product has at least one marketplace whose real health matches
// the (de-emphasized, still-available) status filter — same
// computeListingHealth call every other status view in this app already
// uses, just deciding "does this product show" instead of "does this row
// show," since there's one card per product now, not one row per
// marketplace.
function productMatchesReadinessFilter(product: DraftProduct, generatingMarketplace: Marketplace | null, filter: ReadinessFilter): boolean {
  if (filter === 'all') return true
  return SUPPORTED_MARKETPLACES.some((m) => {
    const content = product.generatedContent[m]
    const error = product.generationError[m]
    if (content === null && error === null) return false
    if (m === generatingMarketplace) return false
    return computeListingHealth(m, content, error, product.generationMeta[m]).status === filter
  })
}

function ProductCard({
  product,
  generatingMarketplace,
  selected,
  onToggleSelect,
  topRecommendation,
  onExecuteRecommendation,
  onView,
  onEdit,
  onDelete
}: {
  product: DraftProduct
  generatingMarketplace: Marketplace | null
  selected: boolean
  onToggleSelect: (id: string) => void
  topRecommendation: CatalogActionRecommendation | null
  onExecuteRecommendation: (rec: CatalogActionRecommendation) => void
  onView: (id: string, marketplace: Marketplace) => void
  onEdit: (product: DraftProduct) => void
  onDelete: (id: string) => void
}) {
  const attemptedMarketplaces = SUPPORTED_MARKETPLACES.filter(
    (m) => product.generatedContent[m] !== null || product.generationError[m] !== null
  )
  // Milestone C17 (corrected) — only marketplaces this product has actually
  // been worked on for get a chip; an untouched marketplace the seller
  // never asked Tesolute to create simply isn't shown at all (no "Not
  // Started" clutter for all four every time). The in-flight marketplace
  // is folded in too so a "Creating…" chip appears the instant generation
  // starts, even before it has content/error of its own yet.
  const visibleMarketplaces = generatingMarketplace && !attemptedMarketplaces.includes(generatingMarketplace)
    ? [...attemptedMarketplaces, generatingMarketplace]
    : attemptedMarketplaces
  const firstOpenTarget = attemptedMarketplaces[0] ?? SUPPORTED_MARKETPLACES[0]

  const understoodStatus = product.productIntelligence?.status
  const understandingLabel =
    understoodStatus === 'completed'
      ? '✓ Product understood'
      : understoodStatus === 'processing'
        ? 'Understanding your product…'
        : understoodStatus === 'failed'
          ? 'Needs more information'
          : null

  return (
    <div className={`p-4 flex flex-col gap-3 ${cardClass}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(product.id)}
          aria-label={`Select ${product.brandName || 'product'}`}
          className="mt-1 w-4 h-4 rounded border-[var(--card-border)] shrink-0"
        />
        <ProductThumbnail imageFile={product.imageFile} imageUrl={product.imageUrl} alt={product.brandName} size={56} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm text-[var(--heading-text)] truncate">{product.brandName || 'Untitled product'}</p>
          <p className="text-xs text-[var(--muted-text)] truncate">{product.category || 'No category yet'}</p>
          {understandingLabel && (
            <p className={`text-xs mt-0.5 ${understoodStatus === 'completed' ? 'text-[var(--success-text)]' : 'text-[var(--muted-text)]'}`}>
              {understandingLabel}
            </p>
          )}
        </div>
      </div>

      {/* Only the marketplace(s) actually worked on for this product, in
          plain language — never the raw ready/needs-review/missing-data/
          error vocabulary, and never a "Not Started" badge for a
          marketplace the seller hasn't asked Tesolute about yet. Clicking
          a chip opens this product's studio at exactly that marketplace. */}
      {visibleMarketplaces.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {visibleMarketplaces.map((m) => {
            const isGenerating = m === generatingMarketplace
            const attempted = attemptedMarketplaces.includes(m)
            const health = attempted && !isGenerating
              ? computeListingHealth(m, product.generatedContent[m], product.generationError[m], product.generationMeta[m])
              : null
            const chip = isGenerating ? { tone: 'attention' as const, label: 'Creating…' } : marketplaceChipFor(attempted, health)
            return (
              <button
                key={m}
                type="button"
                onClick={() => onView(product.id, m)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors hover:opacity-90 ${CHIP_TONE_CLASS[chip.tone]}`}
                title={health ? explainMissing(MARKETPLACE_LABELS[m], health) ?? undefined : undefined}
              >
                {MARKETPLACE_LABELS[m]} · {chip.label}
              </button>
            )
          })}
        </div>
      )}

      {/* One contextual next step, reusing C15's already-computed,
          already-sorted recommendation for this exact product — never a
          second priority judgment made here. */}
      {topRecommendation && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--secondary-btn-bg)] text-xs">
          <p className="text-[var(--body-text)] min-w-0 truncate">{topRecommendation.reason}</p>
          <button
            type="button"
            onClick={() => onExecuteRecommendation(topRecommendation)}
            className="shrink-0 text-[var(--link-text)] underline hover:text-[var(--link-text-hover)]"
          >
            {topRecommendation.actionType === 'ANALYZE'
              ? 'Analyze'
              : topRecommendation.actionType === 'GENERATE'
                ? 'Create it'
                : topRecommendation.actionType === 'APPROVE'
                  ? 'Approve'
                  : topRecommendation.actionType === 'EXPORT'
                    ? 'Download'
                    : 'Review'}
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--card-border)]">
        <div className="flex gap-3">
          <button onClick={() => onEdit(product)} className={linkButtonClass}>
            Edit
          </button>
          <button onClick={() => onDelete(product.id)} className={linkButtonDestructiveClass}>
            Delete
          </button>
        </div>
        <button onClick={() => onView(product.id, firstOpenTarget)} className={buttonSecondarySmallClass}>
          Open Product
        </button>
      </div>
    </div>
  )
}

export default function QueueTable({
  draftProducts,
  totalProductCount,
  readinessFilter,
  currentlyGenerating,
  selectedMarketplaces,
  generating,
  pendingGenerationCount,
  hasUnapprovedContent,
  hasApproved,
  loading,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  recommendations,
  onExecuteRecommendation,
  onGenerateAll,
  onBulkApprove,
  onDownloadApproved,
  onView,
  onEdit,
  onDelete
}: {
  draftProducts: DraftProduct[]
  totalProductCount: number
  readinessFilter: ReadinessFilter
  currentlyGenerating: { productId: string; marketplace: Marketplace } | null
  selectedMarketplaces: Marketplace[]
  generating: boolean
  // Milestone C17 (corrected) — count (not filtered-view-scoped) of
  // never-yet-generated products across the WHOLE current batch, driving
  // both "Generate Listings"'s enabled state and its "Uses N credits"
  // preview text.
  pendingGenerationCount: number
  hasUnapprovedContent: boolean
  hasApproved: boolean
  loading: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  // Milestone C17 — the same already-sorted C15 recommendation list, used
  // to show each card's own single most relevant next step. Purely a read;
  // execution still goes through the caller's existing dispatcher.
  recommendations: CatalogActionRecommendation[]
  onExecuteRecommendation: (rec: CatalogActionRecommendation) => void
  // Milestone C17 (corrected) — restored as the PRIMARY, zero-selection
  // actions: "selection is not the primary workflow." Generate Listings
  // acts on every draft product in the current batch; Approve All acts on
  // every eligible generated/partial product. Select all + the (still
  // available, now explicitly secondary) Bulk Action Bar remains for
  // narrowing either action to a subset.
  onGenerateAll: () => void
  onBulkApprove: () => void
  onDownloadApproved: () => void
  onView: (id: string, marketplace: Marketplace) => void
  onEdit: (product: DraftProduct) => void
  onDelete: (id: string) => void
}) {
  const visibleProducts = draftProducts.filter((p) =>
    productMatchesReadinessFilter(p, currentlyGenerating?.productId === p.id ? currentlyGenerating.marketplace : null, readinessFilter)
  )
  const allVisibleSelected = visibleProducts.length > 0 && visibleProducts.every((p) => selectedIds.has(p.id))
  const hasSelectedMarketplaces = selectedMarketplaces.length > 0
  const hasDraft = pendingGenerationCount > 0

  // Milestone C17 (corrected) — pipeline-position primary: whichever
  // zero-selection action the CURRENT batch is actually ready for next
  // gets the one blue "primary" treatment, mirroring the original C14
  // pattern (generate -> approve -> export). The other two stay visible
  // but secondary, never hidden — the whole point is these three are
  // ALWAYS on screen, not conjured only once selection happens.
  const generateIsPrimary = hasDraft
  const bulkApproveIsPrimary = !generateIsPrimary && hasUnapprovedContent
  const downloadIsPrimary = !generateIsPrimary && !bulkApproveIsPrimary && hasApproved
  const creditCost = pendingGenerationCount * selectedMarketplaces.length

  const recommendationByProduct = new Map(recommendations.filter((r) => r.productId).map((r) => [r.productId!, r] as const))
  // Only the FIRST (highest-priority, since recommendations arrives
  // pre-sorted) recommendation per product — a card shows one next step,
  // never a stacked list.
  for (const r of recommendations) {
    if (r.productId && !recommendationByProduct.has(r.productId)) recommendationByProduct.set(r.productId, r)
  }

  return (
    <div className="w-full min-w-0 flex flex-col gap-3">
      {/* Milestone C17 (corrected) — the PRIMARY workflow toolbar: three
          always-visible, zero-selection actions covering the whole current
          batch (Generate Listings -> Approve All -> Export Listings), each
          individually enabled by real batch eligibility, with exactly one
          highlighted as primary based on pipeline position. "Select all" +
          the Bulk Action Bar (rendered by the caller above this component)
          remains available underneath as the SECONDARY, subset-narrowing
          mechanism — selection is never a prerequisite for these. */}
      {draftProducts.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-[var(--muted-text)]">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={onToggleSelectAll}
                aria-label="Select all visible products"
                className="w-4 h-4 rounded border-[var(--card-border)]"
              />
              Select all
            </label>
            <div className="flex-1" />
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-col items-end">
                <button
                  onClick={onGenerateAll}
                  disabled={!hasSelectedMarketplaces || !hasDraft || generating}
                  className={generateIsPrimary ? buttonPrimaryClass : buttonSecondaryClass}
                >
                  Generate Listings
                </button>
                {hasDraft && hasSelectedMarketplaces && (
                  <span className="text-[11px] text-[var(--muted-text)] mt-0.5">Uses {creditCost} credits</span>
                )}
              </div>
              <button
                onClick={onBulkApprove}
                disabled={!hasUnapprovedContent || generating}
                className={bulkApproveIsPrimary ? buttonPrimaryClass : buttonSecondaryClass}
              >
                Approve All
              </button>
              <button
                onClick={onDownloadApproved}
                disabled={!hasSelectedMarketplaces || !hasApproved || generating}
                className={downloadIsPrimary ? buttonPrimaryClass : buttonSecondaryClass}
              >
                Export Listings
              </button>
            </div>
          </div>
          {!hasSelectedMarketplaces && hasDraft && (
            <p className="text-xs text-[var(--muted-text)] text-right">Choose where to sell above to generate listings.</p>
          )}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`p-4 h-40 animate-pulse ${cardClass}`}>
              <div className="h-4 w-2/3 rounded bg-[var(--skeleton-bg)]" />
            </div>
          ))}
        </div>
      ) : draftProducts.length === 0 ? (
        <EmptyQueueState message={totalProductCount > 0 ? 'No products match your filters or search.' : undefined} />
      ) : visibleProducts.length === 0 ? (
        <EmptyQueueState message="No products match this filter." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {visibleProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              generatingMarketplace={currentlyGenerating?.productId === product.id ? currentlyGenerating.marketplace : null}
              selected={selectedIds.has(product.id)}
              onToggleSelect={onToggleSelect}
              topRecommendation={recommendationByProduct.get(product.id) ?? null}
              onExecuteRecommendation={onExecuteRecommendation}
              onView={onView}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
