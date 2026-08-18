"use client"

import ProductThumbnail from '@/components/ProductThumbnail'
import type { ImageGroupCandidate } from '@/lib/imageGrouping'
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonSecondarySmallClass,
  linkButtonClass,
  warningBannerClass,
  warningTextClass,
  bodyTextClass,
  labelClass
} from '@/lib/uiClasses'

// Milestone C18: the seller-facing review step between "AI proposed a
// grouping" and "these groups become real products." Everything here is
// pure, synchronous client state editing (see the handlers this receives
// from CatalogueWorkspace.tsx): no group edit here ever calls an AI route;
// grouping only ever runs once per uploaded batch, and Product Intelligence
// only ever runs once Confirm & Analyze Products has committed each group
// as an ordinary product (§16/§17). No drag-and-drop library: same
// established precedent as ManualEntryImages.tsx's move buttons: small
// per-image "Move to" controls instead, not a new dependency.
const CONFIDENCE_BADGE: Record<ImageGroupCandidate['confidence'], { label: string; className: string }> = {
  high: { label: 'High confidence', className: 'bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]' },
  medium: { label: 'Medium confidence', className: 'bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]' },
  low: { label: 'Needs review', className: 'bg-[var(--danger-bg)] text-[var(--danger-text)] border-[var(--danger-border)]' }
}

const THUMB_SIZE = 56

export default function ImageGroupReview({
  totalImages,
  groups,
  onRemoveImage,
  onMoveImage,
  onMergeGroup,
  onSplitGroup,
  onResolveReview,
  onConfirm,
  onCancel
}: {
  totalImages: number
  groups: ImageGroupCandidate[]
  onRemoveImage: (groupId: string, imageUrl: string) => void
  onMoveImage: (groupId: string, imageUrl: string, targetGroupId: string | 'new') => void
  onMergeGroup: (groupId: string, targetGroupId: string) => void
  onSplitGroup: (groupId: string) => void
  onResolveReview: (groupId: string, action: 'keep' | 'split') => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const needsReviewCount = groups.filter((g) => g.needsReview).length
  // A group can end up with zero images (every image moved/removed out of
  // it): it's dropped from what Confirm actually commits (see
  // commitConfirmedImageGroups in CatalogueWorkspace.tsx), but stays
  // visible here until then rather than disappearing mid-review.
  const confirmableGroups = groups.filter((g) => g.imageUrls.length > 0)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className={`${bodyTextClass} font-medium`}>
          {totalImages} image{totalImages === 1 ? '' : 's'} uploaded: {confirmableGroups.length} product
          {confirmableGroups.length === 1 ? '' : 's'} detected
        </p>
        <p className={`${bodyTextClass} text-xs mt-0.5`}>Review grouping before analysis.</p>
      </div>

      {needsReviewCount > 0 && (
        <div className={warningBannerClass}>
          <p className={warningTextClass}>
            {needsReviewCount} group{needsReviewCount === 1 ? '' : 's'} need{needsReviewCount === 1 ? 's' : ''} your
            confirmation before Tesolute can analyze them: resolve each one below.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {groups.map((group, groupIndex) => {
          const otherGroups = groups.filter((g) => g.id !== group.id)
          const badge = CONFIDENCE_BADGE[group.confidence]

          return (
            <div key={group.id} className="rounded-xl border border-[var(--card-border)] p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className={labelClass}>Product {groupIndex + 1}</p>
                <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${badge.className}`}>
                  {badge.label}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {group.imageUrls.map((url) => (
                  <div key={url} className="relative shrink-0" style={{ width: THUMB_SIZE, height: THUMB_SIZE }}>
                    <ProductThumbnail imageFile={null} imageUrl={url} alt="Product photo" size={THUMB_SIZE} />
                    <button
                      type="button"
                      onClick={() => onRemoveImage(group.id, url)}
                      aria-label="Remove this image from the import"
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-[var(--danger-bg)] text-[var(--danger-text)] border border-[var(--danger-border)] text-xs leading-none hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      ×
                    </button>
                    {otherGroups.length > 0 && (
                      <select
                        aria-label="Move this image to a different product"
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) onMoveImage(group.id, url, e.target.value)
                          e.target.value = ''
                        }}
                        className="absolute -bottom-1.5 left-0 right-0 text-[9px] rounded bg-[var(--secondary-btn-bg)] border border-[var(--secondary-btn-border)] text-[var(--secondary-btn-text)]"
                      >
                        <option value="" disabled>
                          Move…
                        </option>
                        {otherGroups.map((g) => (
                          <option key={g.id} value={g.id}>
                            Product {groups.findIndex((x) => x.id === g.id) + 1}
                          </option>
                        ))}
                        <option value="new">New product</option>
                      </select>
                    )}
                  </div>
                ))}
              </div>

              <p className={`${bodyTextClass} text-xs`}>
                {group.imageUrls.length} image{group.imageUrls.length === 1 ? '' : 's'}
              </p>

              {group.needsReview ? (
                <div className="flex flex-wrap gap-3 pt-1 border-t border-[var(--card-border)]">
                  <button onClick={() => onResolveReview(group.id, 'keep')} className={buttonSecondarySmallClass}>
                    Looks right, keep together
                  </button>
                  <button onClick={() => onResolveReview(group.id, 'split')} className={buttonSecondarySmallClass}>
                    Split into separate products
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3 pt-1 border-t border-[var(--card-border)]">
                  {group.imageUrls.length > 1 && (
                    <button onClick={() => onSplitGroup(group.id)} className={linkButtonClass}>
                      Split into separate products
                    </button>
                  )}
                  {otherGroups.length > 0 && (
                    <select
                      aria-label={`Merge Product ${groupIndex + 1} with another product`}
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) onMergeGroup(group.id, e.target.value)
                        e.target.value = ''
                      }}
                      className="text-xs rounded-lg bg-[var(--secondary-btn-bg)] border border-[var(--secondary-btn-border)] text-[var(--secondary-btn-text)] px-2 py-1"
                    >
                      <option value="" disabled>
                        Merge with…
                      </option>
                      {otherGroups.map((g) => (
                        <option key={g.id} value={g.id}>
                          Product {groups.findIndex((x) => x.id === g.id) + 1}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex flex-row gap-3">
        <button
          onClick={onConfirm}
          disabled={needsReviewCount > 0 || confirmableGroups.length === 0}
          className={`flex-1 ${buttonPrimaryClass}`}
        >
          Confirm & Analyze Products
        </button>
        <button onClick={onCancel} className={buttonSecondaryClass}>
          Cancel
        </button>
      </div>
    </div>
  )
}
