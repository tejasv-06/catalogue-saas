"use client"

import type { DraftProduct, Marketplace } from '@/lib/types'
import { SUPPORTED_MARKETPLACES, MARKETPLACE_LABELS } from '@/lib/platformShapers'
import { computeListingHealth } from '@/lib/listingHealth'
import ProductThumbnail from '@/components/ProductThumbnail'
import ListingHealthBadge, { type RowHealthStatus } from '@/components/workspace/ListingHealthBadge'
import EmptyQueueState from '@/components/workspace/EmptyQueueState'
import TableSkeleton from '@/components/workspace/TableSkeleton'
import { CREDIT_COSTS } from '@/lib/creditCosts'
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonDestructiveSmallClass,
  linkButtonClass,
  linkButtonDestructiveClass,
  cardClass
} from '@/lib/uiClasses'

const COLUMN_COUNT = 5

// One row per (product, marketplace) pair that's actually been attempted —
// answers "is this specific listing ready to upload," which a single
// product-level row couldn't when a product spans several marketplaces. The
// marketplace currently generating is included too, even before it has any
// content/error of its own, so it gets its own "Generating…" row instead of
// silently having no row at all until it resolves. A product with nothing
// attempted or in flight yet still gets exactly one row (marketplace slot
// null) so it doesn't disappear from the queue before generation runs.
function getDisplayMarketplaces(product: DraftProduct, generatingMarketplace: Marketplace | null): Marketplace[] {
  const displaySet = new Set(
    SUPPORTED_MARKETPLACES.filter((m) => product.generatedContent[m] !== null || product.generationError[m] !== null)
  )
  if (generatingMarketplace) displaySet.add(generatingMarketplace)
  return SUPPORTED_MARKETPLACES.filter((m) => displaySet.has(m))
}

function QueueRows({
  product,
  generatingMarketplace,
  onView,
  onEdit,
  onDelete,
  onRetry
}: {
  product: DraftProduct
  // The one marketplace of THIS product currently generating, or null — not
  // a product-wide flag, so a row whose own marketplace already finished
  // doesn't get stuck showing "Generating…" just because a sibling row for
  // the same product is still in flight.
  generatingMarketplace: Marketplace | null
  onView: (id: string) => void
  onEdit: (product: DraftProduct) => void
  onDelete: (id: string) => void
  onRetry: (id: string, marketplace: Marketplace) => void
}) {
  const displayMarketplaces = getDisplayMarketplaces(product, generatingMarketplace)
  const marketplaceRows: (Marketplace | null)[] = displayMarketplaces.length > 0 ? displayMarketplaces : [null]

  return (
    <>
      {marketplaceRows.map((marketplace, i) => {
        const isGenerating = marketplace !== null && marketplace === generatingMarketplace
        const content = marketplace ? product.generatedContent[marketplace] : null
        const error = marketplace ? product.generationError[marketplace] : null
        const health =
          marketplace && !isGenerating ? computeListingHealth(marketplace, content, error, product.generationMeta[marketplace]) : null

        const rowStatus: RowHealthStatus = isGenerating
          ? 'generating'
          : !marketplace
            ? 'not-generated'
            : (health!.status as RowHealthStatus)

        const failedChecks = health ? health.checks.filter((c) => c.applicable && !c.passed).length : 0

        return (
          <tr key={`${product.id}-${marketplace ?? 'none'}`} className="border-b border-[var(--row-border)]">
            {i === 0 && (
              <td className="py-3 px-4 align-top" rowSpan={marketplaceRows.length}>
                <div className="flex items-center gap-3">
                  <ProductThumbnail imageFile={product.imageFile} imageUrl={product.imageUrl} alt={product.brandName} size={56} />
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-[var(--heading-text)] truncate">{product.brandName || '-'}</p>
                    <p className="text-xs text-[var(--muted-text)] truncate">{product.category || '-'}</p>
                    <div className="flex gap-2 mt-1">
                      <button onClick={() => onEdit(product)} className={linkButtonClass}>
                        Edit
                      </button>
                      <button onClick={() => onDelete(product.id)} className={linkButtonDestructiveClass}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </td>
            )}
            <td className="py-3 px-4 text-sm text-[var(--body-text)]">
              {marketplace ? MARKETPLACE_LABELS[marketplace] : '—'}
            </td>
            <td className="py-3 px-4">
              <div className="flex flex-col gap-0.5">
                <ListingHealthBadge status={rowStatus} />
                {health && <span className="text-xs text-[var(--muted-text)]">{health.percentComplete}% complete</span>}
              </div>
            </td>
            <td className="py-3 px-4 text-sm text-[var(--body-text)]">{health ? failedChecks : '—'}</td>
            <td className="py-3 px-4 whitespace-nowrap space-x-2">
              {(content || error) && (
                <button onClick={() => onView(product.id)} className={linkButtonClass}>
                  View
                </button>
              )}
              {error && marketplace && (
                <button
                  onClick={() => onRetry(product.id, marketplace)}
                  disabled={isGenerating}
                  className={buttonDestructiveSmallClass}
                >
                  Retry
                </button>
              )}
            </td>
          </tr>
        )
      })}
    </>
  )
}

export default function QueueTable({
  draftProducts,
  currentlyGenerating,
  selectedMarketplaces,
  generating,
  hasApproved,
  loading,
  hasSession,
  pendingCount,
  onGenerateAll,
  onBulkApprove,
  onDownloadApproved,
  onView,
  onEdit,
  onDelete,
  onRetry
}: {
  draftProducts: DraftProduct[]
  // Only one (product, marketplace) pair is ever generating at a time (the
  // generation loop is sequential) — passed through as-is so each row can
  // tell whether it specifically is the one in flight, not just its product.
  currentlyGenerating: { productId: string; marketplace: Marketplace } | null
  selectedMarketplaces: Marketplace[]
  generating: boolean
  hasApproved: boolean
  loading: boolean
  hasSession: boolean
  pendingCount: number
  onGenerateAll: () => void
  onBulkApprove: () => void
  onDownloadApproved: () => void
  onView: (id: string) => void
  onEdit: (product: DraftProduct) => void
  onDelete: (id: string) => void
  onRetry: (id: string, marketplace: Marketplace) => void
}) {
  const hasSelectedMarketplaces = selectedMarketplaces.length > 0

  // Sequential "what's next" highlight: exactly one of the three actions is
  // primary blue at a time, based on where the queue actually is — not the
  // active tab or any manual toggle.
  //
  // Two things `status` alone can no longer answer, now that a product can
  // span several marketplaces generated independently:
  //   1. "hasGenerated" (status 'generated'/'partial' existing anywhere) can
  //      go true mid-batch — a product flips to 'partial' the instant its
  //      FIRST marketplace lands, while its others are still in flight in
  //      the very same run. Gating on `generating` fixes Bulk Approve
  //      lighting up before the batch actually finishes.
  //   2. Approving a marketplace never changes `status` (approval is fully
  //      independent of it) — so "no generated-status product exists" is
  //      never true again once anything has ever been generated, which
  //      made Download practically unreachable. What actually matters is
  //      whether any generated marketplace is still *unapproved* anywhere,
  //      not whether `status` ever resets.
  const hasDraft = draftProducts.some((p) => p.status === 'draft')
  const hasUnapprovedContent = draftProducts.some((p) =>
    SUPPORTED_MARKETPLACES.some((m) => p.generatedContent[m] !== null && !p.approved[m])
  )

  const generateIsPrimary = hasDraft
  const bulkApproveIsPrimary = !generating && !hasDraft && hasUnapprovedContent
  const downloadIsPrimary = !generating && !hasDraft && !hasUnapprovedContent && hasApproved

  // Guests aren't credit-metered (they have the separate free-preview count
  // shown in the header), so the cost preview only applies once signed in —
  // computed from the actual pending count and selected marketplaces, not
  // hardcoded, so it can't drift from what generating will actually cost.
  // Total cost is simply products × marketplaces (one credit per pair), the
  // same sum the generation loop actually charges, not a separate formula.
  const totalGenerations = pendingCount * selectedMarketplaces.length
  const creditCost = totalGenerations * CREDIT_COSTS.listingGeneration
  // Plain label on the button itself; the cost (when it applies) is small
  // secondary text underneath instead of folded into one long sentence —
  // Generate Listings is the thing being decided, not the arithmetic.
  const generateLabel = generating ? 'Generating...' : 'Generate Listings'
  const showCreditCost = !generating && hasSession && pendingCount > 0 && hasSelectedMarketplaces

  return (
    <div className={`w-full min-w-0 h-full flex flex-col p-6 ${cardClass}`}>
      <div className="flex flex-row flex-wrap items-center justify-between gap-3 mb-4 shrink-0">
        <div className="flex flex-row flex-wrap items-start gap-3">
          <div>
            <button
              onClick={onGenerateAll}
              disabled={!hasSelectedMarketplaces || !hasDraft || generating}
              className={generateIsPrimary ? buttonPrimaryClass : buttonSecondaryClass}
            >
              {generateLabel}
            </button>
            {showCreditCost && (
              <p className="text-xs text-[var(--muted-text)] mt-1">
                Uses {creditCost} credit{creditCost === 1 ? '' : 's'}
              </p>
            )}
          </div>
          <button
            onClick={onBulkApprove}
            disabled={!hasSelectedMarketplaces || !hasUnapprovedContent}
            className={bulkApproveIsPrimary ? buttonPrimaryClass : buttonSecondaryClass}
          >
            Bulk Approve
          </button>
        </div>
        <button
          onClick={onDownloadApproved}
          disabled={!hasSelectedMarketplaces || !hasApproved}
          className={downloadIsPrimary ? buttonPrimaryClass : buttonSecondaryClass}
        >
          Export Listings
        </button>
      </div>
      {/* flex-1 + min-h-0 lets this fill the card down to its border on a
          short queue instead of leaving empty space beneath the table, and
          scroll internally (rather than growing the page) once the queue
          outgrows the available height. */}
      <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-[var(--card-border)]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--row-border)] bg-[var(--table-head-bg)] text-left text-xs text-[var(--muted-text)]">
              <th className="py-3 px-4">Product</th>
              <th className="py-3 px-4">Marketplace</th>
              <th className="py-3 px-4">Health</th>
              <th className="py-3 px-4">Issues</th>
              <th className="py-3 px-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton columns={COLUMN_COUNT} />
            ) : draftProducts.length === 0 ? (
              <EmptyQueueState colSpan={COLUMN_COUNT} />
            ) : (
              draftProducts.map((product) => (
                <QueueRows
                  key={product.id}
                  product={product}
                  generatingMarketplace={currentlyGenerating?.productId === product.id ? currentlyGenerating.marketplace : null}
                  onView={onView}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onRetry={onRetry}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
