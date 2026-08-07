"use client"

import type { DraftProduct, Marketplace } from '@/lib/types'
import { SUPPORTED_MARKETPLACES } from '@/lib/platformShapers'
import ProductThumbnail from '@/components/ProductThumbnail'
import StatusBadge from '@/components/StatusBadge'
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

function truncate(text: string, length: number) {
  return text.length > length ? text.slice(0, length) + '…' : text
}

function QueueRow({
  product,
  isGenerating,
  onView,
  onEdit,
  onDelete,
  onRetry
}: {
  product: DraftProduct
  isGenerating: boolean
  onView: (id: string) => void
  onEdit: (product: DraftProduct) => void
  onDelete: (id: string) => void
  onRetry: (id: string) => void
}) {
  // generatedContent/generationError are now full per-marketplace records
  // (always an object, every key present) — checking the record itself for
  // truthiness would always be true, so "has anything" has to look at the
  // actual values.
  const hasAnyContent = SUPPORTED_MARKETPLACES.some((m) => product.generatedContent[m] !== null)
  const hasAnyError = SUPPORTED_MARKETPLACES.some((m) => product.generationError[m] !== null)

  return (
    <tr className="border-b border-[var(--row-border)]">
      <td className="py-3 px-4">
        <ProductThumbnail imageFile={product.imageFile} imageUrl={product.imageUrl} alt={product.brandName} size={80} />
      </td>
      <td className="py-3 px-4">
        <p className="font-medium text-sm text-[var(--heading-text)]">{product.brandName || '-'}</p>
        <p className="text-xs text-[var(--muted-text)]">{product.category || '-'}</p>
      </td>
      <td className="py-3 px-4 text-sm text-[var(--body-text)] max-w-xs">{truncate(product.description, 80)}</td>
      <td className="py-3 px-4">
        <StatusBadge status={isGenerating ? 'generating' : product.status} />
        {hasAnyError && <p className="text-xs text-[var(--danger-link-text)] mt-1">One or more marketplaces failed</p>}
      </td>
      <td className="py-3 px-4 whitespace-nowrap space-x-2">
        {(hasAnyContent || hasAnyError) && (
          <button onClick={() => onView(product.id)} className={linkButtonClass}>
            {hasAnyContent ? 'View Content' : 'View Error'}
          </button>
        )}
        {hasAnyError && (
          <button onClick={() => onRetry(product.id)} disabled={isGenerating} className={buttonDestructiveSmallClass}>
            Retry
          </button>
        )}
        <button onClick={() => onEdit(product)} className={linkButtonClass}>
          Edit
        </button>
        <button onClick={() => onDelete(product.id)} className={linkButtonDestructiveClass}>
          Delete
        </button>
      </td>
    </tr>
  )
}

export default function QueueTable({
  draftProducts,
  currentlyGeneratingId,
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
  currentlyGeneratingId: string | null
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
  onRetry: (id: string) => void
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
  const generateLabel = generating
    ? 'Generating...'
    : hasSession && pendingCount > 0 && hasSelectedMarketplaces
      ? `Generate ${pendingCount} product${pendingCount === 1 ? '' : 's'} × ${selectedMarketplaces.length} marketplace${
          selectedMarketplaces.length === 1 ? '' : 's'
        } (${totalGenerations * CREDIT_COSTS.listingGeneration} credit${
          totalGenerations * CREDIT_COSTS.listingGeneration === 1 ? '' : 's'
        })`
      : 'Generate Content'

  return (
    <div className={`w-full min-w-0 p-6 ${cardClass}`}>
      <div className="flex flex-row flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-row flex-wrap items-center gap-3">
          <button
            onClick={onGenerateAll}
            disabled={!hasSelectedMarketplaces || !hasDraft || generating}
            className={generateIsPrimary ? buttonPrimaryClass : buttonSecondaryClass}
          >
            {generateLabel}
          </button>
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
          Download CSV
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[var(--card-border)]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--row-border)] bg-[var(--table-head-bg)] text-left text-xs text-[var(--muted-text)]">
              <th className="py-3 px-4">Thumbnail</th>
              <th className="py-3 px-4">Brand / Category</th>
              <th className="py-3 px-4">Raw Input</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton />
            ) : draftProducts.length === 0 ? (
              <EmptyQueueState />
            ) : (
              draftProducts.map((product) => (
                <QueueRow
                  key={product.id}
                  product={product}
                  isGenerating={product.id === currentlyGeneratingId}
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
