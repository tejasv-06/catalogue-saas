"use client"

import type { RefObject } from 'react'
import ProductThumbnail from '@/components/ProductThumbnail'
import ImageGroupReview from '@/components/workspace/ImageGroupReview'
import { MAX_IMAGE_GROUPING_BATCH, type ImageGroupCandidate } from '@/lib/imageGrouping'
import { CREDIT_COSTS } from '@/lib/creditCosts'
import Link from 'next/link'
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  cardClass,
  sectionHeadingClass,
  bodyTextClass,
  linkButtonClass,
  dangerBannerClass,
  dangerTextClass
} from '@/lib/uiClasses'

// Milestone C18 (Photos Only: Single Product vs Multiple Products): the
// in-progress state of an image-only BATCH import, entirely separate from
// the single-image imageFile/onImageFileChange state below it, which stays
// exactly as it always has for the guest/editing case (see the bottom
// return block). See CatalogueWorkspace.tsx's handleChooseSingleProductMode
// /handleChooseMultipleProductsMode/handleStageImageFiles/
// startSingleProductFromStaged/startImageGroupingFromFiles/
// commitConfirmedImageGroups.
//
// There is no "choosing" status here: the choice screen (Single Product /
// Multiple Products) is rendered directly by this component whenever
// imageGroupImport is null AND the seller is signed in AND not editing an
// existing product (see the render logic below); it is the very first
// thing a signed-in seller sees on this tab, before any photo is picked.
//
// 'staging': files picked but NOT yet uploaded, grouped, or turned into a
// product, for whichever `mode` was chosen up front: the seller can still
// add more (up to MAX_IMAGE_GROUPING_BATCH) or remove any before the one
// mode-appropriate action commits them. Nothing calls an AI route, or even
// uploads anything, until that explicit action. `error` is a transient,
// staging-local validation message (e.g. exceeding the 10-photo cap):
// distinct from the dedicated 'error' status below, which is specifically
// an AI grouping failure (mode 'multiple' only).
//
// 'creating': staged files are being uploaded for Single Product mode:
// free, no AI call (see startSingleProductFromStaged). Distinct from
// 'grouping', which is specifically Multiple Products mode's AI path and
// the only one that ever spends a credit.
export type ImageGroupImportState =
  | { status: 'staging'; mode: 'single' | 'multiple'; files: File[]; error?: string }
  | { status: 'creating' }
  | { status: 'grouping' }
  | { status: 'error'; message: string }
  | { status: 'insufficient_credits'; required: number; available: number }
  | { status: 'review'; totalImages: number; groups: ImageGroupCandidate[] }

function InsufficientCreditsBanner({ required, available }: { required: number; available: number }) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${dangerBannerClass}`}>
      <div>
        <p className={`font-semibold ${dangerTextClass}`}>Not enough credits.</p>
        <p className={dangerTextClass}>
          This needs {required} credit{required === 1 ? '' : 's'}: you have {available} remaining.
        </p>
      </div>
      <Link href="/contact" className={`${buttonPrimaryClass} shrink-0 text-center`}>
        Buy more credits
      </Link>
    </div>
  )
}

// Part 1: the entry screen a signed-in seller sees immediately on this
// tab, before picking a single photo. Plain, seller-friendly language only,
// no ML/vision jargon anywhere in this file's own copy: the difference
// between the two cards must be understandable at a glance.
function UploadModeCard({
  title,
  description,
  primary,
  onClick
}: {
  title: string
  description: string
  primary: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 text-left rounded-xl border p-4 flex flex-col gap-1 transition-colors ${
        primary
          ? 'border-blue-600/40 bg-blue-600/10 hover:bg-blue-600/15'
          : 'border-[var(--card-border)] hover:bg-[var(--secondary-btn-bg)]'
      }`}
    >
      <p className={`${sectionHeadingClass} text-base`}>{title}</p>
      <p className={bodyTextClass}>{description}</p>
    </button>
  )
}

// Deliberately trimmed relative to LeftPanel's manual-entry form: no
// description field. Brand name / category stay as optional context for the
// AI, not requirements: the image is the only thing this flow actually
// needs, since the whole point is generating a listing from an image alone.
export default function ImageOnlyPanel({
  brandName,
  onBrandNameChange,
  category,
  onCategoryChange,
  imageFile,
  onImageFileChange,
  formPreviewUrl,
  fileInputRef,
  formError,
  guestLimitReached,
  onSubmit,
  uploadingImage,
  editingId,
  hasSession,
  onChooseSingleProductMode,
  onChooseMultipleProductsMode,
  onStageImageFiles,
  onRemoveStagedImage,
  onCreateSingleProductFromStaged,
  onStartGroupingFromStaged,
  imageGroupImport,
  onRetryImageGrouping,
  onOrganizeManually,
  onCancelImageGrouping,
  onRemoveGroupImage,
  onMoveGroupImage,
  onMergeImageGroup,
  onSplitImageGroup,
  onResolveGroupReview,
  onConfirmImageGroups
}: {
  brandName: string
  onBrandNameChange: (value: string) => void
  category: string
  onCategoryChange: (value: string) => void
  imageFile: File | null
  onImageFileChange: (file: File | null) => void
  formPreviewUrl: string | null
  fileInputRef: RefObject<HTMLInputElement | null>
  formError: string | null
  guestLimitReached: boolean
  onSubmit: () => void
  uploadingImage: boolean
  editingId: string | null
  hasSession: boolean
  onChooseSingleProductMode: () => void
  onChooseMultipleProductsMode: () => void
  onStageImageFiles: (files: File[]) => void
  onRemoveStagedImage: (index: number) => void
  onCreateSingleProductFromStaged: () => void
  onStartGroupingFromStaged: () => void
  imageGroupImport: ImageGroupImportState | null
  onRetryImageGrouping: () => void
  onOrganizeManually: () => void
  onCancelImageGrouping: () => void
  onRemoveGroupImage: (groupId: string, imageUrl: string) => void
  onMoveGroupImage: (groupId: string, imageUrl: string, targetGroupId: string | 'new') => void
  onMergeImageGroup: (groupId: string, targetGroupId: string) => void
  onSplitImageGroup: (groupId: string) => void
  onResolveGroupReview: (groupId: string, action: 'keep' | 'split') => void
  onConfirmImageGroups: () => void
}) {
  const hasImage = !!(imageFile || formPreviewUrl)

  // A batch import in flight (staging/grouping/error/review/insufficient
  // credits) fully replaces the normal single-image form: same "pending
  // state takes over the panel" pattern LeftPanel already uses for
  // pendingCsvUpload/brandMismatchPending: never both rendered at once.
  if (imageGroupImport) {
    return (
      <div className={`w-full min-w-0 flex flex-col gap-3 p-6 h-fit ${cardClass}`}>
        <div>
          <h3 className={sectionHeadingClass}>Image-only product import</h3>
        </div>

        {imageGroupImport.status === 'staging' && (
          <div className="flex flex-col gap-3">
            <p className={bodyTextClass}>
              {imageGroupImport.files.length} / {MAX_IMAGE_GROUPING_BATCH} photos selected
            </p>
            {imageGroupImport.error && (
              <p className="text-sm text-[var(--danger-link-text)]">{imageGroupImport.error}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {imageGroupImport.files.map((file, index) => (
                <div key={index} className="relative shrink-0" style={{ width: 64, height: 64 }}>
                  <ProductThumbnail imageFile={file} imageUrl={null} alt={`Selected photo ${index + 1}`} size={64} />
                  <button
                    type="button"
                    onClick={() => onRemoveStagedImage(index)}
                    aria-label={`Remove photo ${index + 1}`}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-[var(--danger-bg)] text-[var(--danger-text)] border border-[var(--danger-border)] text-xs leading-none hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    ×
                  </button>
                </div>
              ))}
              {imageGroupImport.files.length < MAX_IMAGE_GROUPING_BATCH && (
                <label
                  style={{ width: 64, height: 64 }}
                  className="shrink-0 rounded-md border-2 border-dashed border-[var(--dropzone-border)] flex flex-col items-center justify-center gap-0.5 cursor-pointer text-[var(--muted-text)] hover:text-[var(--heading-text)] hover:border-blue-500 transition-colors"
                >
                  <span className="text-base leading-none">+</span>
                  <span className="text-[9px] leading-none">Add photos</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? [])
                      if (files.length > 0) onStageImageFiles(files)
                      e.target.value = ''
                    }}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* Part 5: exactly ONE action here, decided by the mode chosen
                on the entry screen before any photo was picked. Never both
                buttons together, and never the "Single Product"/"Multiple
                Products" labels again: that choice was already made. */}
            {imageGroupImport.mode === 'single' ? (
              <div className="flex flex-col gap-1">
                <button
                  onClick={onCreateSingleProductFromStaged}
                  disabled={imageGroupImport.files.length === 0}
                  className={buttonPrimaryClass}
                >
                  Add Product
                </button>
                <p className="text-xs text-[var(--muted-text)]">No grouping credits used.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <button
                  onClick={onStartGroupingFromStaged}
                  disabled={imageGroupImport.files.length === 0}
                  className={buttonPrimaryClass}
                >
                  Group &amp; Analyze
                </button>
                <p className="text-xs text-[var(--muted-text)]">
                  Uses {CREDIT_COSTS.imageGroupingRequest} grouping credit{CREDIT_COSTS.imageGroupingRequest === 1 ? '' : 's'}.
                </p>
              </div>
            )}

            <button onClick={onCancelImageGrouping} className={linkButtonClass}>
              Cancel
            </button>
          </div>
        )}

        {imageGroupImport.status === 'creating' && <p className={bodyTextClass}>Uploading your photos…</p>}

        {imageGroupImport.status === 'grouping' && (
          <p className={bodyTextClass}>Uploading and organizing your photos into products…</p>
        )}

        {imageGroupImport.status === 'insufficient_credits' && (
          <div className="flex flex-col gap-3">
            <InsufficientCreditsBanner required={imageGroupImport.required} available={imageGroupImport.available} />
            <button onClick={onCancelImageGrouping} className={linkButtonClass}>
              Cancel
            </button>
          </div>
        )}

        {imageGroupImport.status === 'error' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--danger-link-text)]">Couldn't confidently organize these images.</p>
            <p className={`${bodyTextClass} text-xs`}>{imageGroupImport.message}</p>
            <div className="flex flex-wrap gap-3">
              <button onClick={onRetryImageGrouping} className={buttonPrimaryClass}>
                Try Again
              </button>
              <button onClick={onOrganizeManually} className={buttonSecondaryClass}>
                Organize Manually
              </button>
              <button onClick={onCancelImageGrouping} className={linkButtonClass}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {imageGroupImport.status === 'review' && (
          <div className="flex flex-col gap-3">
            <ImageGroupReview
              totalImages={imageGroupImport.totalImages}
              groups={imageGroupImport.groups}
              onRemoveImage={onRemoveGroupImage}
              onMoveImage={onMoveGroupImage}
              onMergeGroup={onMergeImageGroup}
              onSplitGroup={onSplitImageGroup}
              onResolveReview={onResolveGroupReview}
              onConfirm={onConfirmImageGroups}
              onCancel={onCancelImageGrouping}
            />
          </div>
        )}
      </div>
    )
  }

  // Part 1/5: a signed-in seller adding a NEW product sees the mode choice
  // immediately, before any photo is picked; picking a mode is what opens
  // the uploader above (imageGroupImport becomes a 'staging' state). This
  // never applies while editing an existing product (editingId set: the
  // Edit flow keeps its original single-image form below, unchanged) or for
  // a guest (no session: multi-image/grouping needs one; guests keep the
  // exact original single-image preview form, unchanged).
  if (hasSession && !editingId) {
    return (
      <div className={`w-full min-w-0 flex flex-col gap-3 p-6 h-fit ${cardClass}`}>
        <p className={sectionHeadingClass}>How are you uploading your photos?</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <UploadModeCard
            title="Single Product"
            description="Photos of the same product"
            primary
            onClick={onChooseSingleProductMode}
          />
          <UploadModeCard
            title="Multiple Products"
            description="Photos of different products"
            primary={false}
            onClick={onChooseMultipleProductsMode}
          />
        </div>
      </div>
    )
  }

  // Guest preview, or editing an existing product: the original,
  // unmodified single-image form. Never multi-select here: batch import is
  // exclusively reached via the mode choice above, for a signed-in seller
  // adding a new product.
  return (
    <div className={`w-full min-w-0 flex flex-col gap-3 p-6 h-fit ${cardClass}`}>
      <div>
        <h3 className={sectionHeadingClass}>Have only product photos? That's enough to start.</h3>
        <p className={`${bodyTextClass} mt-1`}>
          Upload a product photo and Tesolute writes the full listing, including title, description, bullets, and
          keywords, from what's visible in the image. You'll see exactly what was detected before you export.
        </p>
      </div>

      <div className="border-2 border-dashed rounded-xl p-6 text-center border-[var(--dropzone-border)] flex flex-col items-center gap-3">
        <ProductThumbnail imageFile={imageFile} imageUrl={formPreviewUrl} alt="Preview" size={96} />
        <label className={`inline-block cursor-pointer ${buttonSecondaryClass}`}>
          {hasImage ? 'Change Image' : 'Upload Product Image'}
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              onImageFileChange(files[0] ?? null)
            }}
            className="hidden"
          />
        </label>
      </div>

      <input
        type="text"
        placeholder="Brand name (optional)"
        value={brandName}
        onChange={(e) => onBrandNameChange(e.target.value)}
        className={inputClass}
      />
      <input
        type="text"
        placeholder="Category (optional)"
        value={category}
        onChange={(e) => onCategoryChange(e.target.value)}
        className={inputClass}
      />
      {formError && <p className="text-sm text-[var(--danger-link-text)]">{formError}</p>}
      {guestLimitReached && (
        <p className="text-sm text-[var(--danger-link-text)]">Free preview limit reached (10/10) - sign in to continue.</p>
      )}

      <button
        onClick={onSubmit}
        disabled={guestLimitReached || uploadingImage || !hasImage}
        className={buttonPrimaryClass}
      >
        {uploadingImage ? 'Uploading Image...' : editingId ? 'Save Changes' : 'Add Product'}
      </button>
    </div>
  )
}
