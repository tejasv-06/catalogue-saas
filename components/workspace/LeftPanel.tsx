"use client"

import type { DragEvent, RefObject } from 'react'
import ManualEntryImages from '@/components/workspace/ManualEntryImages'
import type { Client } from '@/components/ClientSelector'
import type { CsvSummary, PendingCsvUpload, ManualImageSlot } from '@/lib/types'
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
  manualImages,
  onAddManualImages,
  onRemoveManualImage,
  onMoveManualImage,
  manualImageInputRef,
  formError,
  guestLimitReached,
  brandMismatchPending,
  selectedClient,
  pendingImageUrls,
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
  manualImages: ManualImageSlot[]
  onAddManualImages: (files: File[]) => void
  onRemoveManualImage: (index: number) => void
  onMoveManualImage: (index: number, direction: -1 | 1) => void
  manualImageInputRef: RefObject<HTMLInputElement | null>
  formError: string | null
  guestLimitReached: boolean
  brandMismatchPending: boolean
  selectedClient: Client | null
  pendingImageUrls: string[]
  onCommitAddProduct: (skipBrandVoice: boolean, uploadedImageUrls: string[]) => void
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
                ImageOnlyPanel already uses: the tab label alone ("Manual
                Entry") named the mechanism but not the purpose; this closes
                that gap for consistency across all three methods. */}
            <p className={bodyTextClass}>Add a product manually.</p>
            {/* Milestone C17.1: images first: this is one product with up
                to 5 images, not a single-image field among several text
                fields, so it leads the form rather than trailing after
                Description like the old single-image picker did. */}
            <ManualEntryImages
              images={manualImages}
              onAddFiles={onAddManualImages}
              onRemove={onRemoveManualImage}
              onMove={onMoveManualImage}
              inputRef={manualImageInputRef}
            />
            <input
              type="text"
              placeholder="Brand name"
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
            <textarea
              placeholder="Description"
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              className={inputClass}
            />
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
                  <button onClick={() => onCommitAddProduct(true, pendingImageUrls)} className={buttonAmberOutlineClass}>
                    Add without brand voice
                  </button>
                  <button onClick={() => onCommitAddProduct(false, pendingImageUrls)} className={buttonAmberSolidClass}>
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
                ImageOnlyPanel's existing intro line: Bulk Upload's own
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
              (() => {
                const matchingCount = pendingCsvUpload.matchingProducts.length
                const mismatchedCount = pendingCsvUpload.mismatchedProducts.length
                const validCount = matchingCount + mismatchedCount
                const brand = selectedClient.client_name
                return (
                  <div className={`flex flex-col gap-3 ${warningBannerClass}`}>
                    <p className={warningTextClass}>
                      {mismatchedCount} of {validCount} rows don't match your selected brand voice ({brand}). Choose
                      what to do with them:
                    </p>
                    <div className="flex flex-col gap-2">
                      {/* Each option spells out BOTH things that actually
                          differ between them: which rows get added, and
                          whether {brand}'s guidelines apply to them: as a
                          bold action plus a one-line explanation, rather
                          than packing both into one dense sentence a seller
                          has to parse three times to tell them apart. */}
                      <button
                        onClick={onCsvAddWithoutBrandVoice}
                        className={`${buttonAmberOutlineClass} text-left flex flex-col items-start gap-0.5`}
                      >
                        <span className="font-semibold">Add all {validCount} rows, without {brand}'s voice</span>
                        <span className="text-xs font-normal opacity-90">
                          Every row gets added, but none of them will use {brand}'s brand voice: including the{' '}
                          {matchingCount} that do match.
                        </span>
                      </button>
                      <button
                        onClick={onCsvAddOnlyMatching}
                        className={`${buttonAmberOutlineClass} text-left flex flex-col items-start gap-0.5`}
                      >
                        <span className="font-semibold">Add only the {matchingCount} matching rows</span>
                        <span className="text-xs font-normal opacity-90">
                          Uses {brand}'s brand voice. The {mismatchedCount} mismatched rows are skipped: not added
                          at all.
                        </span>
                      </button>
                      <button
                        onClick={onCsvAddAllWithBrandVoice}
                        className={`${buttonAmberSolidClass} text-left flex flex-col items-start gap-0.5`}
                      >
                        <span className="font-semibold">Add all {validCount} rows with {brand}'s voice anyway</span>
                        <span className="text-xs font-normal opacity-90">
                          Applies {brand}'s brand voice to every row, including the {mismatchedCount} that don't
                          match.
                        </span>
                      </button>
                      <button onClick={onCsvCancelMismatch} className={`${linkButtonClass} text-left`}>
                        Cancel: don't add any of these rows yet
                      </button>
                    </div>
                  </div>
                )
              })()
            ) : (
              <button onClick={onUploadCsv} disabled={guestLimitReached} className={buttonPrimaryClass}>
                Upload CSV
              </button>
            )}

            {csvSummary && (
              // table-fixed + a truncated File cell: without it, the browser's
              // auto table layout gives File almost no width (the three
              // number columns are just single digits) and wraps a real
              // filename across five or six lines instead of letting it
              // scroll or truncate: uglier than either alternative, and on
              // an unbreakable filename (no hyphens/spaces) it would
              // overflow the card horizontally instead. title= on the cell
              // still shows the full name on hover.
              <div className={`overflow-x-auto ${cardClass}`}>
                <table className="w-full table-fixed border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--row-border)] bg-[var(--table-head-bg)] text-left text-xs text-[var(--muted-text)]">
                      <th className="py-3 px-4">File</th>
                      <th className="py-3 px-4 w-16">Total</th>
                      <th className="py-3 px-4 w-16">Added</th>
                      <th className="py-3 px-4 w-16">Skipped</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="text-[var(--body-text)]">
                      <td className="py-3 px-4 truncate" title={csvSummary.fileName}>
                        {csvSummary.fileName}
                      </td>
                      <td className="py-3 px-4">{csvSummary.total}</td>
                      <td className="py-3 px-4">{csvSummary.added}</td>
                      <td className="py-3 px-4">{csvSummary.skipped}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
