"use client"

import type { RefObject } from 'react'
import ProductThumbnail from '@/components/ProductThumbnail'
import { MAX_MANUAL_IMAGES, type ManualImageSlot } from '@/lib/types'
import { labelClass, bodyTextClass } from '@/lib/uiClasses'

// Milestone C17.1: Manual Entry's multi-image picker. Replaces the single
// "Upload Product Image" input with a compact grid of up to
// MAX_MANUAL_IMAGES thumbnails (fixed-size, matching ProductThumbnail's own
// pixel-size API, not a responsive aspect-square grid: this is what lets
// the row wrap naturally at narrow panel widths per the milestone's own
// spec, and keeps ProductThumbnail completely unmodified/reused as-is,
// rendered once per slot). Every image is ONE product's images, never
// separate products: order here IS the persisted order (DraftProduct.
// imageUrls / catalog_products.image_urls), and the first slot is always
// the primary image (labeled, never silently reassigned by anything,
// including AI analysis).
//
// No drag-and-drop library: this codebase has no existing reorder pattern
// to reuse (verified before writing this file), and the milestone spec
// explicitly says not to introduce a complex one: small ‹/› move buttons
// are the smallest mechanism that actually reorders.
export default function ManualEntryImages({
  images,
  onAddFiles,
  onRemove,
  onMove,
  inputRef
}: {
  images: ManualImageSlot[]
  onAddFiles: (files: File[]) => void
  onRemove: (index: number) => void
  onMove: (index: number, direction: -1 | 1) => void
  inputRef: RefObject<HTMLInputElement | null>
}) {
  const tileSize = 72
  // Every empty slot up to the cap gets its own "Add Image" tile, not just
  // one: makes the "up to 5" capacity visible at a glance (per §11/§12:
  // "the seller must immediately understand that they can add multiple
  // images") rather than implied by a counter next to a single tile.
  // Clicking ANY of them opens the same file picker (see the one shared,
  // standalone hidden <input> below): multi-select there can still fill
  // several of these tiles in one pick.
  const emptySlotCount = MAX_MANUAL_IMAGES - images.length

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className={labelClass}>Images</p>
        {images.length > 0 && (
          <span className="text-xs text-[var(--muted-text)]">
            {images.length} / {MAX_MANUAL_IMAGES} images
          </span>
        )}
      </div>
      <p className={`${bodyTextClass} text-xs mt-0.5 mb-2`}>Add up to {MAX_MANUAL_IMAGES} product images.</p>

      <div className="flex flex-wrap gap-2">
        {images.map((slot, index) => (
          <div key={index} className="relative shrink-0" style={{ width: tileSize, height: tileSize }}>
            <ProductThumbnail imageFile={slot.file} imageUrl={slot.url} alt={`Product image ${index + 1}`} size={tileSize} />

            {index === 0 && (
              <span className="absolute bottom-0 left-0 right-0 rounded-b-md text-[9px] font-medium text-center bg-black/60 text-white py-0.5 pointer-events-none">
                Primary
              </span>
            )}

            <button
              type="button"
              onClick={() => onRemove(index)}
              aria-label={`Remove product image ${index + 1}`}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-[var(--danger-bg)] text-[var(--danger-text)] border border-[var(--danger-border)] text-xs leading-none hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              ×
            </button>

            {images.length > 1 && (
              <div className="absolute top-0.5 left-0.5 flex gap-0.5">
                {index > 0 && (
                  <button
                    type="button"
                    onClick={() => onMove(index, -1)}
                    aria-label={`Move product image ${index + 1} earlier`}
                    title="Move earlier"
                    className="w-4 h-4 flex items-center justify-center rounded bg-black/60 text-white text-[10px] leading-none hover:bg-black/80"
                  >
                    ‹
                  </button>
                )}
                {index < images.length - 1 && (
                  <button
                    type="button"
                    onClick={() => onMove(index, 1)}
                    aria-label={`Move product image ${index + 1} later`}
                    title="Move later"
                    className="w-4 h-4 flex items-center justify-center rounded bg-black/60 text-white text-[10px] leading-none hover:bg-black/80"
                  >
                    ›
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {/* One real input, standalone (not wrapped in any one tile): every
            empty tile below just calls .click() on it, so all of them open
            the exact same multi-select file picker. */}
        <input
          type="file"
          accept="image/*"
          multiple
          ref={inputRef}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) onAddFiles(files)
            // Uncontrolled native input: cleared immediately so picking
            // the exact same file again later (e.g. after removing it)
            // still fires onChange.
            e.target.value = ''
          }}
          className="hidden"
        />

        {/* One tile per remaining slot: never more than MAX_MANUAL_IMAGES
            tiles total (filled + empty combined), so this can never offer a
            6th image. */}
        {Array.from({ length: emptySlotCount }).map((_, i) => (
          <button
            key={`empty-${i}`}
            type="button"
            onClick={() => inputRef.current?.click()}
            style={{ width: tileSize, height: tileSize }}
            className="shrink-0 rounded-md border-2 border-dashed border-[var(--dropzone-border)] flex flex-col items-center justify-center gap-0.5 cursor-pointer text-[var(--muted-text)] hover:text-[var(--heading-text)] hover:border-blue-500 transition-colors"
          >
            <span className="text-base leading-none">+</span>
            <span className="text-[10px] leading-none">Add Image</span>
          </button>
        ))}
      </div>
    </div>
  )
}
