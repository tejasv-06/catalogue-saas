"use client"

import type { RefObject } from 'react'
import ProductThumbnail from '@/components/ProductThumbnail'
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  cardClass,
  sectionHeadingClass,
  bodyTextClass
} from '@/lib/uiClasses'

// Deliberately trimmed relative to LeftPanel's manual-entry form: no
// description field. Brand name / category stay as optional context for the
// AI, not requirements — the image is the only thing this flow actually
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
  editingId
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
}) {
  const hasImage = !!(imageFile || formPreviewUrl)

  return (
    <div className={`w-full min-w-0 flex flex-col gap-3 p-6 h-fit ${cardClass}`}>
      <div>
        <h3 className={sectionHeadingClass}>Have only product photos? That's enough to start.</h3>
        <p className={`${bodyTextClass} mt-1`}>
          Upload a product photo and Tesolute writes the full listing — title, description, bullets, keywords —
          from what's visible in the image. You'll see exactly what was detected before you export.
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
            onChange={(e) => onImageFileChange(e.target.files?.[0] ?? null)}
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
      {!category.trim() && hasImage && (
        <p className="text-xs text-[var(--warn-text)]">⚠ Category missing — add category for better results</p>
      )}

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
