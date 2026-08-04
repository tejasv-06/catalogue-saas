"use client"

import type { DraftProduct } from '@/lib/types'
import ProductThumbnail from '@/components/ProductThumbnail'
import StatusBadge from '@/components/StatusBadge'
import EmptyQueueState from '@/components/workspace/EmptyQueueState'
import TableSkeleton from '@/components/workspace/TableSkeleton'
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
  return (
    <tr className="border-b border-slate-800/60">
      <td className="py-3 px-4">
        <ProductThumbnail imageFile={product.imageFile} imageUrl={product.imageUrl} alt={product.brandName} size={80} />
      </td>
      <td className="py-3 px-4">
        <p className="font-medium text-sm text-slate-100">{product.brandName || '—'}</p>
        <p className="text-xs text-slate-400">{product.category || '—'}</p>
      </td>
      <td className="py-3 px-4 text-sm text-slate-300 max-w-xs">{truncate(product.description, 80)}</td>
      <td className="py-3 px-4">
        <StatusBadge status={isGenerating ? 'generating' : product.status} />
        {product.generationError && <p className="text-xs text-red-400 mt-1">{product.generationError}</p>}
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
  onGenerateAll: () => void
  onBulkApprove: () => void
  onDownloadApproved: () => void
  onView: (id: string) => void
  onEdit: (product: DraftProduct) => void
  onDelete: (id: string) => void
  onRetry: (id: string) => void
}) {
  return (
    <div className={`w-[65%] min-w-0 p-6 ${cardClass}`}>
      <div className="flex flex-row flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-row flex-wrap items-center gap-3">
          <button
            onClick={onGenerateAll}
            disabled={!targetMarketplace || !draftProducts.some((p) => p.status === 'draft') || generating}
            className={buttonPrimaryClass}
          >
            {generating ? 'Generating...' : 'Generate Content for All'}
          </button>
          <button
            onClick={onBulkApprove}
            disabled={!targetMarketplace || !draftProducts.some((p) => p.status === 'generated')}
            className={buttonSecondaryClass}
          >
            Bulk Approve All Generated
          </button>
        </div>
        <button onClick={onDownloadApproved} disabled={!targetMarketplace || !hasApproved} className={buttonSecondaryClass}>
          Download Approved CSV
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-800/60 bg-slate-900/50 text-left text-xs text-slate-400">
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
