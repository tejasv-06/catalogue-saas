"use client"

import type { DraftProduct } from '@/lib/types'
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
  cardClass,
  warningBannerClass,
  warningTextClass
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
        {product.generationError && <p className="text-xs text-[var(--danger-link-text)] mt-1">{product.generationError}</p>}
      </td>
      <td className="py-3 px-4 whitespace-nowrap space-x-2">
        {(product.generatedContent || product.generationError) && (
          <button onClick={() => onView(product.id)} className={linkButtonClass}>
            {product.generatedContent ? 'View Generated Listing' : 'View Error'}
          </button>
        )}
        {product.generationError && (
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
  targetMarketplace,
  generating,
  hasApproved,
  loading,
  hasSession,
  pendingCount,
  bulkStoppedMessage,
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
  targetMarketplace: string
  generating: boolean
  hasApproved: boolean
  loading: boolean
  hasSession: boolean
  pendingCount: number
  bulkStoppedMessage: string | null
  onGenerateAll: () => void
  onBulkApprove: () => void
  onDownloadApproved: () => void
  onView: (id: string) => void
  onEdit: (product: DraftProduct) => void
  onDelete: (id: string) => void
  onRetry: (id: string) => void
}) {
  // Sequential "what's next" highlight: exactly one of the three actions is
  // primary blue at a time, based on where the queue actually is — not the
  // active tab or any manual toggle. Mutually exclusive by construction:
  // hasDraft implies neither of the other two can be true yet, and so on.
  const hasDraft = draftProducts.some((p) => p.status === 'draft')
  const hasGenerated = draftProducts.some((p) => p.status === 'generated')

  const generateIsPrimary = hasDraft
  const bulkApproveIsPrimary = !hasDraft && hasGenerated
  const downloadIsPrimary = !hasDraft && !hasGenerated && hasApproved

  // Guests aren't credit-metered (they have the separate free-preview count
  // shown in the header), so the cost preview only applies once signed in —
  // computed from the actual pending count, not hardcoded, so it can't drift
  // from what generating will actually cost.
  const generateLabel = generating
    ? 'Generating...'
    : hasSession && pendingCount > 0
      ? `Generate ${pendingCount} listing${pendingCount === 1 ? '' : 's'} (${pendingCount * CREDIT_COSTS.listingGeneration} credit${
          pendingCount * CREDIT_COSTS.listingGeneration === 1 ? '' : 's'
        })`
      : 'Generate Content'

  return (
    <div className={`w-full min-w-0 p-6 ${cardClass}`}>
      {bulkStoppedMessage && (
        <div className={`mb-4 ${warningBannerClass}`}>
          <p className={warningTextClass}>{bulkStoppedMessage}</p>
        </div>
      )}
      <div className="flex flex-row flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-row flex-wrap items-center gap-3">
          <button
            onClick={onGenerateAll}
            disabled={!targetMarketplace || !hasDraft || generating}
            className={generateIsPrimary ? buttonPrimaryClass : buttonSecondaryClass}
          >
            {generateLabel}
          </button>
          <button
            onClick={onBulkApprove}
            disabled={!targetMarketplace || !hasGenerated}
            className={bulkApproveIsPrimary ? buttonPrimaryClass : buttonSecondaryClass}
          >
            Bulk Approve
          </button>
        </div>
        <button
          onClick={onDownloadApproved}
          disabled={!targetMarketplace || !hasApproved}
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
