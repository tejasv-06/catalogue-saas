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
  cardClass
} from '@/lib/uiClasses'

export default function LeftPanel({
  activeTab,
  onTabChange,
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
  onTabChange: (tab: 'manual' | 'csv') => void
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
    <div className="w-[35%] flex flex-col gap-2 h-fit">
      <div className="flex gap-4 border-b mb-2">
        <button
          onClick={() => onTabChange('manual')}
          className={`p-2 text-sm font-medium border-b-2 hover:text-black focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black rounded-t transition-colors ${
            activeTab === 'manual' ? 'border-black text-black' : 'border-transparent text-gray-500'
          }`}
        >
          Manual Entry
        </button>
        <button
          onClick={() => onTabChange('csv')}
          className={`p-2 text-sm font-medium border-b-2 hover:text-black focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black rounded-t transition-colors ${
            activeTab === 'csv' ? 'border-black text-black' : 'border-transparent text-gray-500'
          }`}
        >
          Bulk CSV Upload
        </button>
      </div>

      <div className={`flex flex-col gap-2 p-4 ${cardClass}`}>
        {activeTab === 'manual' ? (
          <>
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
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            {guestLimitReached && (
              <p className="text-sm text-red-600">Free preview limit reached (10/10) — sign in to continue.</p>
            )}
            {brandMismatchPending && selectedClient ? (
              <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 flex flex-col gap-2">
                <p className="text-sm text-amber-800">
                  This product's brand doesn't match your selected brand voice ({selectedClient.client_name}).
                </p>
                <div className="flex flex-wrap gap-2">
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
              <div className="flex gap-2">
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
            <a
              href="/sample-products.csv"
              download
              className="text-blue-600 underline text-sm hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600 rounded transition-colors w-fit"
            >
              Download Sample CSV
            </a>

            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={`border-2 border-dashed rounded-lg p-8 text-center ${
                isDragging ? 'border-black bg-gray-50' : 'border-gray-300'
              }`}
            >
              {csvFile ? (
                <span className="inline-block text-sm bg-green-50 text-green-700 border border-green-200 px-3 py-1 rounded-md mb-2">
                  Selected: {csvFile.name}
                </span>
              ) : (
                <p className="text-sm text-gray-500 mb-2">Drag and drop a CSV file here</p>
              )}
              <label className={`inline-block cursor-pointer ${buttonSecondaryClass}`}>
                Choose file
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => onCsvFileChange(e.target.files?.[0] ?? null)}
                  className="hidden"
                />
              </label>
            </div>

            {guestLimitReached && (
              <p className="text-sm text-red-600">Free preview limit reached (10/10) — sign in to continue.</p>
            )}
            {pendingCsvUpload && selectedClient ? (
              <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 flex flex-col gap-2">
                <p className="text-sm text-amber-800">
                  {pendingCsvUpload.mismatchedProducts.length} of{' '}
                  {pendingCsvUpload.matchingProducts.length + pendingCsvUpload.mismatchedProducts.length} rows don't
                  match your selected brand voice ({selectedClient.client_name}).
                </p>
                <div className="flex flex-col gap-2">
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
              <div className={`overflow-x-auto ${cardClass}`}>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-xs text-gray-500">
                      <th className="p-2">File</th>
                      <th className="p-2">Total</th>
                      <th className="p-2">Added</th>
                      <th className="p-2">Skipped</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="p-2">{csvSummary.fileName}</td>
                      <td className="p-2">{csvSummary.total}</td>
                      <td className="p-2">{csvSummary.added}</td>
                      <td className="p-2">{csvSummary.skipped}</td>
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
