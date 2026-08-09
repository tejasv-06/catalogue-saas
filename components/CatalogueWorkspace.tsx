"use client"

import { useEffect, useRef, useState, type DragEvent, type RefObject } from 'react'
import Papa from 'papaparse'
import JSZip from 'jszip'
import { pick } from '@/lib/csvMapping'
import { exportColumns, flattenRow } from '@/lib/exportShapers'
import { type Client } from '@/components/ClientSelector'
import StatusBadge from '@/components/StatusBadge'
import ProductThumbnail from '@/components/ProductThumbnail'
import AppHeader from '@/components/AppHeader'
import TopHeader from '@/components/TopHeader'
import LeftPanel from '@/components/workspace/LeftPanel'
import ImageOnlyPanel from '@/components/workspace/ImageOnlyPanel'
import AppSidebar, { type WorkspaceDestination } from '@/components/AppSidebar'
import QueueTable from '@/components/workspace/QueueTable'
import ListingHealthBadge from '@/components/workspace/ListingHealthBadge'
import { computeListingHealth, FIELD_SPECS } from '@/lib/listingHealth'
import { createClient } from '@/lib/supabase/client'
import CreditsBalance, { notifyCreditsChanged } from '@/components/CreditsBalance'
import { CREDIT_COSTS } from '@/lib/creditCosts'
import { useFocusTrap } from '@/lib/useFocusTrap'
import { SUPPORTED_MARKETPLACES, MARKETPLACE_LABELS } from '@/lib/platformShapers'
import {
  type DraftProduct,
  type Marketplace,
  type CsvSummary,
  type PendingCsvUpload,
  emptyGeneratedContent,
  emptyApproved,
  emptyGenerationError,
  emptyGenerationMeta
} from '@/lib/types'
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonDestructiveClass,
  buttonWarningClass,
  buttonSecondarySmallClass,
  linkButtonClass,
  sectionHeadingClass,
  labelClass,
  bodyTextClass,
  cardClass,
  warningBannerClass,
  warningTextClass,
  dangerBannerClass,
  dangerTextClass
} from '@/lib/uiClasses'
import Link from 'next/link'

const SESSION_STORAGE_KEY = 'catalogue-draft-session'
const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000
// Bumped whenever the saved-session payload's shape changes in a way a
// straight JSON restore can't safely absorb — e.g. this refactor, which
// replaced generatedContent/status/approved's flat shape with a nested
// per-marketplace one. A session saved under a different version is
// discarded rather than restored (see the mount-time read effect below):
// this is exactly the kind of shape drift that broke crash-recovery once
// before, so no attempt is made to guess a migration.
const SESSION_SCHEMA_VERSION = 2

// Above this, a picked-but-not-yet-submitted form image is simply not persisted
// (falls back to today's behavior: lost on refresh) rather than risking a
// localStorage quota error on write, which could otherwise silently break
// persistence for the whole session, not just the image.
const MAX_PERSISTABLE_IMAGE_BYTES = 2 * 1024 * 1024

const GUEST_PRODUCT_LIMIT = 10

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Which shaped-content keys count as "the title" / "the bullets" / "the
// description" varies per marketplace (Myntra has no single title field —
// vendorArticleName, listViewName, and productDisplayName are all
// title-derived; Etsy/Myntra have no bullets-equivalent field at all).
// Field-level regenerate uses this to know which keys from a fresh
// generation response to keep, and which to discard in favor of the
// existing content — see generateForProductMarketplace's fieldGroup param.
// The three ways to add products — previously top-level sidebar nav items,
// now an in-panel tab-strip (see the "Add Products" section in the render
// below) since they're input methods into one Listings workspace, not
// separate destinations. Same WorkspaceDestination values AppSidebar
// originally drove, same activeTab state, just switched from here instead.
const ADD_METHOD_TABS: { id: WorkspaceDestination; label: string }[] = [
  { id: 'csv', label: 'Bulk Upload' },
  { id: 'manual', label: 'Manual Entry' },
  { id: 'image', label: 'Photos Only' }
]

// Same states computeListingHealth already reports per (product, marketplace)
// row — 'all' is the only addition, and it's just "no filter applied," not a
// new status. No second health engine, no new statuses invented. Exported so
// QueueTable can filter its own rows at the exact same (product, marketplace)
// granularity it renders at — filtering lives entirely in QueueTable now
// (see filterRowData/productHasVisibleRow there), not here, so a product with
// one Ready and one Needs Review marketplace shows only the matching row
// under either filter instead of both.
export type ReadinessFilter = 'all' | 'ready' | 'needs-review' | 'missing-data' | 'error'
const FILTER_OPTIONS: { id: ReadinessFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'Ready' },
  { id: 'needs-review', label: 'Needs Review' },
  { id: 'missing-data', label: 'Missing Data' },
  { id: 'error', label: 'Error' }
]

// Compact single-line summary, not a stat-card grid — counts real
// (product, marketplace) pairs that have actually been attempted (content
// or error present), using the exact same computeListingHealth call
// QueueTable's own rows use. A draft product with nothing generated yet
// isn't counted as a "listing" here, same as it isn't shown as a real
// health-bearing row in the table.
function computeListingSummary(draftProducts: DraftProduct[]) {
  const counts = { total: 0, ready: 0, needsReview: 0, missingData: 0, error: 0 }
  for (const product of draftProducts) {
    for (const m of SUPPORTED_MARKETPLACES) {
      const content = product.generatedContent[m]
      const error = product.generationError[m]
      if (content === null && error === null) continue
      counts.total++
      const status = computeListingHealth(m, content, error, product.generationMeta[m]).status
      if (status === 'ready') counts.ready++
      else if (status === 'needs-review') counts.needsReview++
      else if (status === 'missing-data') counts.missingData++
      else if (status === 'error') counts.error++
    }
  }
  return counts
}

type FieldGroup = 'title' | 'bullets' | 'description'
const FIELD_GROUPS: Record<Marketplace, Partial<Record<FieldGroup, string[]>>> = {
  amazon: { title: ['title'], bullets: ['bullets'], description: ['description'] },
  flipkart: { title: ['title'], bullets: ['keyFeatures'], description: ['description'] },
  myntra: { title: ['vendorArticleName', 'listViewName', 'productDisplayName'], description: ['productDetails'] },
  etsy: { title: ['title'], description: ['description'] }
}

// Friendly labels for every shaped-content key across all four marketplaces
// — used only for display grouping below, doesn't affect what's generated.
const KEY_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  bullets: 'Bullets',
  genericKeywords: 'Generic Keywords',
  keyFeatures: 'Key Features',
  searchKeywords: 'Search Keywords',
  vendorArticleName: 'Vendor Article Name',
  listViewName: 'List View Name',
  productDetails: 'Product Details',
  styleNote: 'Style Note',
  productDisplayName: 'Product Display Name',
  tags: 'Tags'
}

type DisplayField = { label: string; value: string | string[] }
type FieldSectionData = { role: FieldGroup | 'keywords' | 'other'; heading: string; fields: DisplayField[] }

// Groups one marketplace's shaped content by role (Title/Bullets/Description/
// Keywords/other required fields) using the same FIELD_SPECS + FIELD_GROUPS
// maps computeListingHealth checks against — so a section's inline
// pass/fail annotation and the content shown under it are guaranteed to be
// talking about the same keys. "other" catches marketplace-specific required
// fields that aren't title/bullets/description/keywords (e.g. Myntra's
// Style Note), so nothing required silently goes undisplayed.
function getFieldSections(marketplace: Marketplace, content: any): FieldSectionData[] {
  const spec = FIELD_SPECS[marketplace]
  const titleKeys = FIELD_GROUPS[marketplace].title ?? [spec.titleKey]
  const bulletsKeys = spec.bulletsKey ? [spec.bulletsKey] : []
  const descriptionKeys = spec.descriptionKey ? [spec.descriptionKey] : []
  const keywordsKeys = spec.keywordsKey ? [spec.keywordsKey] : []
  const usedKeys = new Set([...titleKeys, ...bulletsKeys, ...descriptionKeys, ...keywordsKeys])
  const otherKeys = spec.requiredKeys.filter((key) => !usedKeys.has(key))

  const toFields = (keys: string[]): DisplayField[] =>
    keys.map((key) => ({ label: KEY_LABELS[key] ?? key, value: content[key] ?? '' }))

  const sections: FieldSectionData[] = [
    { role: 'title', heading: 'Title', fields: toFields(titleKeys) },
    { role: 'bullets', heading: 'Bullets', fields: toFields(bulletsKeys) },
    { role: 'description', heading: 'Description', fields: toFields(descriptionKeys) },
    { role: 'keywords', heading: 'Keywords', fields: toFields(keywordsKeys) },
    { role: 'other', heading: 'Marketplace Fields', fields: toFields(otherKeys) }
  ]

  return sections.filter((s) => s.fields.length > 0)
}

function isEmptyFieldValue(value: string | string[]): boolean {
  return Array.isArray(value) ? value.length === 0 : !String(value ?? '').trim()
}

// One field group's label line + its own small pass/fail annotation (pulled
// straight from computeListingHealth's checks, never a separate score) with
// the actual generated content directly beneath — content stays the larger,
// dominant text throughout, the check is a compact suffix on the label only.
function FieldSection({
  section,
  check
}: {
  section: FieldSectionData
  check?: { passed: boolean; detail?: string; subDetail?: string }
}) {
  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className={labelClass}>{section.heading}</p>
        {check && (
          <span className={`text-xs shrink-0 text-right ${check.passed ? 'text-[var(--success-text)]' : 'text-[var(--warn-text)]'}`}>
            <span className="block">
              {check.passed ? '✓' : '⚠'} {check.detail}
            </span>
            {/* Second line explaining WHAT the count means, e.g. "Title
                exceeds Amazon's limit" / "Within Amazon title limit" —
                not just a bare number the user has to interpret. */}
            {check.subDetail && <span className="block opacity-80">{check.subDetail}</span>}
          </span>
        )}
      </div>
      <div className="mt-1 space-y-2">
        {section.fields.map((field) => (
          <div key={field.label}>
            {section.fields.length > 1 && <p className="text-xs text-[var(--muted-text)]">{field.label}</p>}
            {Array.isArray(field.value) ? (
              <ul className="text-sm text-[var(--body-text)] list-disc list-inside space-y-0.5">
                {field.value.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--body-text)]">{field.value || '—'}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// A QueueTable row is one (product, marketplace) pair, and "View Content"
// on that row must review exactly that pair — not every marketplace the
// product has ever been generated for. `marketplace` is the one the row was
// clicked for; attemptedMarketplaces is now always that single value (never
// derived from the product as a whole), so every per-marketplace read below
// — content, error, health, regenerate, approve — reads that one
// marketplace's own state and nothing else.
function GeneratedListingDrawer({
  product,
  marketplace,
  currentlyGenerating,
  failedRegenFieldGroup,
  onClose,
  onApproveMarketplace,
  onUnapproveMarketplace,
  onRetryMarketplace,
  onRegenerateField
}: {
  product: DraftProduct
  marketplace: Marketplace
  currentlyGenerating: { productId: string; marketplace: Marketplace } | null
  failedRegenFieldGroup: Record<string, FieldGroup | 'full'>
  onClose: () => void
  onApproveMarketplace: (id: string, marketplace: Marketplace) => void
  onUnapproveMarketplace: (id: string, marketplace: Marketplace) => void
  onRetryMarketplace: (id: string, marketplace: Marketplace) => void
  onRegenerateField: (id: string, marketplace: Marketplace, fieldGroup?: FieldGroup) => void
}) {
  const attemptedMarketplaces = [marketplace]

  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, onClose)

  // Only ever surfaced when at least one attribute has a real value — an
  // image analyzed with every key coming back null shouldn't present an
  // empty "Detected from image" section as if something had been found.
  const detectedAttributes = product.visualAttributes
    ? Object.entries(product.visualAttributes).filter(([, value]) => value != null && String(value).trim() !== '')
    : []
  const hasVisualAttributes = detectedAttributes.length > 0

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Generated Listings"
        className="relative w-full max-w-md border-l h-full p-6 overflow-y-auto shadow-xl focus:outline-none bg-[var(--card-bg)] border-[var(--card-border)]"
      >
        <div className="mb-4 flex items-center gap-2">
          <h2 className={sectionHeadingClass}>Generated Listings</h2>
          <StatusBadge status={product.status} />
        </div>

        <div className="flex items-center gap-3 mb-4">
          <ProductThumbnail imageFile={product.imageFile} imageUrl={product.imageUrl} alt={product.brandName} size={60} />
          <div>
            <p className="font-medium text-[var(--heading-text)]">{product.brandName}</p>
            <p className="text-sm text-[var(--muted-text)]">{product.category}</p>
          </div>
        </div>

        {hasVisualAttributes && (
          <div className="mb-4 pb-4 border-b border-[var(--card-border)]">
            <p className={labelClass}>Detected from image</p>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
              {detectedAttributes.map(([key, value]) => (
                <p key={key} className="text-sm text-[var(--body-text)] capitalize">
                  <span className="text-[var(--muted-text)]">{key}: </span>
                  {value}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4">
          {/* Product → Marketplace → Listing Content → Validation/Issues →
              Approve, per marketplace: content is the dominant element in
              every section below, health is a compact status chip up top
              and small inline annotations on each field's own label line —
              never a separate checklist preceding the content. */}
          {attemptedMarketplaces.map((marketplace) => {
            const content = product.generatedContent[marketplace]
            const error = product.generationError[marketplace]
            const isApproved = product.approved[marketplace]
            const health = computeListingHealth(marketplace, content, error, product.generationMeta[marketplace])
            const findCheck = (label: string) => health.checks.find((c) => c.label === label)
            const sections = content ? getFieldSections(marketplace, content) : []
            const fieldGroups = FIELD_GROUPS[marketplace]

            const isGenerating =
              currentlyGenerating?.productId === product.id && currentlyGenerating?.marketplace === marketplace

            // A failed field-level regenerate leaves the old content in
            // place (see runGeneration/generateForProductMarketplace) — so
            // content and error can be true at once here. That combination
            // only ever means "a regenerate attempt on an existing listing
            // failed," never "the whole listing is broken," and the UI
            // below treats it accordingly: no full-width error banner, no
            // generic full-listing retry button, just the specific field
            // section flagged and its own regenerate button as the fix.
            const failedGroup = content && error ? failedRegenFieldGroup[`${product.id}:${marketplace}`] : undefined

            const titleCheck = findCheck('Title')
            const charLimitCheck = findCheck('Character limit')
            const titleAnnotation =
              titleCheck && !titleCheck.passed
                ? { passed: false, detail: titleCheck.detail ?? 'Missing' }
                : charLimitCheck
                  ? { passed: charLimitCheck.passed, detail: charLimitCheck.detail, subDetail: charLimitCheck.subDetail }
                  : undefined

            const otherSection = sections.find((s) => s.role === 'other')
            // Scoped to exactly this section's own fields (e.g. just Myntra's
            // Style Note) rather than the overall Required Fields check,
            // which also covers title/description/keywords keys already
            // annotated in their own sections above — reusing that check's
            // text here would restate "vendorArticleName missing" a second
            // time under an unrelated field.
            const otherMissing = otherSection ? otherSection.fields.filter((f) => isEmptyFieldValue(f.value)).map((f) => f.label) : []

            const failedCheck = { passed: false as const, detail: 'Regeneration failed' }

            const checkForRole: Partial<Record<FieldSectionData['role'], { passed: boolean; detail?: string; subDetail?: string }>> = {
              title: failedGroup === 'title' ? failedCheck : titleAnnotation,
              bullets:
                failedGroup === 'bullets'
                  ? failedCheck
                  : (() => {
                      const c = findCheck('Bullets')
                      return c ? { passed: c.passed, detail: c.detail } : undefined
                    })(),
              description:
                failedGroup === 'description'
                  ? failedCheck
                  : (() => {
                      const c = findCheck('Description')
                      return c
                        ? { passed: c.passed, detail: c.detail ?? (c.passed ? 'Present' : 'Missing'), subDetail: c.subDetail }
                        : undefined
                    })(),
              keywords: (() => {
                const c = findCheck('Keywords')
                return c ? { passed: c.passed, detail: c.detail ?? (c.passed ? 'Present' : 'Missing') } : undefined
              })(),
              other: otherSection
                ? { passed: otherMissing.length === 0, detail: otherMissing.length === 0 ? 'Complete' : `Missing: ${otherMissing.join(', ')}` }
                : undefined
            }

            return (
              <div key={marketplace} className="pt-4 border-t border-[var(--card-border)] first:pt-0 first:border-t-0">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-[var(--heading-text)]">{MARKETPLACE_LABELS[marketplace]}</h3>
                  <div className="flex items-center gap-2">
                    {isApproved && <StatusBadge status="approved" />}
                    {(content || error) && <ListingHealthBadge status={isGenerating ? 'generating' : health.status} />}
                  </div>
                </div>

                {/* True first-ever-attempt failure (no content exists yet) —
                    unchanged from before: full-width banner, generic retry. */}
                {error && !content && (
                  <div className={`mb-3 ${dangerBannerClass}`}>
                    <p className={dangerTextClass}>{error}</p>
                  </div>
                )}

                {/* A "Regenerate Entire Listing" attempt failed but the old
                    listing is still intact — a small note, not an alarming
                    banner, and no field section to attach it to. */}
                {error && content && failedGroup === 'full' && (
                  <p className="mb-3 text-xs text-[var(--warn-text)]">
                    ⚠ Full listing regeneration failed — your existing listing is unchanged
                  </p>
                )}

                {content && (
                  <div className="mb-3">
                    {sections.map((section) => (
                      <FieldSection key={section.role} section={section} check={checkForRole[section.role]} />
                    ))}
                  </div>
                )}

                {content && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {fieldGroups.title && (
                      <button
                        onClick={() => onRegenerateField(product.id, marketplace, 'title')}
                        disabled={isGenerating}
                        className={buttonSecondarySmallClass}
                      >
                        Regenerate Title
                      </button>
                    )}
                    {fieldGroups.bullets && (
                      <button
                        onClick={() => onRegenerateField(product.id, marketplace, 'bullets')}
                        disabled={isGenerating}
                        className={buttonSecondarySmallClass}
                      >
                        Regenerate Bullets
                      </button>
                    )}
                    {fieldGroups.description && (
                      <button
                        onClick={() => onRegenerateField(product.id, marketplace, 'description')}
                        disabled={isGenerating}
                        className={buttonSecondarySmallClass}
                      >
                        Regenerate Description
                      </button>
                    )}
                    <button
                      onClick={() => onRegenerateField(product.id, marketplace, undefined)}
                      disabled={isGenerating}
                      className={buttonSecondarySmallClass}
                    >
                      Regenerate Entire Listing
                    </button>
                  </div>
                )}

                <div className="flex gap-2">
                  {content && !isApproved && (
                    <button onClick={() => onApproveMarketplace(product.id, marketplace)} className={buttonPrimaryClass}>
                      Approve Listing
                    </button>
                  )}
                  {content && isApproved && (
                    <button onClick={() => onUnapproveMarketplace(product.id, marketplace)} className={buttonWarningClass}>
                      Unapprove
                    </button>
                  )}
                  {/* Only the true first-attempt failure (no prior content)
                      gets this generic full-listing retry — a failed
                      regenerate on an existing listing is recovered via the
                      matching Regenerate button above instead, never this. */}
                  {error && !content && (
                    <button onClick={() => onRetryMarketplace(product.id, marketplace)} className={buttonDestructiveClass}>
                      Retry {MARKETPLACE_LABELS[marketplace]}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className={buttonSecondaryClass}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// The three input methods (Bulk Upload / Manual Entry / Photos Only),
// unchanged from Milestone 1's tab-strip — a persistent workspace column
// now (sidebar → Add Products → Listings), not a modal/drawer: always
// mounted, no backdrop, no focus trap, no close action. None of
// LeftPanel/ImageOnlyPanel's own props, fields, or submit logic changed,
// only where this whole block renders.
function AddProductsPanel({
  activeTab,
  onActiveTabChange,
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
  onAddImageOnlyProduct,
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
  activeTab: WorkspaceDestination
  onActiveTabChange: (tab: WorkspaceDestination) => void
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
  onAddImageOnlyProduct: () => void
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
    // A normal flex column, not an overlay — no fixed positioning, no
    // z-index, no backdrop, no focus trap. Sits between AppSidebar and the
    // Listings column as a permanent part of the workspace layout.
    // h-full/overflow-y-auto/border-r only apply at lg: below that the
    // outer row switches to flex-col (see the call site), so this panel
    // just takes its natural stacked height instead of each column
    // fighting to be 100% of a row that no longer has a fixed cross-axis
    // size — border moves from the right edge to the bottom edge to match.
    <aside
      id="add-products-panel"
      className="w-full lg:w-[420px] lg:shrink-0 lg:h-full lg:overflow-y-auto p-6 border-b lg:border-b-0 border-r-0 lg:border-r border-[var(--card-border)] bg-[var(--page-bg)]"
    >
      <h2 className={sectionHeadingClass}>Add Products</h2>
      <p className={`${bodyTextClass} mb-4`}>Add products to your catalog using any of the methods below.</p>

        <div className="mb-3">
          {/* grid-cols-3 (not flex-wrap): guarantees Bulk Upload / Manual
              Entry / Photos Only stay on exactly one row, each taking an
              equal, deterministic third of the panel's width, rather than
              risking the last tab wrapping if content width runs tight. */}
          <div className="grid grid-cols-3 gap-1.5">
            {ADD_METHOD_TABS.map((tab) => {
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onActiveTabChange(tab.id)}
                  aria-pressed={isActive}
                  className={`px-2 py-2 rounded-lg text-xs sm:text-sm font-medium border whitespace-nowrap text-center transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--page-bg)] focus:ring-blue-500 ${
                    isActive
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--heading-text)] hover:bg-[var(--secondary-btn-bg-hover)]'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {activeTab === 'image' ? (
          <ImageOnlyPanel
            brandName={brandName}
            onBrandNameChange={onBrandNameChange}
            category={category}
            onCategoryChange={onCategoryChange}
            imageFile={imageFile}
            onImageFileChange={onImageFileChange}
            formPreviewUrl={formPreviewUrl}
            fileInputRef={fileInputRef}
            formError={formError}
            guestLimitReached={guestLimitReached}
            onSubmit={onAddImageOnlyProduct}
            uploadingImage={uploadingImage}
            editingId={editingId}
          />
        ) : (
          <LeftPanel
            activeTab={activeTab}
            brandName={brandName}
            onBrandNameChange={onBrandNameChange}
            category={category}
            onCategoryChange={onCategoryChange}
            description={description}
            onDescriptionChange={onDescriptionChange}
            imageFile={imageFile}
            onImageFileChange={onImageFileChange}
            formPreviewUrl={formPreviewUrl}
            fileInputRef={fileInputRef}
            formError={formError}
            guestLimitReached={guestLimitReached}
            brandMismatchPending={brandMismatchPending}
            selectedClient={selectedClient}
            pendingImageUrl={pendingImageUrl}
            onCommitAddProduct={onCommitAddProduct}
            onCancelBrandMismatch={onCancelBrandMismatch}
            onAddProduct={onAddProduct}
            onClearForm={onClearForm}
            uploadingImage={uploadingImage}
            editingId={editingId}
            csvFile={csvFile}
            onCsvFileChange={onCsvFileChange}
            csvFileInputRef={csvFileInputRef}
            csvSummary={csvSummary}
            isDragging={isDragging}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            pendingCsvUpload={pendingCsvUpload}
            onUploadCsv={onUploadCsv}
            onCsvAddWithoutBrandVoice={onCsvAddWithoutBrandVoice}
            onCsvAddOnlyMatching={onCsvAddOnlyMatching}
            onCsvAddAllWithBrandVoice={onCsvAddAllWithBrandVoice}
            onCsvCancelMismatch={onCsvCancelMismatch}
          />
        )}
    </aside>
  )
}

function ExportGateModal({ onClose, onSignIn }: { onClose: () => void; onSignIn: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, onClose)

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Sign in required"
        className={`relative p-6 max-w-sm w-full mx-4 focus:outline-none ${cardClass}`}
      >
        <p className="text-sm text-[var(--body-text)] mb-4">Sign in or create a free account to download your listings.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={linkButtonClass}>
            Cancel
          </button>
          <Link href="/login" onClick={onSignIn} className={buttonPrimaryClass}>
            Sign In
          </Link>
        </div>
      </div>
    </div>
  )
}

// Replaces the queue table entirely when there's nothing in it yet — not a
// decorated illustration, just the one thing the seller needs to know
// ("nothing here yet"). No Add Products button here anymore: the panel to
// its left is always visible, so a second entry point would be redundant.
// Uses the same cardClass surface QueueTable itself sits in, so swapping
// between the two doesn't change the page's visual rhythm.
function WorkspaceEmptyState() {
  // The Add Products panel is always visible on desktop, but stacks above
  // Listings below the lg breakpoint — this scrolls it into view (and
  // focuses its first field) rather than being a purely decorative button,
  // since there's no show/hide state left to toggle.
  function focusAddProducts() {
    const panel = document.getElementById('add-products-panel')
    panel?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    panel?.querySelector<HTMLElement>('input, textarea, button')?.focus()
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className={`flex flex-col items-center text-center gap-2 px-8 py-8 max-w-sm ${cardClass}`}>
        <p className={sectionHeadingClass}>Your listings are ready to be created</p>
        <p className={bodyTextClass}>Add products using the panel on the left to start creating marketplace-ready listings.</p>
        <button onClick={focusAddProducts} className={`mt-2 ${buttonPrimaryClass}`}>
          + Add Products
        </button>
      </div>
    </div>
  )
}

export default function CatalogueWorkspace() {
  // Global/session-scoped, same as the old single-value dropdown — not
  // frozen onto individual products at add time. The generation loop always
  // reads whatever's currently selected here, applied to every product it
  // touches in that run (see handleGenerateAll).
  const [selectedMarketplaces, setSelectedMarketplaces] = useState<Marketplace[]>([])
  const [draftProducts, setDraftProducts] = useState<DraftProduct[]>([])
  const [activeTab, setActiveTab] = useState<WorkspaceDestination>('manual')
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>('all')
  // A QueueTable row is a (product, marketplace) pair — View Content must
  // review exactly that pair, so this carries both instead of just a
  // product id (which previously left the drawer to guess/show every
  // marketplace the product had ever attempted).
  const [viewingTarget, setViewingTarget] = useState<{ productId: string; marketplace: Marketplace } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingRestoreCount, setPendingRestoreCount] = useState<number | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  // Saved session read from localStorage on mount, held here until we also know
  // whether the visitor is authenticated — that decides auto-restore vs. banner.
  const [savedSessionData, setSavedSessionData] = useState<any | null>(null)

  const [brandName, setBrandName] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  // Base64 mirror of imageFile (when small enough), so the form's in-progress,
  // not-yet-submitted image pick can survive a redirect/refresh via localStorage —
  // a raw File object can't be JSON-serialized.
  const [imageFileDataUrl, setImageFileDataUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // A native <input type="file"> is uncontrolled — resetting csvFile (React
  // state) to null after a successful upload does NOT clear the input's own
  // internal .value, so re-selecting the same filename (or in some browsers,
  // any file, depending on how the picker dialog resolves) silently fails
  // to fire another change event. Same fix already applied to the image
  // upload input via fileInputRef above; this mirrors it for CSV.
  const csvFileInputRef = useRef<HTMLInputElement>(null)

  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvSummary, setCsvSummary] = useState<CsvSummary | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const [generating, setGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState<{ current: number; total: number } | null>(null)
  // Which single (product, marketplace) pair is in flight right now — not
  // just which product, since a product can have several marketplace rows
  // and only one of them is actually generating at any instant (the
  // generation loop is sequential, never parallel across marketplaces).
  const [currentlyGenerating, setCurrentlyGenerating] = useState<{ productId: string; marketplace: Marketplace } | null>(
    null
  )
  // Remembers which field group (title/bullets/description/'full') the most
  // recent FAILED generate attempt was for, per (product, marketplace) pair
  // — so a failed "Regenerate Title" can be reported and retried as exactly
  // that, never silently widened into a full-listing retry. Keyed by
  // `${productId}:${marketplace}`; an entry is removed the moment that pair
  // next succeeds. Deliberately separate from generationError (which only
  // holds the message) since this tracks *scope*, not the error text.
  const [failedRegenFieldGroup, setFailedRegenFieldGroup] = useState<Record<string, FieldGroup | 'full'>>({})
  // Structured rather than a pre-formatted string — rendered as a top-level,
  // impossible-to-miss banner (see the JSX below), not the per-row "One or
  // more marketplaces failed" text, so it needs a heading, a body, and a
  // "Buy more credits" CTA built from these numbers, not just interpolated
  // into one sentence.
  const [creditsStoppedInfo, setCreditsStoppedInfo] = useState<{ completedPairs: number; totalPairs: number } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null)
  const marketplaceSelectRef = useRef<HTMLDivElement>(null)
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null)
  const [marketplaceFlash, setMarketplaceFlash] = useState(false)
  const [brandMismatchPending, setBrandMismatchPending] = useState(false)
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [pendingCsvUpload, setPendingCsvUpload] = useState<PendingCsvUpload | null>(null)
  const [hasSession, setHasSession] = useState(false)
  // Distinguishes "haven't checked auth yet" from "checked, guest" — hasSession
  // alone starts false either way, which isn't enough to gate the restore decision.
  const [hasCheckedSession, setHasCheckedSession] = useState(false)
  const [showExportGateModal, setShowExportGateModal] = useState(false)
  const [autoDownloadPending, setAutoDownloadPending] = useState(false)
  // Set when a saved session is found but its schema version doesn't match
  // — see SESSION_SCHEMA_VERSION below. Old-shape sessions are discarded
  // rather than restored, since the nested generatedContent/approved shape
  // changed and a straight restore would silently produce broken products.
  const [outdatedSessionDiscarded, setOutdatedSessionDiscarded] = useState(false)

  // Client-side only, purely for UI: /workspace is public, so this never gates
  // access — it just decides whether to show the Brand/Clients dropdown at all,
  // and (by not rendering ClientSelector) avoids ever hitting the clients table
  // for a guest, since ClientSelector fetches clients in its own effect on mount.
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setHasSession(!!data.user)
      setHasCheckedSession(true)
    })
  }, [])

  // AppSidebar's csv/manual/image items link here as /workspace?tab=<id>
  // when clicked from outside /workspace (e.g. from /audit) — this is what
  // makes that navigation land on the actual destination clicked, rather
  // than always landing on the default Manual Entry panel. Read directly
  // from window.location instead of useSearchParams() so this component
  // doesn't need a Suspense boundary added upstream just for this.
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab')
    if (tab === 'csv' || tab === 'manual' || tab === 'image') {
      setActiveTab(tab)
    }
  }, [])

  // On mount, read any crash-recovery session but don't yet decide what to do
  // with it — that depends on whether this visitor turns out to be authenticated,
  // which is still resolving asynchronously via the auth-check effect above.
  // Uses localStorage (not sessionStorage) because a magic-link email typically
  // opens in a new browser tab, and sessionStorage doesn't carry across tabs.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)

        // A session saved under a different schema version — most likely
        // pre-refactor, back when generatedContent/status/approved had a
        // flat, single-marketplace shape. Restoring it as-is would produce
        // products whose generatedContent isn't a per-marketplace record at
        // all, breaking every marketplace-keyed read downstream. Discarded
        // outright rather than restored, with a one-time notice instead of
        // failing silently or crashing on the shape mismatch.
        if (parsed.version !== SESSION_SCHEMA_VERSION) {
          localStorage.removeItem(SESSION_STORAGE_KEY)
          setOutdatedSessionDiscarded(true)
          setSessionReady(true)
          return
        }

        const isExpired = typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > SESSION_MAX_AGE_MS

        if (isExpired) {
          localStorage.removeItem(SESSION_STORAGE_KEY)
        } else if (parsed.pendingDownload || (Array.isArray(parsed.draftProducts) && parsed.draftProducts.length > 0)) {
          setSavedSessionData(parsed)
          return
        }
      }
    } catch {
      // corrupted or unreadable storage — treat as no saved session
    }
    setSessionReady(true)
  }, [])

  // Fires once both the saved session (if any) and the auth check have landed.
  // Authenticated visitors skip the manual banner entirely and get restored
  // straight into state; guests keep seeing the Restore/Discard banner as before.
  useEffect(() => {
    if (!savedSessionData || !hasCheckedSession) return

    if (hasSession) {
      void applyRestoredState(savedSessionData)
      if (savedSessionData.pendingDownload) {
        setAutoDownloadPending(true)
      }
      setSessionReady(true)
    } else {
      setPendingRestoreCount(savedSessionData.draftProducts?.length || 0)
    }
    setSavedSessionData(null)
  }, [savedSessionData, hasCheckedSession, hasSession])

  // Fires once both the restore and the "am I actually logged in now" check
  // have landed. handleDownloadApproved's own hasSession check would otherwise
  // still see the stale initial `false` if called directly above, since that
  // auth check resolves asynchronously.
  useEffect(() => {
    if (autoDownloadPending && hasSession) {
      setAutoDownloadPending(false)
      handleDownloadApproved()
    }
  }, [autoDownloadPending, hasSession])

  // Mirrors the form's in-progress imageFile into a base64 data URL so it can
  // survive a redirect/refresh via localStorage (a raw File can't be
  // JSON-serialized). Skipped above the size cap — see MAX_PERSISTABLE_IMAGE_BYTES.
  useEffect(() => {
    if (!imageFile || imageFile.size > MAX_PERSISTABLE_IMAGE_BYTES) {
      setImageFileDataUrl(null)
      return
    }
    let cancelled = false
    const reader = new FileReader()
    reader.onload = () => {
      if (!cancelled) setImageFileDataUrl(reader.result as string)
    }
    reader.readAsDataURL(imageFile)
    return () => {
      cancelled = true
    }
  }, [imageFile])

  // Persist draftProducts on every change, once the initial restore/discard decision
  // is resolved (so we don't clobber a pending saved session with the initial empty array
  // before the user has seen the restore banner). File objects can't survive
  // JSON.stringify/localStorage — imageFile is always null on a committed product now
  // (manual uploads are converted to a permanent Supabase Storage URL immediately on
  // add), but it's still stripped defensively in case that invariant is ever broken.
  // The marketplace, selected brand, and in-progress manual-entry form (including a
  // small enough in-progress image, as a data URL) are all saved alongside the
  // products so a restore brings back the whole session state, not just the product
  // list. Wrapped in try/catch: an oversized data URL could push this over
  // localStorage's quota, and a thrown QuotaExceededError here shouldn't take out
  // persistence for the rest of the session (products, marketplace, etc).
  useEffect(() => {
    if (!sessionReady) return
    try {
      const serializable = draftProducts.map(({ imageFile, ...rest }) => rest)
      localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          version: SESSION_SCHEMA_VERSION,
          savedAt: Date.now(),
          draftProducts: serializable,
          selectedMarketplaces,
          selectedClient,
          formDraft: { brandName, category, description, imageDataUrl: imageFileDataUrl }
        })
      )
    } catch {
      // most likely a localStorage quota error from an embedded image — this
      // change just won't survive a refresh, nothing else breaks
    }
  }, [draftProducts, sessionReady, selectedMarketplaces, selectedClient, brandName, category, description, imageFileDataUrl])

  // Only ever called with a payload that already passed the version check
  // above, so draftProducts here is guaranteed to already be in the current
  // nested-per-marketplace shape — no per-product migration needed.
  async function applyRestoredState(parsed: any) {
    const products = Array.isArray(parsed.draftProducts) ? parsed.draftProducts : []
    setDraftProducts(products.map((p: any) => ({ ...p, imageFile: null })))
    if (Array.isArray(parsed.selectedMarketplaces)) {
      setSelectedMarketplaces(
        parsed.selectedMarketplaces.filter((m: unknown): m is Marketplace =>
          (SUPPORTED_MARKETPLACES as readonly string[]).includes(m as string)
        )
      )
    }
    if (parsed.selectedClient) {
      setSelectedClient(parsed.selectedClient)
    }
    if (parsed.formDraft) {
      setBrandName(parsed.formDraft.brandName || '')
      setCategory(parsed.formDraft.category || '')
      setDescription(parsed.formDraft.description || '')

      if (parsed.formDraft.imageDataUrl) {
        try {
          const blob = await (await fetch(parsed.formDraft.imageDataUrl)).blob()
          const extension = blob.type.split('/')[1] || 'jpg'
          setImageFile(new File([blob], `restored-image.${extension}`, { type: blob.type }))
        } catch {
          // couldn't reconstruct the image — form just comes back without one
        }
      }
    }
  }

  function handleRestoreSession() {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY)
      if (saved) {
        void applyRestoredState(JSON.parse(saved))
      }
    } catch {
      // corrupted storage — nothing to restore
    }
    setPendingRestoreCount(null)
    setSessionReady(true)
  }

  function handleDiscardSession() {
    localStorage.removeItem(SESSION_STORAGE_KEY)
    setPendingRestoreCount(null)
    setSessionReady(true)
  }

  // Still used by Bulk Approve/Download (unrelated to this change — their
  // own alert-based gating is untouched). Generate Content deliberately does
  // NOT use this — see flagMissingMarketplace below, which shows the same
  // requirement as an inline warning under Target Marketplaces instead of a
  // native alert().
  function requireMarketplace(): boolean {
    if (selectedMarketplaces.length === 0) {
      alert('Please select at least one target marketplace')
      return false
    }
    return true
  }

  // Generate Content's own marketplace gate — inline, not a native alert(),
  // since generation (unlike Add Product) genuinely requires at least one
  // marketplace selected. Sets the same marketplaceError/marketplaceFlash
  // state AppHeader already renders as a red ring on the Target Marketplaces
  // group plus red text underneath; handleToggleMarketplace already clears
  // both the moment a marketplace is picked, so the warning disappears on
  // its own once the requirement is satisfied.
  function flagMissingMarketplace() {
    setMarketplaceError('Please select at least one target marketplace before proceeding.')
    setMarketplaceFlash(true)
    marketplaceSelectRef.current?.focus()
    marketplaceSelectRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => setMarketplaceFlash(false), 1200)
  }

  function handleToggleMarketplace(marketplace: Marketplace) {
    setSelectedMarketplaces((prev) =>
      prev.includes(marketplace) ? prev.filter((m) => m !== marketplace) : [...prev, marketplace]
    )
    setMarketplaceError(null)
    setMarketplaceFlash(false)
  }

  function wordLevelMatch(a: string, b: string): boolean {
    const normA = a.trim().toLowerCase()
    const normB = b.trim().toLowerCase()

    if (!normA || !normB) return true
    if (normA === normB) return true

    const wordsA = new Set(normA.split(/\s+/).filter(Boolean))
    const wordsB = normB.split(/\s+/).filter(Boolean)

    return wordsB.some((word) => wordsA.has(word))
  }

  function handleBrandNameChange(value: string) {
    setBrandName(value)
    setFormError(null)
    setBrandMismatchPending(false)
  }

  function handleCategoryChange(value: string) {
    setCategory(value)
    setFormError(null)
  }

  function handleDescriptionChange(value: string) {
    setDescription(value)
    setFormError(null)
  }

  function handleCancelBrandMismatch() {
    setBrandMismatchPending(false)
    setPendingImageUrl(null)
  }

  function handleClearForm() {
    setBrandName('')
    setCategory('')
    setDescription('')
    setImageFile(null)
    setEditingId(null)
    setFormError(null)
    setBrandMismatchPending(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  async function uploadProductImage(file: File): Promise<string> {
    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch('/api/upload-image', { method: 'POST', body: formData })
    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error || 'Image upload failed')
    }

    return data.url as string
  }

  async function handleAddProduct() {
    // Marketplace selection is not required to add a product — it's only
    // relevant to generation (see handleGenerateAll's requireMarketplace()
    // check). A product can exist in the catalog before any marketplace has
    // been chosen; it just sits there ungenerated until one is.
    if (!brandName.trim() || !category.trim() || !description.trim()) {
      setFormError('Brand Name, Category, and Description are required.')
      return
    }
    setFormError(null)

    let uploadedImageUrl: string | null = null
    if (imageFile) {
      setUploadingImage(true)
      try {
        uploadedImageUrl = await uploadProductImage(imageFile)
      } catch (err: any) {
        setFormError(err.message || 'Image upload failed. Please try again.')
        setUploadingImage(false)
        return
      }
      setUploadingImage(false)
    }

    if (!editingId && selectedClient && !wordLevelMatch(brandName, selectedClient.client_name)) {
      setPendingImageUrl(uploadedImageUrl)
      setBrandMismatchPending(true)
      return
    }

    commitAddProduct(false, uploadedImageUrl)
  }

  // Image-only adds: brand/category are optional here (unlike manual entry),
  // and there's no brand-voice-mismatch gate — that check exists to catch a
  // typed brand name that doesn't match the selected client, and there's
  // nothing to mismatch-check when the field was deliberately left blank.
  async function handleAddImageOnlyProduct() {
    // Marketplace selection is not required to add a product — see the same
    // note in handleAddProduct.
    if (!imageFile && !editingId) {
      setFormError('An image is required.')
      return
    }
    setFormError(null)

    let uploadedImageUrl: string | null = null
    if (imageFile) {
      setUploadingImage(true)
      try {
        uploadedImageUrl = await uploadProductImage(imageFile)
      } catch (err: any) {
        setFormError(err.message || 'Image upload failed. Please try again.')
        setUploadingImage(false)
        return
      }
      setUploadingImage(false)
    }

    // Explicit '' override rather than falling through to the shared
    // `description` state — brandName/category/imageFile are reused across
    // all three destinations, but if a user typed a description while on
    // Manual Entry and then switched to this panel without clearing the
    // form, that leftover text must not silently end up on an "image only"
    // product.
    commitAddProduct(true, uploadedImageUrl, '')
  }

  function commitAddProduct(skipBrandVoice: boolean, uploadedImageUrl: string | null, descriptionOverride?: string) {
    const effectiveDescription = descriptionOverride ?? description

    if (editingId) {
      setDraftProducts((prev) =>
        prev.map((p) =>
          p.id === editingId
            ? {
                ...p,
                brandName,
                category,
                description: effectiveDescription,
                ...(uploadedImageUrl ? { imageFile: null, imageUrl: uploadedImageUrl } : {})
              }
            : p
        )
      )
      setEditingId(null)
      setDescription('')
      setImageFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      setBrandMismatchPending(false)
      setPendingImageUrl(null)
      return
    }

    const newProduct: DraftProduct = {
      id: crypto.randomUUID(),
      brandName,
      description: effectiveDescription,
      category,
      imageFile: null,
      imageUrl: uploadedImageUrl,
      generatedContent: emptyGeneratedContent(),
      approved: emptyApproved(),
      status: 'draft',
      generationError: emptyGenerationError(),
      generationMeta: emptyGenerationMeta(),
      visualAttributes: null,
      skipBrandVoice
    }

    setDraftProducts((prev) => [...prev, newProduct])

    setDescription('')
    setImageFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    setBrandMismatchPending(false)
    setPendingImageUrl(null)
  }

  function handleEditProduct(product: DraftProduct) {
    setBrandName(product.brandName)
    setCategory(product.category)
    setDescription(product.description)
    setImageFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    setEditingId(product.id)
    // Switches the always-visible Add Products panel to Manual Entry so
    // the pre-filled form is immediately visible — the panel itself never
    // needs to be shown/hidden anymore, it's already on screen.
    setActiveTab('manual')
  }

  function handleDeleteProduct(id: string) {
    setDraftProducts((prev) => prev.filter((p) => p.id !== id))
    if (viewingTarget?.productId === id) setViewingTarget(null)
    if (editingId === id) handleClearForm()
  }

  function handleCsvFileChange(file: File | null) {
    setCsvFile(file)
    setPendingCsvUpload(null)
  }

  async function handleUploadCsv() {
    // Marketplace selection is not required to add products — see the same
    // note in handleAddProduct.
    if (!csvFile) {
      alert('Choose a CSV file first')
      return
    }

    const csvText = await csvFile.text()
    const parsed = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true
    })

    if (parsed.errors.length > 0) {
      alert('Error parsing CSV: ' + parsed.errors[0].message)
      return
    }

    const newProducts: DraftProduct[] = []
    let skippedCount = 0

    for (const row of parsed.data) {
      const brand = pick(row, 'Brand', 'brand')
      const rowDescription = pick(row, 'Product description', 'description')

      if (!brand || !rowDescription) {
        skippedCount++
        continue
      }

      newProducts.push({
        id: crypto.randomUUID(),
        brandName: brand,
        description: rowDescription,
        category: pick(row, 'category') || '',
        imageFile: null,
        imageUrl: pick(row, 'image url', 'image_url'),
        generatedContent: emptyGeneratedContent(),
        approved: emptyApproved(),
        status: 'draft',
        generationError: emptyGenerationError(),
        generationMeta: emptyGenerationMeta(),
        visualAttributes: null,
        skipBrandVoice: false
      })
    }

    if (selectedClient) {
      const mismatchedProducts = newProducts.filter((p) => !wordLevelMatch(p.brandName, selectedClient.client_name))

      if (mismatchedProducts.length > 0) {
        const matchingProducts = newProducts.filter((p) => wordLevelMatch(p.brandName, selectedClient.client_name))
        setPendingCsvUpload({
          fileName: csvFile.name,
          total: parsed.data.length,
          matchingProducts,
          mismatchedProducts
        })
        return
      }
    }

    commitCsvUpload(newProducts, csvFile.name, parsed.data.length)
  }

  function commitCsvUpload(products: DraftProduct[], fileName: string, total: number) {
    setDraftProducts((prev) => [...prev, ...products])
    setCsvSummary({
      fileName,
      total,
      added: products.length,
      skipped: total - products.length
    })
    setCsvFile(null)
    setPendingCsvUpload(null)
    // Resetting csvFile (state) alone doesn't clear the underlying <input>'s
    // own .value — without this, selecting another CSV right after a
    // successful upload can silently fail to fire change (see
    // csvFileInputRef above), and only a full page refresh actually clears
    // the stuck input.
    if (csvFileInputRef.current) {
      csvFileInputRef.current.value = ''
    }
  }

  function handleCsvAddWithoutBrandVoice() {
    if (!pendingCsvUpload) return
    const all = [...pendingCsvUpload.matchingProducts, ...pendingCsvUpload.mismatchedProducts].map((p) => ({
      ...p,
      skipBrandVoice: true
    }))
    commitCsvUpload(all, pendingCsvUpload.fileName, pendingCsvUpload.total)
  }

  function handleCsvAddOnlyMatching() {
    if (!pendingCsvUpload) return
    commitCsvUpload(pendingCsvUpload.matchingProducts, pendingCsvUpload.fileName, pendingCsvUpload.total)
  }

  function handleCsvAddAllWithBrandVoice() {
    if (!pendingCsvUpload) return
    const all = [...pendingCsvUpload.matchingProducts, ...pendingCsvUpload.mismatchedProducts]
    commitCsvUpload(all, pendingCsvUpload.fileName, pendingCsvUpload.total)
  }

  function handleCsvCancelMismatch() {
    setPendingCsvUpload(null)
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave() {
    setIsDragging(false)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) {
      setCsvFile(file)
      setPendingCsvUpload(null)
    }
  }

  // A product's status only ever reflects the marketplaces attempted in a
  // given run (`runMarketplaces`) — a fixed snapshot taken once at the start
  // of that run, not re-read live. Otherwise an already-'generated' product
  // could silently flip to 'partial' later just because the global
  // selection changed after the fact, with nothing new actually failing.
  function computeProductStatus(
    generatedContent: DraftProduct['generatedContent'],
    runMarketplaces: Marketplace[]
  ): DraftProduct['status'] {
    const succeededCount = runMarketplaces.filter((m) => generatedContent[m] !== null).length
    if (succeededCount === 0) return 'draft'
    if (succeededCount === runMarketplaces.length) return 'generated'
    return 'partial'
  }

  // Product-major, marketplace-minor: every marketplace for one product
  // before moving to the next (not all-products-for-marketplace-1 then
  // all-products-for-marketplace-2). Each (product, marketplace) pair is one
  // full-price generate-single call — total cost for a batch is simply the
  // count of successful calls, not a separate bulk formula.
  async function handleGenerateAll() {
    if (selectedMarketplaces.length === 0) {
      flagMissingMarketplace()
      return
    }
    const pending = draftProducts.filter((p) => p.status === 'draft')
    if (pending.length === 0) return

    // Snapshot now — see computeProductStatus above for why this must stay
    // fixed for the whole run rather than re-reading live state.
    const runMarketplaces = selectedMarketplaces

    setGenerating(true)
    setCreditsStoppedInfo(null)

    const totalPairs = pending.length * runMarketplaces.length
    // completedPairs = attempts made so far, for the "attempt N of totalPairs"
    // progress indicator. succeededPairs = attempts that actually generated
    // content — a distinct count, since the one that trips
    // 'insufficient_credits' increments completedPairs but produced nothing,
    // and the stopped-banner needs to report real completions, not attempts.
    let completedPairs = 0
    let succeededPairs = 0

    outer: for (const product of pending) {
      for (const marketplace of runMarketplaces) {
        setCurrentlyGenerating({ productId: product.id, marketplace })
        setGenerationProgress({ current: completedPairs + 1, total: totalPairs })

        const outcome = await generateForProductMarketplace(product, marketplace, runMarketplaces)
        completedPairs++
        if (outcome === 'success') succeededPairs++

        // Insufficient credits: every remaining (product, marketplace) pair
        // — whether the rest of this product's marketplaces or any later
        // product entirely — would fail the identical way, since the
        // balance doesn't change between attempts. Stop the whole batch
        // here rather than burning a failed request per remaining pair.
        // Any other per-pair error (bad image, transient network issue)
        // keeps going — that failure is specific to one pair, not the batch.
        if (outcome === 'insufficient_credits') {
          setCreditsStoppedInfo({ completedPairs: succeededPairs, totalPairs })
          break outer
        }
      }
    }

    setCurrentlyGenerating(null)
    setGenerationProgress(null)
    setGenerating(false)
  }

  // Shared by the row-level "Retry" button and every drawer regenerate
  // button — both just call generateForProductMarketplace for one
  // (product, marketplace) pair, differing only in whether a fieldGroup is
  // passed. Centralized here so failedRegenFieldGroup (which the drawer
  // needs to know exactly what to offer to retry) stays in sync with every
  // caller instead of being duplicated per call site.
  async function runGeneration(id: string, marketplace: Marketplace, fieldGroup?: FieldGroup) {
    const product = draftProducts.find((p) => p.id === id)
    if (!product) return

    const key = `${id}:${marketplace}`
    setCurrentlyGenerating({ productId: id, marketplace })
    const outcome = await generateForProductMarketplace(product, marketplace, selectedMarketplaces, fieldGroup)
    setCurrentlyGenerating(null)

    setFailedRegenFieldGroup((prev) => {
      if (outcome === 'success') {
        if (!(key in prev)) return prev
        const next = { ...prev }
        delete next[key]
        return next
      }
      return { ...prev, [key]: fieldGroup ?? 'full' }
    })
  }

  async function handleRetryProductMarketplace(id: string, marketplace: Marketplace) {
    await runGeneration(id, marketplace)
  }

  // Drawer's Regenerate Title/Bullets/Description/Entire Listing buttons —
  // fieldGroup undefined means "entire listing," same call as a normal
  // retry above, just exposed with a name that matches what the button says.
  async function handleRegenerateField(id: string, marketplace: Marketplace, fieldGroup?: FieldGroup) {
    await runGeneration(id, marketplace, fieldGroup)
  }

  // fieldGroup undefined/null = replace the whole marketplace content, same
  // as every existing caller today (fresh generation, full retry). When set
  // ('title' | 'bullets' | 'description'), only that group's keys (per
  // FIELD_GROUPS above) are taken from the fresh response — every other key
  // in the existing content object is preserved untouched via the spread
  // below, so "Regenerate Bullets" genuinely cannot alter the title or
  // description. Still one full generate-single call underneath (the model
  // has no partial-output mode), so it costs the same 1 credit as any other
  // retry already does — no new billing path.
  async function generateForProductMarketplace(
    product: DraftProduct,
    marketplace: Marketplace,
    runMarketplaces: Marketplace[],
    fieldGroup?: FieldGroup
  ): Promise<'success' | 'insufficient_credits' | 'error'> {
    try {
      const imageBase64 = product.imageFile ? await fileToBase64(product.imageFile) : null

      const res = await fetch('/api/generate-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName: product.brandName,
          description: product.description,
          category: product.category,
          targetMarketplace: marketplace,
          imageBase64,
          imageUrl: product.imageFile ? null : product.imageUrl,
          brandGuidelines: product.skipBrandVoice ? null : selectedClient?.brand_guidelines || null,
          // Lets the route build a small, field-specific prompt (its own
          // marketplace-specific constraint) instead of the generic
          // full-listing one — undefined means "entire listing," same as
          // every other caller of this function.
          fieldGroup
        })
      })
      const data = await res.json()

      if (res.ok) {
        // Meta describes the fresh response's title specifically — only
        // trustworthy to record when the title actually changed (no
        // fieldGroup at all, i.e. entire listing, or fieldGroup === 'title').
        // Regenerating just the bullets/description leaves the existing
        // title (and therefore its existing meta) untouched.
        const updatesTitle = !fieldGroup || fieldGroup === 'title'

        setDraftProducts((prev) =>
          prev.map((p) => {
            if (p.id !== product.id) return p
            const existing = p.generatedContent[marketplace] ?? {}
            const keysToKeep = fieldGroup ? FIELD_GROUPS[marketplace][fieldGroup] : undefined
            const mergedContent = keysToKeep
              ? {
                  ...existing,
                  ...Object.fromEntries(keysToKeep.map((key) => [key, data.generatedContent[key]]))
                }
              : data.generatedContent

            const generatedContent = { ...p.generatedContent, [marketplace]: mergedContent }
            const generationError = { ...p.generationError, [marketplace]: null }
            // keywordsField only reflects reality when keywords were
            // actually part of this response — true for a full generation,
            // NOT for a title-only regenerate (there's no "Regenerate
            // Keywords" button; a title-only request's prompt never asks
            // for keywordPool at all, so the server's fresh meta would
            // otherwise carry an empty/inert keywordsField that could
            // silently look "within limit" and overwrite a previously
            // real, possibly-failing one). Preserve the existing value in
            // that one case; every other case (full regenerate, or the
            // whole meta being discarded for bullets/description-only
            // requests below) already behaves correctly untouched.
            const generationMeta = updatesTitle
              ? {
                  ...p.generationMeta,
                  [marketplace]: {
                    ...(data.meta ?? { titleFields: [], descriptionField: null, keywordsField: null, bulletCount: 0 }),
                    keywordsField: fieldGroup === 'title' ? p.generationMeta[marketplace]?.keywordsField ?? null : data.meta?.keywordsField ?? null
                  }
                }
              : p.generationMeta
            const visualAttributes = data.visualAttributes ?? p.visualAttributes

            return {
              ...p,
              generatedContent,
              generationError,
              generationMeta,
              visualAttributes,
              status: computeProductStatus(generatedContent, runMarketplaces)
            }
          })
        )
        if (hasSession) notifyCreditsChanged()
        return 'success'
      }

      setDraftProducts((prev) =>
        prev.map((p) => {
          if (p.id !== product.id) return p
          const generationError = { ...p.generationError, [marketplace]: data.error || 'Generation failed' }
          return { ...p, generationError, status: computeProductStatus(p.generatedContent, runMarketplaces) }
        })
      )
      return res.status === 403 && typeof data.creditsRemaining === 'number' ? 'insufficient_credits' : 'error'
    } catch {
      setDraftProducts((prev) =>
        prev.map((p) => {
          if (p.id !== product.id) return p
          const generationError = { ...p.generationError, [marketplace]: 'Network error - request failed' }
          return { ...p, generationError, status: computeProductStatus(p.generatedContent, runMarketplaces) }
        })
      )
      return 'error'
    }
  }

  function handleApproveMarketplace(id: string, marketplace: Marketplace) {
    setDraftProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, approved: { ...p.approved, [marketplace]: true } } : p))
    )
  }

  function handleUnapproveMarketplace(id: string, marketplace: Marketplace) {
    setDraftProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, approved: { ...p.approved, [marketplace]: false } } : p))
    )
  }

  // Approves every marketplace that actually has content, for every product
  // that has at least one — including 'partial' products, so a product that
  // only half-finished (see computeProductStatus) still gets its successful
  // marketplaces approved rather than being held back by the ones that failed.
  function handleBulkApprove() {
    if (!requireMarketplace()) return
    setDraftProducts((prev) =>
      prev.map((p) => {
        if (p.status !== 'generated' && p.status !== 'partial') return p
        const approved = { ...p.approved }
        for (const marketplace of SUPPORTED_MARKETPLACES) {
          if (p.generatedContent[marketplace] !== null) approved[marketplace] = true
        }
        return { ...p, approved }
      })
    )
  }

  function handleSignInFromExportGate() {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY)
      const parsed = saved ? JSON.parse(saved) : {}
      localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({ ...parsed, version: SESSION_SCHEMA_VERSION, savedAt: Date.now(), pendingDownload: true })
      )
    } catch {
      // worst case the auto-download just doesn't fire after login — not fatal,
      // the session itself is still safe via the regular persist effect
    }
  }

  // One CSV row per (product, approved marketplace) pair — a product
  // approved for both Amazon and Flipkart produces two rows. Only the
  // marketplaces actually included in this export get cleared afterward
  // (generatedContent/approved/generationError reset to blank for just
  // those keys) — a product is dropped from the queue only once that leaves
  // it with nothing left at all. An approved-but-not-yet-exported
  // marketplace, or a 'partial' product's still-pending retry, keeps the
  // product in the queue: generated content (and the credit it cost) is
  // never silently discarded just because a different marketplace shipped.
  async function handleDownloadApproved() {
    if (!hasSession) {
      setShowExportGateModal(true)
      return
    }
    if (!requireMarketplace()) return

    const flattenedRows: { id: string; marketplace: Marketplace; row: Record<string, string> }[] = []
    for (const p of draftProducts) {
      for (const marketplace of SUPPORTED_MARKETPLACES) {
        if (!p.approved[marketplace]) continue
        const row = flattenRow(marketplace, p.generatedContent[marketplace])
        if (row) flattenedRows.push({ id: p.id, marketplace, row })
      }
    }

    if (flattenedRows.length === 0) {
      alert('No approved products have a supported export shape for their marketplace.')
      return
    }

    try {
      // One CSV per marketplace present, each built only from that
      // marketplace's own rows and its own column shape (exportColumns) —
      // never a single file with a unioned column set, which is what
      // produced the flattened, unlabeled mess this replaces (different
      // marketplaces don't share a row shape: Amazon's bullets vs
      // Flipkart's key features are different fields entirely). A single
      // marketplace still downloads directly as one .csv, exactly as
      // before; more than one bundles into a .zip so each stays cleanly
      // separated and correctly labeled.
      const rowsByMarketplace = new Map<Marketplace, Record<string, string>[]>()
      for (const r of flattenedRows) {
        const list = rowsByMarketplace.get(r.marketplace) ?? []
        list.push(r.row)
        rowsByMarketplace.set(r.marketplace, list)
      }

      // Every generated listing routinely contains characters outside plain
      // ASCII — em dashes, curly quotes, ® — and a bare .csv has no
      // self-describing encoding the way JSON or .docx's XML does. Without
      // a UTF-8 BOM, Excel falls back to guessing the system codepage
      // (typically Windows-1252) and silently re-decodes valid UTF-8 bytes
      // as the wrong characters — the em dash's 3-byte UTF-8 sequence reads
      // back as "â€"", exactly the corruption reported. Prepending
      // here (once, at the source) means every consumer downstream —
      // single-file and each file inside the zip alike — gets it for free.
      const UTF8_BOM = String.fromCharCode(0xfeff)
      const csvByMarketplace = new Map<Marketplace, string>(
        Array.from(rowsByMarketplace.entries()).map(([marketplace, rows]) => [
          marketplace,
          UTF8_BOM + Papa.unparse(rows, { columns: exportColumns[marketplace] })
        ])
      )

      if (csvByMarketplace.size === 1) {
        const [marketplace, csv] = Array.from(csvByMarketplace.entries())[0]
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${marketplace}-listings.csv`
        a.click()
        window.URL.revokeObjectURL(url)
      } else {
        const zip = new JSZip()
        for (const [marketplace, csv] of csvByMarketplace) {
          zip.file(`${marketplace}-listings.csv`, csv)
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' })
        const url = window.URL.createObjectURL(zipBlob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'approved-listings-export.zip'
        a.click()
        window.URL.revokeObjectURL(url)
      }

      const exportedByProduct = new Map<string, Marketplace[]>()
      for (const r of flattenedRows) {
        const list = exportedByProduct.get(r.id) ?? []
        list.push(r.marketplace)
        exportedByProduct.set(r.id, list)
      }

      // Computed from a plain snapshot (draftProducts, read directly) rather
      // than inside the setDraftProducts updater — an updater can run twice
      // under React StrictMode's dev double-invoke, which would double-count
      // these if they lived in there instead.
      let fullyClearedCount = 0
      let partiallyClearedCount = 0
      const remainingMarketplaces = new Set<Marketplace>()

      const nextDraftProducts = draftProducts.flatMap((p) => {
        const exportedMarketplaces = exportedByProduct.get(p.id)
        if (!exportedMarketplaces) return [p]

        const generatedContent = { ...p.generatedContent }
        const approved = { ...p.approved }
        const generationError = { ...p.generationError }
        for (const marketplace of exportedMarketplaces) {
          generatedContent[marketplace] = null
          approved[marketplace] = false
          generationError[marketplace] = null
        }

        const stillHasWork = SUPPORTED_MARKETPLACES.filter(
          (m) => generatedContent[m] !== null || generationError[m] !== null
        )

        if (stillHasWork.length === 0) {
          fullyClearedCount++
          return []
        }

        partiallyClearedCount++
        stillHasWork.forEach((m) => remainingMarketplaces.add(m))

        return [
          {
            ...p,
            generatedContent,
            approved,
            generationError,
            status: computeProductStatus(generatedContent, selectedMarketplaces)
          }
        ]
      })

      setDraftProducts(nextDraftProducts)

      const exportedMarketplaceSet = new Set(flattenedRows.map((r) => r.marketplace))
      const exportedLabel =
        exportedMarketplaceSet.size === 1
          ? `${MARKETPLACE_LABELS[flattenedRows[0].marketplace]} listing${flattenedRows.length === 1 ? '' : 's'}`
          : `listing${flattenedRows.length === 1 ? '' : 's'}`

      const detailParts: string[] = []

      if (fullyClearedCount > 0) {
        detailParts.push(`cleared ${fullyClearedCount} product${fullyClearedCount === 1 ? '' : 's'}`)
      }
      if (partiallyClearedCount > 0) {
        const marketplaceNames = Array.from(remainingMarketplaces).map((m) => MARKETPLACE_LABELS[m])
        const variantLabel =
          marketplaceNames.length <= 2
            ? `pending ${marketplaceNames.join(' / ')} variant${partiallyClearedCount === 1 ? '' : 's'}`
            : 'other marketplace variants pending'
        detailParts.push(
          `${partiallyClearedCount} product${partiallyClearedCount === 1 ? '' : 's'} still ${
            partiallyClearedCount === 1 ? 'has' : 'have'
          } ${variantLabel}`
        )
      }

      const summary = `Exported ${flattenedRows.length} ${exportedLabel}`
      setDownloadMessage(detailParts.length > 0 ? `${summary} — ${detailParts.join('; ')}` : summary)
    } catch {
      alert('Download failed - approved products were not cleared. Please try again.')
    }
  }

  const hasApproved = draftProducts.some((p) => SUPPORTED_MARKETPLACES.some((m) => p.approved[m]))
  const pendingCount = draftProducts.filter((p) => p.status === 'draft').length
  // Display-only — Generate/Bulk Approve/Export above still read the full,
  // unfiltered draftProducts (via pendingCount/hasApproved and their own
  // handlers), so a "Ready" filter never narrows what an action operates
  // on, only what the table currently shows.
  const listingSummary = computeListingSummary(draftProducts)
  const viewingProduct = viewingTarget ? draftProducts.find((p) => p.id === viewingTarget.productId) || null : null
  const editingProduct = editingId ? draftProducts.find((p) => p.id === editingId) || null : null
  const formPreviewUrl = imageFile ? null : editingProduct?.imageUrl ?? null
  const guestLimitReached = !hasSession && draftProducts.length >= GUEST_PRODUCT_LIMIT

  // What TopHeader shows in its usage slot — guests never accrue credits
  // (they're on the separate free-preview counter), signed-in users get the
  // real balance. Computed here rather than inside TopHeader so it stays a
  // plain shared shell with no guest-vs-signed-in branching of its own.
  const usageSlot = hasSession ? (
    <CreditsBalance />
  ) : (
    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border bg-[var(--secondary-btn-bg)] border-[var(--secondary-btn-border)] text-[var(--secondary-btn-text)] whitespace-nowrap">
      {`${draftProducts.length}/${GUEST_PRODUCT_LIMIT} Free Preview`}
    </span>
  )

  return (
    <div className="min-h-screen bg-[var(--page-bg)] text-[var(--body-text)]">
      <TopHeader usageSlot={usageSlot} />

      {/* pt-16 clears the fixed header; h-screen + flex-col lets the real
          remaining height (100vh minus that padding, AND minus whatever
          AppSidebar's in-flow mobile nav bar actually renders at) flow down
          to the content div's flex-1 below — a hardcoded h-[calc(100vh-64px)]
          there only ever accounted for the header and silently overflowed
          the page on mobile, where the nav bar adds its own height on top. */}
      <div className="pt-16 h-screen flex flex-col">
        <AppSidebar>
          {/* Sidebar → Add Products → Listings: a normal three-column flex
              row at lg: and above, not sidebar-plus-overlay. Add Products is
              a fixed-width, always-mounted sibling of the Listings column,
              each with its own independent overflow-y-auto (lg: only — see
              AddProductsPanel) so a tall form and a long queue can each
              scroll on their own without a page-level horizontal scrollbar.
              Below lg, flex-col stacks Add Products above Listings instead
              of squeezing both into a shrinking row — this is what keeps
              the three-tab strip from ever fighting for width against the
              Listings column at tablet sizes. */}
          <div className="flex-1 flex flex-col lg:flex-row min-h-0">
            <AddProductsPanel
              activeTab={activeTab}
              onActiveTabChange={setActiveTab}
              brandName={brandName}
              onBrandNameChange={handleBrandNameChange}
              category={category}
              onCategoryChange={handleCategoryChange}
              description={description}
              onDescriptionChange={handleDescriptionChange}
              imageFile={imageFile}
              onImageFileChange={setImageFile}
              formPreviewUrl={formPreviewUrl}
              fileInputRef={fileInputRef}
              formError={formError}
              guestLimitReached={guestLimitReached}
              brandMismatchPending={brandMismatchPending}
              selectedClient={selectedClient}
              pendingImageUrl={pendingImageUrl}
              onCommitAddProduct={commitAddProduct}
              onCancelBrandMismatch={handleCancelBrandMismatch}
              onAddProduct={handleAddProduct}
              onAddImageOnlyProduct={handleAddImageOnlyProduct}
              onClearForm={handleClearForm}
              uploadingImage={uploadingImage}
              editingId={editingId}
              csvFile={csvFile}
              onCsvFileChange={handleCsvFileChange}
              csvFileInputRef={csvFileInputRef}
              csvSummary={csvSummary}
              isDragging={isDragging}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              pendingCsvUpload={pendingCsvUpload}
              onUploadCsv={handleUploadCsv}
              onCsvAddWithoutBrandVoice={handleCsvAddWithoutBrandVoice}
              onCsvAddOnlyMatching={handleCsvAddOnlyMatching}
              onCsvAddAllWithBrandVoice={handleCsvAddAllWithBrandVoice}
              onCsvCancelMismatch={handleCsvCancelMismatch}
            />
          {/* min-h-0/overflow-y-auto gated to lg: same reasoning as the row
              above — below lg this column takes its natural stacked
              height instead of competing with Add Products for a shared
              row height it no longer has, and the page's own scroll
              (this whole block's ancestor) takes over. */}
          <div className="flex-1 flex flex-col lg:min-h-0 p-6 lg:overflow-y-auto">
          {/* Compact — a heading and one line, not a page-header-sized
              banner. Establishes "what am I working on" without taking
              space from the catalog table below it. */}
          <div className="mb-4">
            <h1 className={sectionHeadingClass}>Listings</h1>
            <p className={bodyTextClass}>Create, validate and prepare marketplace listings.</p>
          </div>
          <AppHeader
            hasSession={hasSession}
            selectedMarketplaces={selectedMarketplaces}
            onToggleMarketplace={handleToggleMarketplace}
            marketplaceError={marketplaceError}
            marketplaceFlash={marketplaceFlash}
            marketplaceGroupRef={marketplaceSelectRef}
            selectedClientId={selectedClient?.id || ''}
            onSelectClient={setSelectedClient}
          />

          {outdatedSessionDiscarded && (
            <div className={`mb-4 flex items-center justify-between gap-4 ${warningBannerClass}`}>
              <p className={warningTextClass}>Previous session format outdated, please start fresh.</p>
              <button onClick={() => setOutdatedSessionDiscarded(false)} className={buttonSecondaryClass}>
                Dismiss
              </button>
            </div>
          )}

          {pendingRestoreCount !== null && (
            <div className={`mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${warningBannerClass}`}>
              <p className={warningTextClass}>
                A previous session with {pendingRestoreCount} product{pendingRestoreCount === 1 ? '' : 's'} was found.
              </p>
              <div className="flex gap-2 shrink-0">
                <button onClick={handleRestoreSession} className={buttonSecondaryClass}>
                  Restore
                </button>
                <button onClick={handleDiscardSession} className={buttonSecondaryClass}>
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* Top-level and impossible to miss, deliberately — distinct from
              the per-row "One or more marketplaces failed" text in
              QueueTable, which is a different, per-item concern (a bad
              image, a transient error). Running out of credits mid-batch is
              an account-level stop, not a per-row one, so it gets the same
              prominent placement as the session banners above rather than
              being buried inside the queue card. No purchase flow exists
              yet, so "Buy more credits" goes to /contact (real, existing)
              rather than a fabricated /billing route. */}
          {creditsStoppedInfo && (
            <div className={`mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${dangerBannerClass}`}>
              <div>
                <p className={`font-semibold ${dangerTextClass}`}>Generation stopped: you're out of credits.</p>
                <p className={dangerTextClass}>
                  {creditsStoppedInfo.completedPairs} of {creditsStoppedInfo.totalPairs} items completed.
                </p>
              </div>
              <Link href="/contact" className={`${buttonPrimaryClass} shrink-0 text-center`}>
                Buy more credits
              </Link>
            </div>
          )}

          {/* Grouped with the other transient status banners above (not
              left trailing under whatever renders below it, which could be
              the empty state right after a full export clears the queue) —
              same bordered-banner shape as those, success-tinted with the
              existing theme variables. */}
          {downloadMessage && (
            <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl border border-[var(--success-border)] bg-[var(--success-bg)]`}>
              <p className="text-sm text-[var(--success-text)]">✓ {downloadMessage}</p>
            </div>
          )}

          {/* Listings — the primary content of this column. Add Products is
              the persistent sibling column to the left, not an action
              triggered from here anymore. */}
          <div className="flex-1 min-h-0 flex flex-col">
            {sessionReady && draftProducts.length === 0 ? (
              <WorkspaceEmptyState />
            ) : (
              <>
                {draftProducts.length > 0 && (
                  <div className="mb-3 flex flex-wrap items-center gap-4">
                    {/* Real counts of attempted (product, marketplace) pairs
                        from computeListingSummary — the same per-row health
                        computation QueueTable itself uses, just tallied.
                        Never shown as a percentage or score. */}
                    <p className={bodyTextClass}>
                      <span className="font-semibold text-[var(--heading-text)]">{listingSummary.total}</span>{' '}
                      Listing{listingSummary.total === 1 ? '' : 's'}
                      {listingSummary.ready > 0 && (
                        <>
                          {' '}
                          · <span className="text-[var(--success-text)]">{listingSummary.ready} Ready</span>
                        </>
                      )}
                      {listingSummary.needsReview > 0 && (
                        <>
                          {' '}
                          · <span className="text-[var(--warn-text)]">{listingSummary.needsReview} Needs Review</span>
                        </>
                      )}
                      {listingSummary.missingData > 0 && (
                        <>
                          {' '}
                          · <span className="text-[var(--warn-text)]">{listingSummary.missingData} Missing Data</span>
                        </>
                      )}
                      {listingSummary.error > 0 && (
                        <>
                          {' '}
                          · <span className="text-[var(--danger-text)]">{listingSummary.error} Error{listingSummary.error === 1 ? '' : 's'}</span>
                        </>
                      )}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {FILTER_OPTIONS.map((option) => {
                        const isActive = readinessFilter === option.id
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => setReadinessFilter(option.id)}
                            aria-pressed={isActive}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--page-bg)] focus:ring-blue-500 ${
                              isActive
                                ? 'bg-blue-600 border-blue-600 text-white'
                                : 'bg-[var(--secondary-btn-bg)] border-[var(--secondary-btn-border)] text-[var(--secondary-btn-text)] hover:bg-[var(--secondary-btn-bg-hover)]'
                            }`}
                          >
                            {option.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                <QueueTable
                  draftProducts={draftProducts}
                  readinessFilter={readinessFilter}
                  currentlyGenerating={currentlyGenerating}
                  selectedMarketplaces={selectedMarketplaces}
                  generating={generating}
                  hasApproved={hasApproved}
                  loading={!sessionReady}
                  hasSession={hasSession}
                  pendingCount={pendingCount}
                  onGenerateAll={handleGenerateAll}
                  onBulkApprove={handleBulkApprove}
                  onDownloadApproved={handleDownloadApproved}
                  onView={(id, marketplace) => setViewingTarget({ productId: id, marketplace })}
                  onEdit={handleEditProduct}
                  onDelete={handleDeleteProduct}
                  onRetry={handleRetryProductMarketplace}
                />
              </>
            )}
          </div>
        </div>
          </div>
        </AppSidebar>
      </div>

      {viewingProduct && viewingTarget && (
        <GeneratedListingDrawer
          product={viewingProduct}
          marketplace={viewingTarget.marketplace}
          currentlyGenerating={currentlyGenerating}
          failedRegenFieldGroup={failedRegenFieldGroup}
          onClose={() => setViewingTarget(null)}
          onApproveMarketplace={handleApproveMarketplace}
          onUnapproveMarketplace={handleUnapproveMarketplace}
          onRetryMarketplace={handleRetryProductMarketplace}
          onRegenerateField={handleRegenerateField}
        />
      )}

      {showExportGateModal && (
        <ExportGateModal
          onClose={() => setShowExportGateModal(false)}
          onSignIn={() => {
            handleSignInFromExportGate()
            setShowExportGateModal(false)
          }}
        />
      )}
    </div>
  )
}
