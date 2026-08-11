"use client"

import type { DragEvent, RefObject } from 'react'
import ProductThumbnail from '@/components/ProductThumbnail'
import type { Client } from '@/components/ClientSelector'
import type { CsvSummary, PendingCsvUpload } from '@/lib/types'
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonAmberOutlineClass,
  buttonAmberSolidClass,
  linkButtonClass,
  inputClass,
  cardClass,
  warningBannerClass,
  warningTextClass,
  bodyTextClass
} from '@/lib/uiClasses'

export default function LeftPanel({
  activeTab,
  brandName,
  onBrandNameChange,
  category,
  onCategoryChange,
  description,
  onDescriptionChange,
  imageFile,
  onImageFileChange,
  formPreviewUrl,
  fileInputRef,
  formError,
  guestLimitReached,
  brandMismatchPending,
  selectedClient,
  pendingImageUrl,
  onCommitAddProduct,
  onCancelBrandMismatch,
  onAddProduct,
  onClearForm,
  uploadingImage,
  editingId,
  csvFile,
  onCsvFileChange,
  csvFileInputRef,
  csvSummary,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  pendingCsvUpload,
  onUploadCsv,
  onCsvAddWithoutBrandVoice,
  onCsvAddOnlyMatching,
  onCsvAddAllWithBrandVoice,
  onCsvCancelMismatch
}: {
  activeTab: 'manual' | 'csv'
  brandName: string
  onBrandNameChange: (value: string) => void
  category: string
  onCategoryChange: (value: string) => void
  description: string
  onDescriptionChange: (value: string) => void
  imageFile: File | null
  onImageFileChange: (file: File | null) => void
  formPreviewUrl: string | null
  fileInputRef: RefObject<HTMLInputElement | null>
  formError: string | null
  guestLimitReached: boolean
  brandMismatchPending: boolean
  selectedClient: Client | null
  pendingImageUrl: string | null
  onCommitAddProduct: (skipBrandVoice: boolean, uploadedImageUrl: string | null) => void
  onCancelBrandMismatch: () => void
  onAddProduct: () => void
  onClearForm: () => void
  uploadingImage: boolean
  editingId: string | null
  csvFile: File | null
  onCsvFileChange: (file: File | null) => void
  csvFileInputRef: RefObject<HTMLInputElement | null>
  csvSummary: CsvSummary | null
  isDragging: boolean
  onDragOver: (e: DragEvent<HTMLDivElement>) => void
  onDragLeave: () => void
  onDrop: (e: DragEvent<HTMLDivElement>) => void
  pendingCsvUpload: PendingCsvUpload | null
  onUploadCsv: () => void
  onCsvAddWithoutBrandVoice: () => void
  onCsvAddOnlyMatching: () => void
  onCsvAddAllWithBrandVoice: () => void
  onCsvCancelMismatch: () => void
}) {
  return (
    <div className={`w-full min-w-0 flex flex-col gap-2 p-6 h-fit ${cardClass}`}>
      <div className="flex flex-col gap-2">
        {activeTab === 'manual' ? (
          <>
            {/* One-line purpose statement, matching the same pattern
                ImageOnlyPanel already uses — the tab label alone ("Manual
                Entry") named the mechanism but not the purpose; this closes
                that gap for consistency across all three methods. */}
            <p className={bodyTextClass}>Add a product manually.</p>
            <input
              type="text"
              placeholder="Brand name"
              value={brandName}
              onChange={(e) => onBrandNameChange(e.target.value)}
              className={inputClass}
            />
            <input
              type="text"
              placeholder="Category"
              value={category}
              onChange={(e) => onCategoryChange(e.target.value)}
              className={inputClass}
            />
            {/* Limited to what the app already knows going into generation —
                not a new attribute taxonomy, just surfacing the one gap that
                affects listing quality before the user submits instead of
                only after. Only shown once the user has actually started
                filling the form, not on a blank first load. */}
            {!category.trim() && (brandName.trim() || description.trim()) && (
              <p className="text-xs text-[var(--warn-text)]">⚠ Category missing — add category for better results</p>
            )}
            <textarea
              placeholder="Description"
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              className={inputClass}
            />
            <div className="flex items-center gap-2 min-w-0">
              <label className={`flex-1 min-w-0 truncate text-center cursor-pointer ${buttonSecondaryClass}`}>
                Upload Product Image
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={(e) => onImageFileChange(e.target.files?.[0] ?? null)}
                  className="hidden"
                />
              </label>
              <ProductThumbnail imageFile={imageFile} imageUrl={formPreviewUrl} alt="Preview" size={48} />
            </div>
            {formError && <p className="text-sm text-[var(--danger-link-text)]">{formError}</p>}
            {guestLimitReached && (
              <p className="text-sm text-[var(--danger-link-text)]">Free preview limit reached (10/10) - sign in to continue.</p>
            )}
            {brandMismatchPending && selectedClient ? (
              <div className={`flex flex-col gap-2 ${warningBannerClass}`}>
                <p className={warningTextClass}>
                  This product's brand doesn't match your selected brand voice ({selectedClient.client_name}).
                </p>
                <div className="flex flex-wrap gap-3">
                  <button onClick={() => onCommitAddProduct(true, pendingImageUrl)} className={buttonAmberOutlineClass}>
                    Add without brand voice
                  </button>
                  <button onClick={() => onCommitAddProduct(false, pendingImageUrl)} className={buttonAmberSolidClass}>
                    Add anyway with {selectedClient.client_name} voice
                  </button>
                  <button onClick={onCancelBrandMismatch} className={linkButtonClass}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-row gap-3">
                <button
                  onClick={onAddProduct}
                  disabled={guestLimitReached || uploadingImage}
                  className={`flex-1 ${buttonPrimaryClass}`}
                >
                  {uploadingImage ? 'Uploading Image...' : editingId ? 'Save Changes' : 'Add Product'}
                </button>
                <button onClick={onClearForm} className={buttonSecondaryClass}>
                  Clear Form
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Same purpose-statement pattern as Manual Entry above and
                ImageOnlyPanel's existing intro line — Bulk Upload's own
                purpose ("add many at once") isn't obvious from the tab
                label alone. */}
            <p className={bodyTextClass}>Add hundreds of products at once.</p>
            <a
              href="/sample-products.csv"
              download
              className="text-sm underline w-fit rounded transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--card-bg)] focus:ring-blue-500 text-blue-600 hover:opacity-80"
            >
              Download Sample CSV
            </a>

            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                isDragging ? 'border-blue-500 bg-[var(--drop-active-bg)]' : 'border-[var(--dropzone-border)]'
              }`}
            >
              {csvFile ? (
                <span className="inline-block text-sm px-3 py-1 rounded-md mb-2 border bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]">
                  Selected: {csvFile.name}
                </span>
              ) : (
                <p className="text-sm text-[var(--muted-text)] mb-2">Drag and drop a CSV file here</p>
              )}
              <label className={`inline-block cursor-pointer ${buttonSecondaryClass}`}>
                Choose file
                <input
                  type="file"
                  accept=".csv"
                  ref={csvFileInputRef}
                  onChange={(e) => onCsvFileChange(e.target.files?.[0] ?? null)}
                  className="hidden"
                />
              </label>
            </div>

            {guestLimitReached && (
              <p className="text-sm text-[var(--danger-link-text)]">Free preview limit reached (10/10) - sign in to continue.</p>
            )}
            {pendingCsvUpload && selectedClient ? (
              <div className={`flex flex-col gap-2 ${warningBannerClass}`}>
                <p className={warningTextClass}>
                  {pendingCsvUpload.mismatchedProducts.length} of{' '}
                  {pendingCsvUpload.matchingProducts.length + pendingCsvUpload.mismatchedProducts.length} rows don't
                  match your selected brand voice ({selectedClient.client_name}).
                </p>
                <div className="flex flex-col gap-3">
                  <button onClick={onCsvAddWithoutBrandVoice} className={`${buttonAmberOutlineClass} text-left`}>
                    Add all without brand voice
                  </button>
                  <button onClick={onCsvAddOnlyMatching} className={`${buttonAmberOutlineClass} text-left`}>
                    Add only matching rows with brand voice, skip mismatches
                  </button>
                  <button onClick={onCsvAddAllWithBrandVoice} className={`${buttonAmberSolidClass} text-left`}>
                    Add all anyway with {selectedClient.client_name} voice
                  </button>
                  <button onClick={onCsvCancelMismatch} className={`${linkButtonClass} text-left`}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={onUploadCsv} disabled={guestLimitReached} className={buttonPrimaryClass}>
                Upload CSV
              </button>
            )}

            {csvSummary && (
              // Milestone C17 — "give us your product data, we'll tell you
              // what we can work with" instead of a File/Total/Added/
              // Skipped data table. Same exact numbers csvSummary already
              // carried (added = queued as a real draft product, skipped =
              // missing what commitCsvUpload's own row validation requires
              // — never a claim that intelligence/analysis has run, since
              // that's still a separate, explicit "Analyze Product" step).
              <div className={`p-4 flex flex-col gap-1.5 ${cardClass}`}>
                <p className="text-sm font-medium text-[var(--heading-text)]" title={csvSummary.fileName}>
                  {csvSummary.total} product{csvSummary.total === 1 ? '' : 's'} received
                </p>
                {csvSummary.added > 0 && (
                  <p className="text-sm text-[var(--success-text)]">
                    ✓ {csvSummary.added} ready to create
                  </p>
                )}
                {csvSummary.skipped > 0 && (
                  <p className="text-sm text-[var(--warn-text)]">
                    ⚠ {csvSummary.skipped} need a brand name plus a description or photo before Tesolute can use them
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
