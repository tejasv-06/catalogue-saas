"use client"

import { useEffect, useRef, useState, type DragEvent, type RefObject } from 'react'
import Papa from 'papaparse'
import JSZip from 'jszip'
import { pick } from '@/lib/csvMapping'
import { exportColumns, flattenRow, RAW_COLUMNS, buildRawColumnsRow, generatedColumnLabels } from '@/lib/exportShapers'
import { type Client } from '@/components/ClientSelector'
import BrandProfileModal from '@/components/BrandProfileModal'
import StatusBadge from '@/components/StatusBadge'
import ProductThumbnail from '@/components/ProductThumbnail'
import AppHeader from '@/components/AppHeader'
import TopHeader from '@/components/TopHeader'
import LeftPanel from '@/components/workspace/LeftPanel'
import ImageOnlyPanel from '@/components/workspace/ImageOnlyPanel'
import AppSidebar, { ChevronIcon, type WorkspaceDestination } from '@/components/AppSidebar'
import QueueTable from '@/components/workspace/QueueTable'
import ListingHealthBadge from '@/components/workspace/ListingHealthBadge'
import { computeListingHealth, FIELD_SPECS, type GenerationMeta } from '@/lib/listingHealth'
import { createClient } from '@/lib/supabase/client'
import {
  createProduct,
  updateProduct,
  upsertListing,
  setApproval,
  recordExport,
  getCatalog,
  deleteProduct,
  getProductIdsWithPerformanceHistory
} from '@/lib/catalog'
import { recordProductHistoryEvent } from '@/lib/productHistory'
import ProductHistory from '@/components/ProductHistory'
import ProductPerformance from '@/components/ProductPerformance'
import { reconcileCatalog } from '@/lib/catalogReconciliation'
import {
  PRODUCT_INTELLIGENCE_FIELD_KEYS,
  type ProductIntelligence,
  type ProductIntelligenceData,
  type ProductIntelligenceFieldKey
} from '@/lib/productIntelligence'
import { evaluateMarketplaceExportReadiness, readyMarketplaces, type MarketplaceExportReadiness, type ExportCandidateItem } from '@/lib/exportReadiness'
import CreditsBalance, { notifyCreditsChanged } from '@/components/CreditsBalance'
import { CREDIT_COSTS } from '@/lib/creditCosts'
import { useFocusTrap } from '@/lib/useFocusTrap'
import { SUPPORTED_MARKETPLACES, MARKETPLACE_LABELS } from '@/lib/platformShapers'
import {
  type DraftProduct,
  type Marketplace,
  type CsvSummary,
  type PendingCsvUpload,
  type ManualImageSlot,
  MAX_MANUAL_IMAGES,
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
// Same UI-preference persistence pattern as AppSidebar's own
// COLLAPSE_STORAGE_KEY ('workspace-sidebar-collapsed') — a plain
// localStorage 'true'/'false' flag, not part of the session-restore
// payload above (which is product data, not a UI preference).
const ADD_PRODUCTS_COLLAPSE_STORAGE_KEY = 'workspace-add-products-collapsed'
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

// Generate Listings loading experience — see the generationStage state
// declaration inside CatalogueWorkspace for what sets each field and when.
export type GenerationStageInfo = {
  phase: 'preparing' | 'generating' | 'validating' | 'complete' | 'failed'
  productId: string | null
  productIndex: number | null
  totalProducts: number | null
  marketplaceLabel: string | null
}

// Pure formatter, deliberately taking enrichingProductId as an explicit
// parameter rather than reading it off some shared "current state" object —
// it IS the real, live signal for stage 1 ("Analyzing Product"): true for
// exactly the span of a genuine /api/enrich-product call, set/cleared by
// runProductIntelligenceAnalysis (unmodified). A product whose intelligence
// was already complete never makes enrichingProductId truthy, so this
// correctly skips straight to "Preparing content" for it — never a fake
// "Analyzing" flash for work that didn't happen.
function describeGenerationStage(stage: GenerationStageInfo, enrichingProductId: string | null): string {
  if (stage.phase === 'complete') return 'Listings generated.'
  if (stage.phase === 'failed') return 'Generation failed.'

  const isBulk = !!(stage.productIndex && stage.totalProducts && stage.totalProducts > 1)
  const productSuffix = isBulk ? ` product ${stage.productIndex} of ${stage.totalProducts}` : ''

  if (enrichingProductId && enrichingProductId === stage.productId) {
    return `Analyzing${productSuffix}...`
  }
  if (stage.phase === 'preparing') return `Preparing content${productSuffix}...`
  if (stage.phase === 'generating') {
    return stage.marketplaceLabel ? `Generating ${stage.marketplaceLabel} listing...` : `Generating listing${productSuffix}...`
  }
  return `Validating${productSuffix}...`
}
const FILTER_OPTIONS: { id: ReadinessFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'Ready' },
  { id: 'needs-review', label: 'Needs Review' },
  { id: 'missing-data', label: 'Missing Data' },
  { id: 'error', label: 'Error' }
]

// Compact single-line summary, not a stat-card grid. `total` mirrors
// QueueTable's own row-rendering exactly (buildRowData/
// getDisplayMarketplaces in components/workspace/QueueTable.tsx): each
// (product, marketplace) pair that's actually been attempted (content or
// error present) is one row, and a product with NOTHING attempted yet
// still renders as exactly one fallback row (marketplace slot null) —
// counted here as 1, not 0. Regression guard: this used to skip that
// fallback case entirely, so the header could read "0 Listings" while the
// table directly beneath it visibly showed real rows for not-yet-generated
// products — this keeps the two permanently in sync instead of measuring
// two different things. The ready/needsReview/missingData/error
// sub-counts still only ever tally real computeListingHealth statuses
// (the same call QueueTable's own rows use) — a fallback row has no
// health status yet, so it contributes to `total` without incrementing
// any of them, which is why the breakdown doesn't always sum to `total`.
function computeListingSummary(draftProducts: DraftProduct[]) {
  const counts = { total: 0, ready: 0, needsReview: 0, missingData: 0, error: 0 }
  for (const product of draftProducts) {
    const attemptedMarketplaces = SUPPORTED_MARKETPLACES.filter(
      (m) => product.generatedContent[m] !== null || product.generationError[m] !== null
    )

    if (attemptedMarketplaces.length === 0) {
      counts.total++
      continue
    }

    for (const m of attemptedMarketplaces) {
      counts.total++
      const content = product.generatedContent[m]
      const error = product.generationError[m]
      const status = computeListingHealth(m, content, error, product.generationMeta[m]).status
      if (status === 'ready') counts.ready++
      else if (status === 'needs-review') counts.needsReview++
      else if (status === 'missing-data') counts.missingData++
      else if (status === 'error') counts.error++
    }
  }
  return counts
}

// Real per-marketplace export-eligibility tally — approved[marketplace],
// NOT health/Ready status (a seller can approve a Needs-Review listing
// after reviewing it, and it stays exportable). Mirrors the same
// approved[marketplace] check performExport's export logic
// already uses; only marketplaces with count > 0 are returned so the
// confirmation surface never shows a zero-count marketplace.
function computeExportableCounts(draftProducts: DraftProduct[]): { marketplace: Marketplace; count: number }[] {
  const counts = new Map<Marketplace, number>()
  for (const product of draftProducts) {
    for (const m of SUPPORTED_MARKETPLACES) {
      if (product.approved[m]) counts.set(m, (counts.get(m) ?? 0) + 1)
    }
  }
  return SUPPORTED_MARKETPLACES.filter((m) => (counts.get(m) ?? 0) > 0).map((m) => ({
    marketplace: m,
    count: counts.get(m)!
  }))
}

// Milestone C11 — the exact inputs lib/exportReadiness.ts's
// evaluateMarketplaceExportReadiness() needs for one marketplace, gathered
// from every approved row for that marketplace (same eligibility rule
// computeExportableCounts above already uses — approved[marketplace], not
// health/Ready status). Pure extraction, no marketplace-rule logic lives
// here; that's entirely inside the C10 adapter this data gets handed to.
function gatherExportCandidateItems(draftProducts: DraftProduct[], marketplace: Marketplace): ExportCandidateItem[] {
  return draftProducts
    .filter((p) => p.approved[marketplace])
    .map((p) => ({
      productId: p.id,
      content: p.generatedContent[marketplace],
      generationError: p.generationError[marketplace],
      meta: p.generationMeta[marketplace]
    }))
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
// Milestone 32 (C9) — small formatting helper for a ProductIntelligenceField
// value (string | string[] | null) shared by every row in the Product
// Intelligence section below. Never fabricates a value for null — renders
// the same "—" placeholder convention already used elsewhere in this file.
function formatIntelligenceValue(value: string | string[] | null): string {
  if (value == null) return '—'
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—'
  return value.trim() || '—'
}

const INTELLIGENCE_FIELD_LABELS: Record<ProductIntelligenceFieldKey, string> = {
  product_type: 'Product type',
  material: 'Material',
  pattern: 'Pattern',
  colors: 'Colors',
  style: 'Style',
  occasion: 'Occasion',
  target_customer: 'Target customer',
  key_selling_points: 'Key selling points',
  search_keywords: 'Search keywords'
}

function GeneratedListingDrawer({
  product,
  marketplace,
  currentlyGenerating,
  failedRegenFieldGroup,
  isAnalyzing,
  onClose,
  onApproveMarketplace,
  onUnapproveMarketplace,
  onRetryMarketplace,
  onRegenerateField,
  onAnalyzeProduct
}: {
  product: DraftProduct
  marketplace: Marketplace
  currentlyGenerating: { productId: string; marketplace: Marketplace } | null
  failedRegenFieldGroup: Record<string, FieldGroup | 'full'>
  isAnalyzing: boolean
  onClose: () => void
  onApproveMarketplace: (id: string, marketplace: Marketplace) => void
  onUnapproveMarketplace: (id: string, marketplace: Marketplace) => void
  onRetryMarketplace: (id: string, marketplace: Marketplace) => void
  onRegenerateField: (id: string, marketplace: Marketplace, fieldGroup?: FieldGroup) => void
  onAnalyzeProduct: (id: string) => void
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

        {/* Milestone 32 (C9), extended — the canonical Product Intelligence
            section. This is the intelligence layer INSIDE listing
            generation, not a separate workflow the seller must run first
            (see ensureProductIntelligence): Generate Listings triggers this
            automatically for an unanalyzed product, reusing a completed
            analysis or waiting on one already in flight rather than ever
            running it twice. The button here remains for previewing it
            before generating, forcing a re-analysis, or retrying a failure.
            Content-first even here: the trigger/status/re-analyze action
            sits on one compact header line, the fields themselves render as
            plain label/value rows (same visual weight as "Detected from
            image" below), and missing-information is a small warning list —
            never a score dashboard preceding the product's own data. */}
        <div className="mb-4 pb-4 border-b border-[var(--card-border)]">
          <div className="flex items-center justify-between mb-1">
            <p className={labelClass}>Product Intelligence</p>
            <button
              onClick={() => onAnalyzeProduct(product.id)}
              disabled={isAnalyzing || !product.serverId}
              title={!product.serverId ? 'Product is still being saved — try again in a moment' : undefined}
              className={buttonSecondarySmallClass}
            >
              {isAnalyzing
                ? 'Analyzing…'
                : product.productIntelligence?.status === 'completed'
                  ? 'Re-analyze Product'
                  : product.productIntelligence?.status === 'failed'
                    ? 'Retry Analysis'
                    : 'Analyze Product'}
            </button>
          </div>

          {(!product.productIntelligence || product.productIntelligence.status === 'not_started') && !isAnalyzing && (
            <p className="text-xs text-[var(--muted-text)]">
              Product Intelligence will be generated when you generate listings — a deeper, confidence-scored
              read (occasion, target customer, key selling points, and more) than the visual details detected
              below, used as context for the generated content. Run it now to preview it first, or re-analyze
              anytime.
            </p>
          )}

          {(isAnalyzing || product.productIntelligence?.status === 'processing') && (
            <p className="text-xs text-[var(--muted-text)]">Analyzing product...</p>
          )}

          {product.productIntelligence?.status === 'failed' && !isAnalyzing && (
            <p className="text-xs text-[var(--danger-text)]">
              Product analysis could not be completed
              {product.productIntelligence.error ? `: ${product.productIntelligence.error}` : '.'}
            </p>
          )}

          {product.productIntelligence?.data && (
            <div className="mt-1 flex flex-col gap-1">
              {PRODUCT_INTELLIGENCE_FIELD_KEYS.map((key) => {
                const field = product.productIntelligence!.data![key]
                return (
                  <p key={key} className="text-sm text-[var(--body-text)]">
                    <span className="text-[var(--muted-text)]">{INTELLIGENCE_FIELD_LABELS[key]}: </span>
                    {formatIntelligenceValue(field.value)}
                    <span className="text-xs text-[var(--muted-text)]"> ({field.confidence} confidence)</span>
                  </p>
                )
              })}

              {product.productIntelligence.missing_information.length > 0 && (
                <div className={`mt-2 ${warningBannerClass}`}>
                  <p className={`${warningTextClass} font-medium mb-1`}>Missing information</p>
                  <ul className="list-disc list-inside">
                    {product.productIntelligence.missing_information.map((item, i) => (
                      <li key={i} className={warningTextClass}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
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

        <ProductPerformance productId={product.serverId} />
        <ProductHistory productId={product.serverId} />

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
  collapsed,
  onToggleCollapsed,
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
  collapsed: boolean
  onToggleCollapsed: () => void
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
    // Same collapse-to-narrow-rail mechanism as AppSidebar's own nav
    // (components/AppSidebar.tsx) — same ChevronIcon, same
    // transition-[width] duration-200 + overflow-hidden approach, same
    // click/toggle/localStorage-persisted pattern — reused directly, not
    // reimplemented. The one necessary adaptation: AppSidebar's nav is
    // position:fixed (spans the viewport height on its own), while this
    // panel is a normal flex-row sibling of the Listings column, so a
    // collapsed narrow rail would otherwise still get stretched to match
    // the Listings column's full height (flex's default cross-axis
    // stretch) — lg:self-start overrides that specifically while
    // collapsed, so it shrinks to its own natural (just-the-button)
    // height instead of leaving a tall empty box. Expanded keeps the
    // original lg:h-full/overflow-y-auto stretch-and-scroll behavior,
    // matching the Listings column's height either way. Collapse is a
    // desktop-only concept here too (same as AppSidebar's own mobile
    // behavior) — below lg every class below is inert, so the panel
    // always renders full-width/full-content on mobile regardless of
    // `collapsed`.
    <aside
      id="add-products-panel"
      className={`w-full shrink-0 flex flex-col overflow-hidden border-b lg:border-b-0 border-r-0 lg:border-r border-[var(--card-border)] bg-[var(--page-bg)] transition-[width] duration-200 ${
        collapsed ? 'lg:w-14 lg:self-start' : 'lg:w-[560px] lg:h-full'
      }`}
    >
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand Add Products' : 'Collapse Add Products'}
        title={collapsed ? 'Expand Add Products' : 'Collapse Add Products'}
        className={`flex items-center shrink-0 gap-2 px-3 py-2.5 mt-2 mx-2 rounded-lg text-[var(--muted-text)] hover:text-[var(--heading-text)] hover:bg-[var(--secondary-btn-bg-hover)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--page-bg)] focus:ring-blue-500 transition-colors ${
          collapsed ? 'justify-center' : 'justify-between'
        }`}
      >
        {!collapsed && <h2 className={sectionHeadingClass}>Add Products</h2>}
        {/* No text label (bare word next to the icon read as clutter) — the
            chevron itself gets a visible pill chip (border + tinted
            background, not just on hover) so it reads as its own
            distinct, clickable control instead of a faint stray stroke
            blending into the header. title/aria-label above still carry
            "Collapse"/"Expand" for the tooltip and for screen readers. */}
        <span className="flex items-center justify-center rounded-full border border-[var(--secondary-btn-border)] bg-[var(--secondary-btn-bg)] p-1">
          <ChevronIcon pointingRight={collapsed} />
        </span>
      </button>

      {/* Always mounted (never a JS-level unmount) so scrollIntoView/focus
          targeting from WorkspaceEmptyState's "+ Add Products" button
          keeps working — lg:hidden only ever applies at the desktop
          breakpoint collapse actually affects; mobile always shows this
          regardless of `collapsed`, matching AppSidebar's own mobile
          behavior. */}
      <div className={`flex-1 min-h-0 flex flex-col px-6 pb-6 pt-2 lg:overflow-y-auto ${collapsed ? 'lg:hidden' : ''}`}>
          <p className={`${bodyTextClass} mb-4`}>How would you like to add products?</p>

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
              manualImages={manualImages}
              onAddManualImages={onAddManualImages}
              onRemoveManualImage={onRemoveManualImage}
              onMoveManualImage={onMoveManualImage}
              manualImageInputRef={manualImageInputRef}
              formError={formError}
              guestLimitReached={guestLimitReached}
              brandMismatchPending={brandMismatchPending}
              selectedClient={selectedClient}
              pendingImageUrls={pendingImageUrls}
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
      </div>
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

// Confirm-before-destroy surface for the Listings toolbar's "Clear All"
// button — same structural convention as ExportGateModal (fixed inset-0 z-40
// centered overlay + backdrop + useFocusTrap + cardClass panel), the one
// existing modal pattern in this workspace, reused rather than a third
// bespoke dialog shape. `count` is the same listingSummary.total already
// shown in the "N Listings" header, so the copy here never drifts from what
// the user is actually looking at.
function ClearAllConfirmModal({
  count,
  clearing,
  onCancel,
  onConfirm
}: {
  count: number
  clearing: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, onCancel)

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={clearing ? undefined : onCancel} />
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Clear all listings"
        className={`relative p-6 max-w-sm w-full mx-4 focus:outline-none ${cardClass}`}
      >
        <p className="text-sm text-[var(--body-text)] mb-4">
          This will remove all {count} listing{count === 1 ? '' : 's'} from this session. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} disabled={clearing} className={linkButtonClass}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={clearing} className={buttonDestructiveClass}>
            {clearing ? 'Clearing...' : 'Clear All'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Pre-download confirmation surface (Milestone 9). Reuses ExportGateModal's
// exact structural convention above (fixed inset-0 z-40 centered overlay +
// backdrop + useFocusTrap + cardClass panel) for visual consistency with the
// one existing modal in this workspace. Eligibility copy says "approved,"
// not "Ready" — the real export rule is approved[marketplace], and a seller
// can approve a Needs Review listing after reviewing it, so it stays
// exportable. The Ready/Needs Review/Missing Data/Error breakdown shown here
// is purely informational context (via the same computeListingSummary()
// QueueTable's own filters use), not a second eligibility rule.
// Milestone C11 — one readiness row's icon/color, derived purely from the
// same status the gate already computed (never a second judgment made
// here). MISSING_FIELDS reads as an amber warning, NOT_READY as a hard
// error, matching the same severity distinction lib/exportReadiness.ts
// already carried over from C10's adapter.validate().
function readinessStatusDisplay(status: MarketplaceExportReadiness['status']): { icon: string; label: string; className: string } {
  if (status === 'READY') return { icon: '✓', label: 'Ready', className: 'text-[var(--success-text)]' }
  if (status === 'MISSING_FIELDS') return { icon: '⚠', label: 'Fields missing', className: 'text-[var(--warn-text)]' }
  return { icon: '✕', label: 'Not ready', className: 'text-[var(--danger-text)]' }
}

function ExportSummaryModal({
  exportableCounts,
  summary,
  exportError,
  readiness,
  onClose,
  onConfirmReady
}: {
  exportableCounts: { marketplace: Marketplace; count: number }[]
  summary: { total: number; ready: number; needsReview: number; missingData: number; error: number }
  exportError: string | null
  readiness: MarketplaceExportReadiness[] | null
  onClose: () => void
  onConfirmReady: (marketplaces: Marketplace[]) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, onClose)
  const totalExportable = exportableCounts.reduce((sum, c) => sum + c.count, 0)
  // Milestone C11 — §11/§21/§22 (C11-AC21/AC22): readiness is recomputed
  // fresh every time this modal opens (see the effect in the parent) and is
  // null until that finishes, which is what drives the loading state and
  // keeps Export All Ready disabled until real results exist — never a
  // fabricated delay for something that already resolved.
  const isCheckingReadiness = totalExportable > 0 && readiness === null
  const ready = readiness ? readyMarketplaces(readiness) : []

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Export listings"
        className={`relative p-6 max-w-sm w-full mx-4 max-h-[85vh] overflow-y-auto focus:outline-none ${cardClass}`}
      >
        <h2 className={`${sectionHeadingClass} mb-3`}>Export Listings</h2>

        {totalExportable === 0 ? (
          <>
            <p className={`${bodyTextClass} mb-1`}>No listings are ready to export yet.</p>
            <p className="mb-4 text-sm text-[var(--muted-text)]">
              Generate, review, and approve at least one marketplace's listing before exporting.
            </p>
          </>
        ) : (
          <>
            <p className={`${bodyTextClass} mb-3`}>Only approved listings will be exported.</p>

            <ul className="mb-3 flex flex-col gap-1">
              {exportableCounts.map(({ marketplace, count }) => (
                <li key={marketplace} className="flex justify-between text-sm text-[var(--body-text)]">
                  <span>{MARKETPLACE_LABELS[marketplace]}</span>
                  <span>{count}</span>
                </li>
              ))}
              <li className="flex justify-between text-sm font-semibold text-[var(--body-text)] pt-1 border-t border-[var(--row-border)]">
                <span>Total</span>
                <span>{totalExportable}</span>
              </li>
            </ul>

            {summary.total > 0 && (
              <p className="mb-4 text-xs text-[var(--muted-text)]">
                Across all listings: {summary.ready} Ready, {summary.needsReview} Needs Review, {summary.missingData} Missing
                Data, {summary.error} Error.
              </p>
            )}

            {/* Milestone C11 — the readiness gate itself: one row per
                marketplace that has at least one approved listing, backed
                entirely by the C10 adapter (lib/exportReadiness.ts calls
                getMarketplaceAdapter(...).validate() — no marketplace rule
                is re-derived here). */}
            <div className="mb-4 pb-4 border-b border-[var(--card-border)]">
              <p className={`${labelClass} mb-1`}>Marketplace readiness</p>
              {isCheckingReadiness ? (
                <p className={bodyTextClass}>Checking marketplace readiness…</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {(readiness ?? []).map((r) => {
                    const display = readinessStatusDisplay(r.status)
                    return (
                      <div key={r.marketplace} className="text-sm">
                        <p className="font-medium text-[var(--heading-text)]">
                          {MARKETPLACE_LABELS[r.marketplace]}{' '}
                          <span className={display.className}>
                            {display.icon} {r.status === 'MISSING_FIELDS' ? `${r.issues.length} field${r.issues.length === 1 ? '' : 's'} missing` : display.label}
                          </span>
                        </p>
                        {r.issues.length > 0 && (
                          <ul className="ml-4 list-disc list-inside text-xs text-[var(--muted-text)]">
                            {r.issues.map((issue, i) => (
                              <li key={i}>{issue.field}{issue.message ? ` — ${issue.message}` : ''}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {exportError && (
          <div className={`mb-4 ${dangerBannerClass}`}>
            <p className={dangerTextClass}>{exportError}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={linkButtonClass}>
            {totalExportable === 0 ? 'Close' : 'Cancel'}
          </button>
          {totalExportable > 0 && (
            <button
              onClick={() => onConfirmReady(ready)}
              disabled={isCheckingReadiness || ready.length === 0}
              className={buttonPrimaryClass}
            >
              Export All Ready
            </button>
          )}
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
  // Milestone C12 — Edit Brand Profile modal.
  const [showBrandProfile, setShowBrandProfile] = useState(false)
  // Saved session read from localStorage on mount, held here until we also know
  // whether the visitor is authenticated — that decides auto-restore vs. banner.
  const [savedSessionData, setSavedSessionData] = useState<any | null>(null)

  const [brandName, setBrandName] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  // Milestone C17.1 — imageFile/imageFileDataUrl/fileInputRef below are now
  // Photos Only's exclusively (single image, unchanged). Manual Entry's own
  // multi-image state is manualImages/manualImageInputRef, further down.
  const [imageFile, setImageFile] = useState<File | null>(null)
  // Base64 mirror of imageFile (when small enough), so the form's in-progress,
  // not-yet-submitted image pick can survive a redirect/refresh via localStorage —
  // a raw File object can't be JSON-serialized.
  const [imageFileDataUrl, setImageFileDataUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Milestone C17.1 — Manual Entry's in-progress (not-yet-submitted) image
  // picker: an ordered list of up to MAX_MANUAL_IMAGES slots, each either a
  // freshly picked File (not yet uploaded) or an already-uploaded/persisted
  // URL (editing an existing product) — never both. Deliberately NOT
  // mirrored into the localStorage formDraft the way imageFileDataUrl is
  // above (a multi-file base64 mirror would multiply that persistence
  // mechanism's size/complexity for a rare edge case — an accidental
  // refresh mid-fill loses picked-but-not-yet-uploaded images, same as it
  // already loses any other never-submitted form state that isn't
  // explicitly persisted). Resolved into a real string[] (uploading
  // whichever slots are still Files) only at Add Product / Save Changes
  // time — see resolveManualImageUrls.
  const [manualImages, setManualImages] = useState<ManualImageSlot[]>([])
  const manualImageInputRef = useRef<HTMLInputElement>(null)
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
  // Milestone 32 (C9) — client-side single-flight guard, same purpose as
  // currentlyGenerating above: disables the "Analyze Product" button for the
  // one product currently being enriched, so a double-click can't fire two
  // concurrent requests for the same product from this tab. The server route
  // has its own independent 'processing'-status check for the same reason
  // (a second tab/device, or a request that outlives this component).
  const [enrichingProductId, setEnrichingProductId] = useState<string | null>(null)
  // Generate Listings loading experience — set only at real transition
  // points inside generateForProductMarketplace/handleGenerateAll/
  // runGeneration (never a timer): 'preparing' is set before
  // ensureProductIntelligence is even awaited, so the render layer's
  // "Analyzing Product X of Y" label (derived below from enrichingProductId,
  // never stored here) can overlay it for exactly as long as a real
  // /api/enrich-product call is genuinely in flight — for a product whose
  // intelligence was already complete, enrichingProductId never sets and
  // 'preparing' shows directly, which is correct: no real analysis ran.
  // 'generating' is set once the request is about to be sent (with the
  // marketplace it's for), 'validating' once a successful response has
  // arrived and is being merged into state. 'complete'/'failed' are set by
  // the caller (handleGenerateAll after its whole batch, runGeneration
  // after its one call) — never per-pair inside a bulk batch, so the
  // banner doesn't flash "complete" after every individual pair.
  const [generationStage, setGenerationStage] = useState<GenerationStageInfo | null>(null)
  // Milestone 22 (Step C2) — memoizes the in-flight/completed catalog_products
  // creation per DraftProduct.id, keyed by the stable client-local `id` (never
  // the possibly-stale `serverId` snapshot a caller might be holding). A ref,
  // not state: it must never trigger a re-render, and must survive across the
  // whole component's lifetime, not reset per render. This closes the one
  // realistic same-tab race the comment above already rules out for the bulk
  // path (sequential, never parallel) but doesn't rule out for two individual
  // regenerate/retry actions fired close together for the same product — see
  // ensureServerProduct below and the Milestone 22 report for what this does
  // and does not protect against.
  const serverProductPromises = useRef<Map<string, Promise<string>>>(new Map())
  // Product Intelligence, as the intelligence layer INSIDE generation (not a
  // separate manual prerequisite) — see ensureProductIntelligence below.
  // Same memoization pattern/reasoning as serverProductPromises just above:
  // keyed by the stable client-local product.id, a ref (never state) so it
  // survives the component's whole lifetime without triggering a re-render,
  // and exists specifically to dedupe two near-simultaneous callers for the
  // SAME product (e.g. Generate Listings running across several selected
  // marketplaces for one product in a single batch) into one real
  // /api/enrich-product request instead of one per marketplace.
  const productIntelligencePromises = useRef<Map<string, Promise<ProductIntelligenceData | null>>>(new Map())
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
  // Milestone C17.1 — was a single string | null; Manual Entry now resolves
  // to (and defers, across the brand-mismatch pause, on the exact same
  // uploaded set) an ordered array. Photos Only never reads/sets this — it
  // has no brand-mismatch gate (see handleAddImageOnlyProduct).
  const [pendingImageUrls, setPendingImageUrls] = useState<string[]>([])
  const [uploadingImage, setUploadingImage] = useState(false)
  const [pendingCsvUpload, setPendingCsvUpload] = useState<PendingCsvUpload | null>(null)
  // Surfaced when a server-side product delete fails (RLS rejection, not
  // found, network error) — the product stays visible rather than being
  // optimistically removed, so the seller isn't shown a "deleted" state
  // that didn't actually happen server-side.
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // Add Products' collapse/expand preference. null = no explicit choice
  // made yet, so the derived value below falls back to "expanded while
  // the queue is empty, collapsed once a product exists." An explicit
  // toggle (click) sets a real true/false here AND persists it to
  // localStorage (see the effect/handler below), same pattern
  // AppSidebar's own collapse preference already uses — from then on the
  // stored choice always wins over the empty/non-empty default.
  const [addProductsCollapsedPreference, setAddProductsCollapsedPreference] = useState<boolean | null>(null)
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)
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
  // Pre-download confirmation surface (Milestone 9) — shown after the
  // existing sign-in/marketplace gates pass, before the real download runs.
  const [showExportSummary, setShowExportSummary] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  // Milestone C11 — Export Readiness Gate. null means "not yet computed for
  // this modal opening" (renders as a brief loading state, matches §11);
  // recomputed fresh every time the modal opens so approving/regenerating a
  // listing between two export attempts is always reflected.
  const [exportReadiness, setExportReadiness] = useState<MarketplaceExportReadiness[] | null>(null)
  // Set once, right after a successful export, alongside the existing
  // downloadMessage banner — which marketplaces the readiness gate excluded
  // from that specific export and why. Cleared on the next export attempt.
  const [exportSkipped, setExportSkipped] = useState<{ marketplace: Marketplace; reason: string }[] | null>(null)

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

  // Reads an explicit prior Add Products collapse/expand choice, if one
  // was ever made — same mount-time-read pattern as AppSidebar's own
  // collapse preference. No stored value yet means no explicit choice has
  // been made, so addProductsCollapsed (derived below) falls back to the
  // empty/non-empty default instead.
  useEffect(() => {
    const stored = localStorage.getItem(ADD_PRODUCTS_COLLAPSE_STORAGE_KEY)
    if (stored === 'true' || stored === 'false') {
      setAddProductsCollapsedPreference(stored === 'true')
    }
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
  // have landed. handleOpenExportSummary's own hasSession check would otherwise
  // still see the stale initial `false` if called directly above, since that
  // auth check resolves asynchronously.
  useEffect(() => {
    if (autoDownloadPending && hasSession) {
      setAutoDownloadPending(false)
      handleOpenExportSummary()
    }
  }, [autoDownloadPending, hasSession])

  // Milestone 26 (Step C4) — server-backed catalog hydration, authenticated
  // users only. Deliberately layered on top of the existing local-restore
  // flow above (fires only once `sessionReady` is already true) rather than
  // threaded into that flow's own timing — the local-restore/guest-banner
  // behavior above is already verified across many milestones and this
  // milestone is read-path-only, so it isn't touched. The tradeoff: an
  // authenticated user may briefly see their local-only view before it
  // updates with anything additional the server has, rather than the
  // loading skeleton staying up for both steps combined. A ref (not state)
  // guards this to run exactly once per mount — StrictMode's dev
  // double-invoke, or any incidental re-run of this effect, must not
  // re-fetch and re-merge repeatedly.
  const catalogHydrationRan = useRef(false)
  useEffect(() => {
    if (!sessionReady || !hasCheckedSession || !hasSession) return
    if (catalogHydrationRan.current) return
    catalogHydrationRan.current = true

    getCatalog()
      .then((server) => {
        setDraftProducts((prev) => {
          const reconciled = reconcileCatalog(prev, server, computeProductStatus)
          // Milestone 32 (C9) — product_intelligence is deliberately NOT part
          // of C4's reconciliation contract (lib/catalogReconciliation.ts is
          // untouched by this milestone, same as every prior C-file). This is
          // a separate, thin pass applied after it: matches each reconciled
          // product to its already-fetched server row by serverId and
          // carries product_intelligence through so an earlier enrichment
          // survives a reload, instead of only living in this session's
          // in-memory state.
          const intelligenceByServerId = new Map(server.products.map((p) => [p.id, p.product_intelligence]))
          return reconciled.map((p) =>
            p.serverId && intelligenceByServerId.has(p.serverId)
              ? { ...p, productIntelligence: intelligenceByServerId.get(p.serverId) }
              : p
          )
        })
      })
      .catch((err: any) => {
        // Rule 14 — fail open to whatever the existing local-restore flow
        // already produced. Never clear draftProducts, never block the
        // workspace, never surface a fatal error over a read failure.
        console.error('Catalog hydration failed, continuing with local data only:', err?.message ?? err)
      })
  }, [sessionReady, hasCheckedSession, hasSession])

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
    setDraftProducts(
      products.map((p: any) => ({
        ...p,
        imageFile: null,
        // Milestone C17.1 — a session saved before this shipped won't have
        // imageUrls at all after JSON.parse; every real consumer (the
        // multi-image editor, exports, etc.) assumes a real array, so this
        // is the one place that backfills it, from the product's own
        // pre-existing single imageUrl.
        imageUrls: Array.isArray(p.imageUrls) ? p.imageUrls : p.imageUrl ? [p.imageUrl] : []
      }))
    )
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

  // Selecting a Brand Voice auto-fills Brand Name with that brand's own
  // name — visible, immediate confirmation of which brand's guidelines
  // generation will actually use, rather than the seller having to type a
  // matching name themselves and only finding out it matched (or didn't)
  // via the brand-mismatch gate at submit time. brandName is the one field
  // shared by both Manual Entry and Photos Only (see LeftPanel/
  // ImageOnlyPanel, both driven by this same state), so filling it once
  // here surfaces it in both places at once — no per-tab wiring needed.
  // Two guards, both matching the existing mismatch gate's own semantics
  // (handleAddProduct's `!editingId && selectedClient && ...`):
  //   - !editingId: never overwrites an in-progress edit's own brand name
  //     just because the Brand Voice dropdown was touched.
  //   - client (not null): deselecting back to "No brand selected" leaves
  //     whatever the seller already typed alone, rather than clearing it.
  function handleSelectClient(client: Client | null) {
    setSelectedClient(client)
    if (client && !editingId) {
      setBrandName(client.client_name)
      setFormError(null)
      setBrandMismatchPending(false)
    }
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
    setPendingImageUrls([])
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
    setManualImages([])
    if (manualImageInputRef.current) {
      manualImageInputRef.current.value = ''
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

  // Milestone C17.1 — the multi-image counterparts of the single-image
  // picker's onImageFileChange/setImageFile. handleAddManualImages enforces
  // the MAX_MANUAL_IMAGES cap client-side (silently drops anything beyond
  // the remaining room, rather than erroring — picking 3 files with 2 slots
  // left fills the 2 slots, exactly like a real multi-select file dialog
  // would be expected to behave); the DB-side CHECK constraint on
  // catalog_products.image_urls is the second, non-UI-reliant enforcement
  // layer (see the migration).
  function handleAddManualImages(files: File[]) {
    setManualImages((prev) => {
      const room = MAX_MANUAL_IMAGES - prev.length
      if (room <= 0) return prev
      return [...prev, ...files.slice(0, room).map((file) => ({ file, url: null }))]
    })
  }

  function handleRemoveManualImage(index: number) {
    setManualImages((prev) => prev.filter((_, i) => i !== index))
  }

  function handleMoveManualImage(index: number, direction: -1 | 1) {
    setManualImages((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  // Uploads only the slots that are still a raw File (an already-uploaded/
  // persisted slot, from editing an existing product, keeps its real URL
  // untouched) and returns the final ordered string[] — same order as
  // manualImages, first element always the primary image. Parallel
  // (Promise.all): each upload is independent, and order is preserved by
  // construction regardless of which one resolves first. Throws (letting
  // the caller's existing try/catch/setFormError handle it) on any single
  // failure, same fail-the-whole-submission behavior the old one-image
  // uploadProductImage call already had — never a partially-uploaded
  // product.
  async function resolveManualImageUrls(): Promise<string[]> {
    const hasNewFiles = manualImages.some((slot) => slot.file)
    if (!hasNewFiles) {
      return manualImages.map((slot) => slot.url).filter((url): url is string => !!url)
    }
    setUploadingImage(true)
    try {
      const resolved = await Promise.all(manualImages.map((slot) => (slot.file ? uploadProductImage(slot.file) : slot.url)))
      return resolved.filter((url): url is string => !!url)
    } finally {
      setUploadingImage(false)
    }
  }

  async function handleAddProduct() {
    // Marketplace selection is not required to add a product — it's only
    // relevant to generation (see handleGenerateAll's requireMarketplace()
    // check). A product can exist in the catalog before any marketplace has
    // been chosen; it just sits there ungenerated until one is.
    // Category is optional — LeftPanel's own "⚠ Category missing" note
    // still nudges toward adding one (better generation quality), but it
    // must never block Add Product the way a missing Brand Name/
    // Description does.
    if (!brandName.trim() || !description.trim()) {
      setFormError('Brand Name and Description are required.')
      return
    }
    setFormError(null)

    let uploadedImageUrls: string[]
    try {
      uploadedImageUrls = await resolveManualImageUrls()
    } catch (err: any) {
      setFormError(err.message || 'Image upload failed. Please try again.')
      return
    }

    if (!editingId && selectedClient && !wordLevelMatch(brandName, selectedClient.client_name)) {
      setPendingImageUrls(uploadedImageUrls)
      setBrandMismatchPending(true)
      return
    }

    commitAddProduct(false, uploadedImageUrls, undefined, 'manual')
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
    // product. uploadedImageUrl ? [uploadedImageUrl] : undefined — Photos
    // Only is still single-image and keeps its exact original semantics:
    // undefined ("no new image in this submission") leaves an existing
    // product's images untouched, matching what a bare `uploadedImageUrl ?
    // {...} : {}` conditional in commitAddProduct already did before C17.1.
    commitAddProduct(true, uploadedImageUrl ? [uploadedImageUrl] : undefined, '', 'photo')
  }

  // Milestone C17.1 — uploadedImageUrls is now an array, but its MEANING
  // stays exactly what the single uploadedImageUrl parameter's truthiness
  // used to mean, generalized:
  //   - undefined = "no new image(s) provided in this submission" (only
  //     ever passed by Photos Only when its shared imageFile is empty) —
  //     an edit leaves the product's existing images completely untouched,
  //     exactly like the original `uploadedImageUrl ? {...} : {}` did.
  //   - a real array (Manual Entry ALWAYS passes one, even []) = "this is
  //     now the complete, authoritative image set" — an edit replaces
  //     imageUrls wholesale, since Manual Entry's grid IS the full editable
  //     set and a removal is a meaningful edit, not an omission.
  function commitAddProduct(
    skipBrandVoice: boolean,
    uploadedImageUrls: string[] | undefined,
    descriptionOverride: string | undefined,
    source: 'manual' | 'csv' | 'photo'
  ) {
    const effectiveDescription = descriptionOverride ?? description

    if (editingId) {
      const existing = draftProducts.find((p) => p.id === editingId)
      setDraftProducts((prev) =>
        prev.map((p) =>
          p.id === editingId
            ? {
                ...p,
                brandName,
                category,
                description: effectiveDescription,
                ...(uploadedImageUrls !== undefined
                  ? { imageFile: null, imageUrl: uploadedImageUrls[0] ?? null, imageUrls: uploadedImageUrls }
                  : {})
              }
            : p
        )
      )

      // Milestone C14 — additive persistence: before this, an edit only
      // ever updated local state. Guests and products with no server row
      // yet (nothing has been generated for them) have nothing to persist
      // — never a fabricated update. product_updated is only recorded
      // AFTER updateProduct's own write actually resolves.
      if (hasSession && existing?.serverId) {
        const serverId = existing.serverId
        void updateProduct(serverId, {
          brand_name: brandName || null,
          description: effectiveDescription || null,
          category: category || null,
          ...(uploadedImageUrls !== undefined
            ? { image_url: uploadedImageUrls[0] ?? null, image_urls: uploadedImageUrls }
            : {})
        })
          .then(() => {
            recordProductHistoryEvent({ productId: serverId, eventType: 'product_updated' }).catch((err: any) => {
              console.error(`Product history: failed to record product_updated for ${serverId}:`, err?.message ?? err)
            })
          })
          .catch((err: any) => {
            console.error(`Catalog persistence: failed to update catalog_products row ${serverId}:`, err?.message ?? err)
          })
      }

      setEditingId(null)
      setDescription('')
      setImageFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      setManualImages([])
      if (manualImageInputRef.current) {
        manualImageInputRef.current.value = ''
      }
      setBrandMismatchPending(false)
      setPendingImageUrls([])
      return
    }

    const resolvedImageUrls = uploadedImageUrls ?? []
    const newProduct: DraftProduct = {
      id: crypto.randomUUID(),
      brandName,
      description: effectiveDescription,
      category,
      imageFile: null,
      imageUrl: resolvedImageUrls[0] ?? null,
      imageUrls: resolvedImageUrls,
      generatedContent: emptyGeneratedContent(),
      approved: emptyApproved(),
      status: 'draft',
      generationError: emptyGenerationError(),
      generationMeta: emptyGenerationMeta(),
      visualAttributes: null,
      skipBrandVoice
    }

    setDraftProducts((prev) => [...prev, newProduct])

    // Milestone 30 (C8) — same fire-and-forget, best-effort persistence
    // convention already established for generation (persistGenerationToCatalog
    // below): never awaited, a failure here must never block adding the
    // product locally or surface as a user-facing error. Routes through the
    // exact same ensureServerProduct used at generation time (Step C2), so a
    // product added here and later generated never double-creates its
    // catalog_products row — ensureServerProduct's own serverId/in-flight-map
    // checks (see its definition below) already de-dupe that race. Guests
    // are skipped entirely, matching every other hasSession-gated catalog
    // write in this file; their products stay local-only, unchanged from
    // before this milestone.
    if (hasSession) {
      void ensureServerProduct(newProduct, source).catch((err: any) => {
        console.error(
          `Catalog persistence: failed to create catalog_products for newly added product ${newProduct.id}:`,
          err?.message ?? err
        )
      })
    }

    setDescription('')
    setImageFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    setManualImages([])
    if (manualImageInputRef.current) {
      manualImageInputRef.current.value = ''
    }
    setBrandMismatchPending(false)
    setPendingImageUrls([])
  }

  function handleEditProduct(product: DraftProduct) {
    setBrandName(product.brandName)
    setCategory(product.category)
    setDescription(product.description)
    setImageFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    // Milestone C17.1 — seeds the multi-image editor with this product's
    // real, already-uploaded images (each as a { file: null, url } slot,
    // in their persisted order) so editing shows exactly what's already
    // there, per §10. Falls back to imageUrl for a product whose imageUrls
    // is empty/absent (a pre-C17.1 single-image product, or one restored
    // from an old local session — see DraftProduct.imageUrls' own comment).
    setManualImages(
      (product.imageUrls.length > 0 ? product.imageUrls : product.imageUrl ? [product.imageUrl] : []).map((url) => ({
        file: null,
        url
      }))
    )
    if (manualImageInputRef.current) {
      manualImageInputRef.current.value = ''
    }
    setEditingId(product.id)
    // Switches the always-visible Add Products panel to Manual Entry so
    // the pre-filled form is immediately visible — the panel itself never
    // needs to be shown/hidden anymore, it's already on screen.
    setActiveTab('manual')
  }

  // Fixes a confirmed delete-doesn't-persist bug: this used to only ever
  // call setDraftProducts, never any server call, so the next
  // reconcileCatalog (on reload) pulled the still-present row straight
  // back in. Local removal only ever happens AFTER lib/catalog.ts's
  // deleteProduct() confirms the row is actually gone (RLS-owner-scoped,
  // cascades to catalog_listings/catalog_listing_approvals) — a failed
  // server delete leaves the product visibly in place with deleteError
  // set, rather than silently showing a "deleted" state that isn't real.
  async function handleDeleteProduct(id: string) {
    const product = draftProducts.find((p) => p.id === id)
    setDeleteError(null)

    // Guests, and any product whose server row was never created (no
    // generation attempt has run for it yet — see ensureServerProduct),
    // have nothing to delete server-side; removing local state is already
    // the complete, correct action for those.
    if (hasSession && product?.serverId) {
      try {
        await deleteProduct(product.serverId)
      } catch (err: any) {
        console.error(`Catalog persistence: failed to delete catalog_products row ${product.serverId}:`, err?.message ?? err)
        setDeleteError(`Couldn't delete "${product.brandName || 'this product'}" — please try again.`)
        return
      }
    }

    setDraftProducts((prev) => prev.filter((p) => p.id !== id))
    if (viewingTarget?.productId === id) setViewingTarget(null)
    if (editingId === id) handleClearForm()
  }

  // Same server-confirms-before-local-removal discipline as
  // handleDeleteProduct above, batched. One extra guard handleDeleteProduct
  // doesn't need: getProductIdsWithPerformanceHistory checks for linked
  // marketplace_performance rows first (that table's product_id carries `on
  // delete cascade` — see lib/catalog.ts) and those products are left in the
  // queue rather than deleted, so "Clear All" can never silently take
  // imported performance history down with it.
  async function handleClearAll() {
    setDeleteError(null)
    setClearingAll(true)

    const candidateServerIds = draftProducts
      .filter((p) => hasSession && p.serverId)
      .map((p) => p.serverId as string)

    let protectedIds = new Set<string>()
    if (candidateServerIds.length > 0) {
      try {
        protectedIds = await getProductIdsWithPerformanceHistory(candidateServerIds)
      } catch (err: any) {
        console.error('Catalog persistence: failed to check performance history before Clear All:', err?.message ?? err)
        setDeleteError("Couldn't verify performance history before clearing — please try again.")
        setClearingAll(false)
        setShowClearAllConfirm(false)
        return
      }
    }

    const kept: DraftProduct[] = []
    let failedCount = 0

    for (const product of draftProducts) {
      if (hasSession && product.serverId) {
        if (protectedIds.has(product.serverId)) {
          kept.push(product)
          continue
        }
        try {
          await deleteProduct(product.serverId)
        } catch (err: any) {
          console.error(`Catalog persistence: failed to delete catalog_products row ${product.serverId}:`, err?.message ?? err)
          kept.push(product)
          failedCount++
          continue
        }
      }
    }

    const clearedCount = draftProducts.length - kept.length
    setDraftProducts(kept)

    const keptIds = new Set(kept.map((p) => p.id))
    if (viewingTarget && !keptIds.has(viewingTarget.productId)) setViewingTarget(null)
    if (editingId && !keptIds.has(editingId)) handleClearForm()

    if (protectedIds.size > 0 || failedCount > 0) {
      const parts: string[] = []
      if (protectedIds.size > 0) parts.push(`${protectedIds.size} kept (linked performance history)`)
      if (failedCount > 0) parts.push(`${failedCount} failed to delete`)
      setDeleteError(`Cleared ${clearedCount} of ${draftProducts.length} listings. ${parts.join('; ')}.`)
    }

    setClearingAll(false)
    setShowClearAllConfirm(false)
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

      // Bulk Upload stays single-image (C17.1 explicitly doesn't touch it —
      // see §14/C17.2) — imageUrls is just the [imageUrl] mirror so a CSV
      // row's product still shows/edits correctly in Manual Entry's
      // multi-image grid if the seller opens it to edit later.
      const csvImageUrl = pick(row, 'image url', 'image_url')
      newProducts.push({
        id: crypto.randomUUID(),
        brandName: brand,
        description: rowDescription,
        category: pick(row, 'category') || '',
        imageFile: null,
        imageUrl: csvImageUrl,
        imageUrls: csvImageUrl ? [csvImageUrl] : [],
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

    // Milestone 30 (C8) — same convention as commitAddProduct above, applied
    // per row: fire-and-forget, best-effort, guests skipped. Each row goes
    // through its own independent ensureServerProduct call/promise (keyed by
    // that row's own id in serverProductPromises), so one row's failure
    // can't affect any other row in the same CSV batch.
    if (hasSession) {
      for (const product of products) {
        void ensureServerProduct(product, 'csv').catch((err: any) => {
          console.error(
            `Catalog persistence: failed to create catalog_products for CSV row (product ${product.id}):`,
            err?.message ?? err
          )
        })
      }
    }

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

    // A fresh "Generate Listings" click is a new request — a product whose
    // LAST Product Intelligence attempt failed should get a genuine retry
    // here, not permanently reuse that cached null result (see
    // ensureProductIntelligence's own comment on why the cache otherwise
    // never clears). `pending` above was just read live, so this is the one
    // point in the batch where productIntelligence?.status is trustworthy —
    // every generateForProductMarketplace call below receives this same
    // now-frozen `product` object, which won't reflect updates the batch
    // makes to itself as it runs.
    for (const product of pending) {
      if (product.productIntelligence?.status === 'failed') {
        productIntelligencePromises.current.delete(product.id)
      }
    }

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

    let stoppedForCredits = false

    outer: for (let productIndex = 0; productIndex < pending.length; productIndex++) {
      const product = pending[productIndex]
      for (const marketplace of runMarketplaces) {
        setCurrentlyGenerating({ productId: product.id, marketplace })
        setGenerationProgress({ current: completedPairs + 1, total: totalPairs })

        const outcome = await generateForProductMarketplace(product, marketplace, runMarketplaces, undefined, {
          productIndex: productIndex + 1,
          totalProducts: pending.length
        })
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
          stoppedForCredits = true
          break outer
        }
      }
    }

    setCurrentlyGenerating(null)
    setGenerationProgress(null)
    setGenerating(false)
    // Terminal loading-experience state for the WHOLE batch, never per-pair
    // (that would flash "complete" after every individual item). Insufficient
    // credits already has its own, more specific banner (creditsStoppedInfo,
    // rendered just below) — clearing here rather than also showing a
    // generic "failed" avoids two banners saying overlapping things.
    setGenerationStage(
      stoppedForCredits
        ? null
        : succeededPairs > 0
          ? { phase: 'complete', productId: null, productIndex: null, totalProducts: null, marketplaceLabel: null }
          : completedPairs > 0
            ? { phase: 'failed', productId: null, productIndex: null, totalProducts: null, marketplaceLabel: null }
            : null
    )
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

    // Same fresh-retry reasoning as handleGenerateAll's own eviction loop —
    // `product` here is freshly read (not a stale batch snapshot), but
    // ensureProductIntelligence's cache is still keyed by id and would
    // otherwise permanently reuse a prior failure's cached null result.
    if (product.productIntelligence?.status === 'failed') {
      productIntelligencePromises.current.delete(product.id)
    }

    const key = `${id}:${marketplace}`
    setCurrentlyGenerating({ productId: id, marketplace })
    const outcome = await generateForProductMarketplace(product, marketplace, selectedMarketplaces, fieldGroup)
    setCurrentlyGenerating(null)
    // Terminal state for this one call — no productIndex/totalProducts
    // (undefined progressContext above), so the banner shows the single-
    // product phrasing without "1 of 1" clutter (requirement D).
    setGenerationStage((prev) =>
      prev && prev.productId === id
        ? { ...prev, phase: outcome === 'success' ? 'complete' : 'failed' }
        : prev
    )

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

  // Milestone 32 (C9) — the one real implementation that ever talks to
  // /api/enrich-product. Both the manual "Analyze Product" button
  // (handleAnalyzeProduct) and the automatic pre-generation trigger
  // (ensureProductIntelligence, below) call this — never two independently
  // maintained copies of the same fetch/parse/persist logic. Requires
  // serverId (a catalog_products row must already exist — true for every
  // authenticated add since C8's eager creation, never true for a guest,
  // matching the fact that the enrichment API operates on a persisted row
  // and derives ownership from the session, not from anything in this
  // request body). Never throws — a failure resolves to null and is
  // surfaced only via draftProducts' own productIntelligence status field
  // (rendered in the drawer), same as before.
  async function runProductIntelligenceAnalysis(id: string, serverId: string): Promise<ProductIntelligence | null> {
    setEnrichingProductId(id)
    try {
      const res = await fetch('/api/enrich-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: serverId })
      })
      const data = await res.json().catch(() => null)
      const intelligence: ProductIntelligence | undefined = data?.productIntelligence
      if (intelligence) {
        setDraftProducts((prev) => prev.map((p) => (p.id === id ? { ...p, productIntelligence: intelligence } : p)))
        return intelligence
      }
      if (!res.ok) {
        console.error(`Product intelligence: enrichment request failed for product ${id}:`, data?.error ?? res.status)
      }
      return null
    } catch (err: any) {
      console.error(`Product intelligence: enrichment request failed for product ${id}:`, err?.message ?? err)
      return null
    } finally {
      // Guarded (not a bare setEnrichingProductId(null)) so this can't clear
      // a DIFFERENT product's still-in-flight analysis out from under it —
      // matters now that this same function is reachable from two callers.
      setEnrichingProductId((prev) => (prev === id ? null : prev))
    }
  }

  async function handleAnalyzeProduct(id: string) {
    const product = draftProducts.find((p) => p.id === id)
    if (!product?.serverId || enrichingProductId) return
    await runProductIntelligenceAnalysis(id, product.serverId)
  }

  // Product Intelligence as the intelligence layer INSIDE generation, not a
  // separate manual prerequisite — called once per product from
  // generateForProductMarketplace ahead of every full (non-field-scoped)
  // generation request, never per (product, marketplace) pair.
  //   - Already completed -> reused as-is. Never re-run just because
  //     generation was requested again.
  //   - Guest, or no serverId yet -> skipped entirely (/api/enrich-product
  //     requires a real session and a persisted catalog_products row);
  //     generation proceeds without intelligence exactly as it already does
  //     today for guests.
  //   - Otherwise -> runs runProductIntelligenceAnalysis (the same
  //     implementation "Analyze Product" uses) and resolves to the fresh
  //     completed data, or null on failure/absence.
  // productIntelligencePromises memoizes by product.id and is deliberately
  // NEVER cleared on settle (same permanent-memoization pattern as
  // serverProductPromises above, same reason: the `product` parameter a
  // caller holds can be a stale pre-batch snapshot — e.g. Generate Listings
  // running 2+ selected marketplaces for the same product one after
  // another — so its own `productIntelligence` field can't be trusted to
  // reflect an update this exact batch already made; the id-keyed map can).
  // A batch that needs to retry a PRIOR failure evicts that one entry
  // explicitly before it starts (see handleGenerateAll/runGeneration) — the
  // cache's own job is only "never run this twice for the same request,"
  // never "remember a failure forever."
  async function ensureProductIntelligence(product: DraftProduct): Promise<ProductIntelligenceData | null> {
    const existing = productIntelligencePromises.current.get(product.id)
    if (existing) return existing

    if (product.productIntelligence?.status === 'completed') {
      const resolved = Promise.resolve(product.productIntelligence.data)
      productIntelligencePromises.current.set(product.id, resolved)
      return resolved
    }

    if (!hasSession || !product.serverId) {
      return null
    }

    const serverId = product.serverId
    const promise = runProductIntelligenceAnalysis(product.id, serverId).then((intelligence) =>
      intelligence?.status === 'completed' ? intelligence.data : null
    )
    productIntelligencePromises.current.set(product.id, promise)
    return promise
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
  // Milestone 22 (Step C2) — resolves (creating if necessary) the
  // catalog_products row for a DraftProduct. Checks the product's own
  // `serverId` first (set once a prior creation in this session succeeded,
  // or restored from a saved localStorage session), then falls back to the
  // in-flight/completed promise cache keyed by the stable `product.id` —
  // this second check is what actually closes the race for two
  // near-simultaneous calls, since a stale `product` snapshot's `serverId`
  // can't be trusted the way the map (keyed by an id that never changes)
  // can. See the Milestone 22 report for the one case this does NOT cover:
  // two separate browser tabs/devices both restoring the same localStorage
  // draft and generating independently — this map is per-tab, in-memory
  // only, and catalog_products has no column to put a database-level
  // uniqueness guarantee on without a schema change (out of scope here).
  // Milestone C14 — `source` (manual/csv/photo) is threaded through from
  // every call site so product_created's metadata records a real,
  // known-at-creation-time fact, never a guess made after the fact.
  async function ensureServerProduct(product: DraftProduct, source: 'manual' | 'csv' | 'photo'): Promise<string> {
    if (product.serverId) return product.serverId

    const existing = serverProductPromises.current.get(product.id)
    if (existing) return existing

    const promise = (async () => {
      const id = await createProduct({
        brand_name: product.brandName || null,
        description: product.description || null,
        category: product.category || null,
        image_url: product.imageUrl || null,
        image_urls: product.imageUrls,
        client_id: product.skipBrandVoice ? null : selectedClient?.id ?? null
      })
      setDraftProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, serverId: id } : p)))
      // Fire-and-forget, same convention as every other product-history
      // call in this file — a history-recording failure must never affect
      // the already-successful product creation above.
      void recordProductHistoryEvent({ productId: id, eventType: 'product_created', metadata: { source } }).catch((err: any) => {
        console.error(`Product history: failed to record product_created for ${id}:`, err?.message ?? err)
      })
      return id
    })()

    serverProductPromises.current.set(product.id, promise)
    return promise
  }

  // Milestone 22 (Step C2) — best-effort persistence bookkeeping, never part
  // of the generation transaction itself. Fire-and-forget from the caller
  // (not awaited), matching the existing notifyCreditsChanged() pattern just
  // below it — a failure here must never turn an already-successful
  // generation into an error, retry, roll back local state, or affect
  // credits in any way. The two try/catches are separate on purpose so the
  // logged message always says which operation actually failed.
  async function persistGenerationToCatalog(
    product: DraftProduct,
    marketplace: Marketplace,
    shapedContent: unknown,
    meta: GenerationMeta | null
  ) {
    let serverId: string
    try {
      // By generation time a product has always already gone through one
      // of the three ensureServerProduct call sites in commitAddProduct/
      // commitCsvUpload — this call almost always just resolves the
      // already-in-flight/already-set serverId (see ensureServerProduct's
      // own early-return above). 'manual' is a defensive fallback for the
      // otherwise-unreachable case where it isn't, never a claim about how
      // this specific product was actually added.
      serverId = await ensureServerProduct(product, 'manual')
    } catch (err: any) {
      console.error(
        `Catalog persistence: failed to create/resolve catalog_products for draft product ${product.id}:`,
        err?.message ?? err
      )
      return
    }

    // Milestone C14 — captured BEFORE the upsert below, so a listing that
    // already existed for this (product, marketplace) pair is correctly
    // recorded as an edit, not a fresh generation.
    const hadExistingListing = !!product.listingServerIds?.[marketplace]

    try {
      const listing = await upsertListing(serverId, marketplace, {
        shaped_content: shapedContent,
        generation_meta: meta,
        generation_error: null
      })
      // Milestone 23 (Step C3) discovery: the returned row's own id was
      // previously discarded here — nothing recorded which catalog_listings
      // row corresponds to this (product, marketplace) pair, which made
      // approval/export persistence impossible (setApproval/recordExport
      // both need the listing's own id, never catalog_products.id). Storing
      // it is the minimal fix; nothing about upsertListing's own contract
      // changed.
      setDraftProducts((prev) =>
        prev.map((p) =>
          p.id === product.id ? { ...p, listingServerIds: { ...p.listingServerIds, [marketplace]: listing.id } } : p
        )
      )
      void recordProductHistoryEvent({
        productId: serverId,
        eventType: hadExistingListing ? 'listing_edited' : 'listing_generated',
        marketplace,
        listingId: listing.id
      }).catch((err: any) => {
        console.error(
          `Product history: failed to record ${hadExistingListing ? 'listing_edited' : 'listing_generated'} for ${serverId}:`,
          err?.message ?? err
        )
      })
    } catch (err: any) {
      console.error(
        `Catalog persistence: failed to upsert catalog_listings for product ${serverId} / ${marketplace}:`,
        err?.message ?? err
      )
    }
  }

  async function generateForProductMarketplace(
    product: DraftProduct,
    marketplace: Marketplace,
    runMarketplaces: Marketplace[],
    fieldGroup?: FieldGroup,
    // Bulk-batch-only context (product index/total among the products this
    // one Generate Listings run is processing) — purely for the loading
    // banner's "Analyzing product N of M" label. undefined for a single-row
    // retry/regenerate (runGeneration never passes it), which is exactly
    // when that label should omit the "N of M" clutter (requirement D).
    progressContext?: { productIndex: number; totalProducts: number }
  ): Promise<'success' | 'insufficient_credits' | 'error'> {
    try {
      // Loading-experience stage 2/4 ("Preparing Content"), set BEFORE
      // Product Intelligence is even awaited — stage 1 ("Analyzing
      // Product") is never stored here at all; it's derived at render time
      // from enrichingProductId, which ensureProductIntelligence's own call
      // to runProductIntelligenceAnalysis (unmodified) already sets/clears
      // around its real network request. That overlay is only ever active
      // for exactly the span of a genuine analysis: when intelligence was
      // already completed and reused, enrichingProductId never sets, so
      // the seller correctly sees "Preparing Content" immediately with no
      // fake "Analyzing" flash for work that didn't actually happen.
      setGenerationStage({
        phase: 'preparing',
        productId: product.id,
        productIndex: progressContext?.productIndex ?? null,
        totalProducts: progressContext?.totalProducts ?? null,
        marketplaceLabel: null
      })

      // Product Intelligence is the intelligence layer INSIDE generation —
      // ensured (reused if already completed, awaited if already in
      // flight, freshly run otherwise) before the prompt is built, for
      // every full generation. A field-scoped regenerate (Title/Bullets/
      // Description) never triggers a fresh analysis of its own: a full
      // generation has always already run at least once by the time one of
      // those buttons exists, so intelligence — if available at all — was
      // already ensured then; a field regenerate only reuses whatever's
      // already on the product, exactly as before.
      const intelligenceData = fieldGroup
        ? product.productIntelligence?.status === 'completed'
          ? product.productIntelligence.data
          : undefined
        : await ensureProductIntelligence(product)

      const imageBase64 = product.imageFile ? await fileToBase64(product.imageFile) : null

      // Stage 3/4 — about to send the actual marketplace generation
      // request; marketplaceLabel is what lets the banner say "Generating
      // Amazon listing..." rather than a generic "Generating...".
      setGenerationStage((prev) =>
        prev && prev.productId === product.id ? { ...prev, phase: 'generating', marketplaceLabel: MARKETPLACE_LABELS[marketplace] } : prev
      )

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
          fieldGroup,
          // Milestone 32 (C9) — omitted (undefined, dropped by
          // JSON.stringify) whenever no completed analysis is available
          // (guest, analysis failed, or genuinely nothing to analyze), so
          // the route's existing no-intelligence behavior is unchanged in
          // that case (C9-AC14).
          productIntelligence: intelligenceData ?? undefined
        })
      })
      const data = await res.json()

      if (res.ok) {
        // Stage 4/4 — the response has arrived; readiness/health for it
        // (lib/listingHealth.ts, computed from generatedContent/meta once
        // committed below) is what QueueTable's own badges already show as
        // the real result — this stage just names the real work happening
        // between "response received" and "state committed": merging the
        // field-scoped/full content and validation-relevant meta below.
        setGenerationStage((prev) => (prev && prev.productId === product.id ? { ...prev, phase: 'validating' } : prev))

        // Meta describes the fresh response's title specifically — only
        // trustworthy to record when the title actually changed (no
        // fieldGroup at all, i.e. entire listing, or fieldGroup === 'title').
        // Regenerating just the bullets/description leaves the existing
        // title (and therefore its existing meta) untouched.
        const updatesTitle = !fieldGroup || fieldGroup === 'title'

        // Milestone 25 — computed ONCE, here, as plain synchronous values,
        // not inside the setDraftProducts updater below. The previous
        // version captured these via `let` variables assigned inside that
        // updater and read immediately after the setDraftProducts(...)
        // call, on the assumption that React invokes a function updater
        // synchronously as part of that call — it doesn't; the updater only
        // runs once React actually processes the fiber's update queue
        // during render, which isn't guaranteed to have happened yet at
        // that point. Confirmed live in Milestone 24: catalog_listings.
        // shaped_content/generation_meta were always null in the database
        // despite the UI showing fully correct content.
        //
        // Using `product.generatedContent[marketplace]` (this function's
        // own parameter) as the field-scoped merge base instead of the
        // updater's `prev`/`p` is safe specifically because generation is
        // sequential and globally single-flight (see currentlyGenerating
        // above) — nothing else can have written to this exact (product,
        // marketplace) slot between when `product` was captured and this
        // response arriving, since this call IS that in-flight generation.
        // Every OTHER marketplace's data still comes from `p` inside the
        // updater below, unaffected by anything here.
        const existing = product.generatedContent[marketplace] ?? {}
        const keysToKeep = fieldGroup ? FIELD_GROUPS[marketplace][fieldGroup] : undefined
        const mergedContent = keysToKeep
          ? {
              ...existing,
              ...Object.fromEntries(keysToKeep.map((key) => [key, data.generatedContent[key]]))
            }
          : data.generatedContent

        // keywordsField only reflects reality when keywords were actually
        // part of this response — true for a full generation, NOT for a
        // title-only regenerate (there's no "Regenerate Keywords" button; a
        // title-only request's prompt never asks for keywordPool at all, so
        // the server's fresh meta would otherwise carry an empty/inert
        // keywordsField that could silently look "within limit" and
        // overwrite a previously real, possibly-failing one). Preserve the
        // existing value in that one case; every other case (full
        // regenerate, or the meta being left untouched entirely for
        // bullets/description-only requests below) already behaves
        // correctly untouched.
        const mergedMeta: GenerationMeta | null = updatesTitle
          ? {
              ...(data.meta ?? { titleFields: [], descriptionField: null, keywordsField: null, bulletCount: 0 }),
              keywordsField:
                fieldGroup === 'title'
                  ? product.generationMeta[marketplace]?.keywordsField ?? null
                  : data.meta?.keywordsField ?? null
            }
          : product.generationMeta[marketplace] ?? null

        setDraftProducts((prev) =>
          prev.map((p) => {
            if (p.id !== product.id) return p
            const generatedContent = { ...p.generatedContent, [marketplace]: mergedContent }
            const generationError = { ...p.generationError, [marketplace]: null }
            const generationMeta = updatesTitle ? { ...p.generationMeta, [marketplace]: mergedMeta } : p.generationMeta
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
        // Milestone 22 (Step C2) — fire-and-forget, same reasoning as
        // notifyCreditsChanged() just above: bookkeeping, not part of this
        // function's own success/failure contract. Guests are excluded here
        // (not just left to fail inside lib/catalog.ts's own session check)
        // so a guest generation never even attempts the network round-trip.
        if (hasSession) void persistGenerationToCatalog(product, marketplace, mergedContent, mergedMeta)
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

  // Milestone 23 (Step C3) — fire-and-forget, same philosophy as C2's
  // persistGenerationToCatalog. Requires both an authenticated session (only
  // signed-in users have catalog rows) and a resolved catalog_listings.id
  // for this exact (product, marketplace) pair — which only exists once
  // C2's generation dual-write has actually succeeded for it. Neither
  // condition being unmet is an error: it just means there is nothing to
  // persist yet (guest, or a listing that predates C2, or whose own C2
  // write failed) — skipped cleanly and logged, never inventing an id or
  // writing to an unrelated row.
  async function persistApprovalToCatalog(draftProductId: string, marketplace: Marketplace, approved: boolean) {
    if (!hasSession) return
    const product = draftProducts.find((p) => p.id === draftProductId)
    const listingId = product?.listingServerIds?.[marketplace]
    if (!listingId) {
      console.error(
        `Catalog persistence: skipped approval write for draft product ${draftProductId} / ${marketplace} — no persisted catalog_listings id yet.`
      )
      return
    }
    try {
      await setApproval(listingId, approved)
      void recordProductHistoryEvent({
        productId: product!.serverId!,
        eventType: approved ? 'listing_approved' : 'listing_rejected',
        marketplace,
        listingId
      }).catch((err: any) => {
        console.error(
          `Product history: failed to record ${approved ? 'listing_approved' : 'listing_rejected'} for ${listingId}:`,
          err?.message ?? err
        )
      })
    } catch (err: any) {
      console.error(
        `Catalog persistence: failed to upsert catalog_listing_approvals for listing ${listingId}:`,
        err?.message ?? err
      )
    }
  }

  function handleApproveMarketplace(id: string, marketplace: Marketplace) {
    setDraftProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, approved: { ...p.approved, [marketplace]: true } } : p))
    )
    void persistApprovalToCatalog(id, marketplace, true)
  }

  function handleUnapproveMarketplace(id: string, marketplace: Marketplace) {
    setDraftProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, approved: { ...p.approved, [marketplace]: false } } : p))
    )
    void persistApprovalToCatalog(id, marketplace, false)
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
  // Button-facing entry point: runs the existing sign-in/marketplace gates,
  // then opens the pre-download confirmation surface instead of downloading
  // immediately. performExport() below (called only from that modal's
  // "Export Listings" button) does the actual download — same gates,
  // same eligibility rule, just a confirmation step inserted between them.
  function handleOpenExportSummary() {
    if (!hasSession) {
      setShowExportGateModal(true)
      return
    }
    if (!requireMarketplace()) return
    setExportError(null)
    // Milestone C11 — null until the effect below computes it fresh for
    // this opening; the modal shows a brief "Checking marketplace
    // readiness…" state and keeps Export All Ready disabled until then
    // (§11/§21, C11-AC21/AC22).
    setExportReadiness(null)
    setExportSkipped(null)
    setShowExportSummary(true)
  }

  // Milestone C11 — computed once per modal opening, from whichever
  // marketplaces currently have at least one approved row (the same set
  // computeExportableCounts already surfaces). Pure, synchronous,
  // local-data-only — no network/AI call, so this always resolves on the
  // very next render after the modal opens; modeled as an effect (rather
  // than computed inline during render) specifically so the "checking"
  // state in the modal is a real, honest render frame and not a fabricated
  // spinner for work that already finished.
  useEffect(() => {
    if (!showExportSummary) return
    const marketplacesInPlay = computeExportableCounts(draftProducts).map((c) => c.marketplace)
    const results = marketplacesInPlay.map((m) =>
      evaluateMarketplaceExportReadiness(m, gatherExportCandidateItems(draftProducts, m))
    )
    setExportReadiness(results)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showExportSummary])

  // Milestone C11 — `marketplaces` is the READY subset from the readiness
  // gate (never the full SUPPORTED_MARKETPLACES list) — a NOT_READY or
  // MISSING_FIELDS marketplace's approved rows are simply never visited by
  // this loop, so they can't reach flattenRow/recordExport/the
  // queue-clearing logic below no matter what. This is the one and only
  // call site; there is no path that bypasses the gate.
  async function performExport(marketplaces: Marketplace[]) {
    // Every exported row is the seller's own raw input (Original Brand/
    // Category/Description/Image — untouched by generation, see
    // buildRawColumnsRow) merged with that marketplace's AI-generated
    // columns, each renamed to its "Generated *" label (generatedColumnLabels)
    // so the two are never ambiguous side by side in a spreadsheet. Raw
    // columns always come first (object key order = column order below).
    // flattenRow/exportColumns themselves are untouched — this only adds a
    // layer on top, so the marketplace-specific generated shape (and every
    // existing test/adapter built on flattenRow) is unaffected.
    const flattenedRows: { id: string; marketplace: Marketplace; row: Record<string, string> }[] = []
    for (const p of draftProducts) {
      for (const marketplace of marketplaces) {
        if (!p.approved[marketplace]) continue
        const generated = flattenRow(marketplace, p.generatedContent[marketplace])
        if (!generated) continue
        const labels = generatedColumnLabels[marketplace] ?? {}
        const labeledGenerated = Object.fromEntries(Object.entries(generated).map(([key, value]) => [labels[key] ?? key, value]))
        const row = { ...buildRawColumnsRow(p), ...labeledGenerated }
        flattenedRows.push({ id: p.id, marketplace, row })
      }
    }

    if (flattenedRows.length === 0) {
      setExportError('No approved listings have a supported export shape for their marketplace.')
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
          // Column order matches how each row was built above: raw input
          // first (RAW_COLUMNS), then this marketplace's generated columns
          // under their "Generated *" labels — never the raw exportColumns
          // keys directly, since the row itself was already relabeled.
          UTF8_BOM +
            Papa.unparse(rows, {
              columns: [...RAW_COLUMNS, ...exportColumns[marketplace].map((key) => generatedColumnLabels[marketplace][key])]
            })
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

      // Milestone 23 (Step C3) — one recordExport() per marketplace batch
      // actually downloaded above, fire-and-forget (never awaited into the
      // download path). Only rows with an already-resolved
      // catalog_listings.id are included; a row whose C2 write never
      // succeeded (guest-era draft, failed dual-write) is excluded rather
      // than given a fabricated id, and a marketplace batch left with zero
      // persisted ids after that filtering is skipped entirely — never an
      // empty recordExport() call. The CSV/ZIP above has already downloaded
      // by this point regardless of any of this.
      if (hasSession) {
        for (const [marketplace, rows] of rowsByMarketplace) {
          const listingIds: string[] = []
          for (const r of flattenedRows) {
            if (r.marketplace !== marketplace) continue
            const listingId = draftProducts.find((p) => p.id === r.id)?.listingServerIds?.[marketplace]
            if (listingId) {
              listingIds.push(listingId)
            } else {
              console.error(
                `Catalog persistence: export of ${marketplace} includes draft product ${r.id} with no persisted catalog_listings id — excluded from the catalog export record.`
              )
            }
          }

          if (listingIds.length === 0) {
            console.error(
              `Catalog persistence: skipped recordExport for ${marketplace} — no persisted listing ids among the ${rows.length} exported row(s).`
            )
            continue
          }

          // Milestone C14 — one 'exported' event per actually-exported
          // product for this marketplace, only after recordExport's own
          // write resolves, carrying that same export row's id so the
          // timeline can point back to the real C7 export record rather
          // than a second, disconnected one.
          void recordExport(marketplace, listingIds, `${marketplace}-listings.csv`)
            .then((exportRow) => {
              for (const r of flattenedRows) {
                if (r.marketplace !== marketplace) continue
                const exportedProduct = draftProducts.find((p) => p.id === r.id)
                if (!exportedProduct?.serverId) continue
                void recordProductHistoryEvent({
                  productId: exportedProduct.serverId,
                  eventType: 'exported',
                  marketplace,
                  metadata: { export_id: exportRow.id }
                }).catch((err: any) => {
                  console.error(`Product history: failed to record exported for ${exportedProduct.serverId}:`, err?.message ?? err)
                })
              }
            })
            .catch((err: any) => {
              console.error(`Catalog persistence: failed to record export for ${marketplace}:`, err?.message ?? err)
            })
        }
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
      // Milestone C11 — everything the readiness gate excluded from THIS
      // export, with its actual reason (first issue's message, matching
      // what the gate showed before the user clicked Export All Ready) —
      // not a generic "some marketplaces were skipped."
      const skipped = (exportReadiness ?? [])
        .filter((r) => r.status !== 'READY')
        .map((r) => ({ marketplace: r.marketplace, reason: r.issues[0]?.message ?? 'not ready' }))
      setExportSkipped(skipped.length > 0 ? skipped : null)
      setShowExportSummary(false)
    } catch {
      setExportError('Export failed - approved listings were not cleared. Please try again.')
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

  // Derived, not raw state: an explicit stored choice (see the mount-time
  // effect above) always wins; with no explicit choice yet, falls back to
  // "expanded while the queue is empty, collapsed once a product exists."
  const addProductsCollapsed = addProductsCollapsedPreference !== null ? addProductsCollapsedPreference : draftProducts.length > 0

  function toggleAddProductsCollapsed() {
    const next = !addProductsCollapsed
    setAddProductsCollapsedPreference(next)
    localStorage.setItem(ADD_PRODUCTS_COLLAPSE_STORAGE_KEY, String(next))
  }

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
              collapsed={addProductsCollapsed}
              onToggleCollapsed={toggleAddProductsCollapsed}
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
              manualImages={manualImages}
              onAddManualImages={handleAddManualImages}
              onRemoveManualImage={handleRemoveManualImage}
              onMoveManualImage={handleMoveManualImage}
              manualImageInputRef={manualImageInputRef}
              formError={formError}
              guestLimitReached={guestLimitReached}
              brandMismatchPending={brandMismatchPending}
              selectedClient={selectedClient}
              pendingImageUrls={pendingImageUrls}
              // Only reachable from Manual Entry's brand-mismatch resolution
              // (LeftPanel — Photos Only has no mismatch gate, CSV has its
              // own separate commitCsvUpload/onCsvAddOnlyMatching path), so
              // 'manual' is always the correct source here.
              onCommitAddProduct={(skipBrandVoice, uploadedImageUrls) => commitAddProduct(skipBrandVoice, uploadedImageUrls, undefined, 'manual')}
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
            onSelectClient={handleSelectClient}
            onOpenBrandProfile={() => setShowBrandProfile(true)}
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

          {/* Generate Listings loading experience — lives here (the
              Listings column itself), not inside GeneratedListingDrawer, so
              it's visible with the drawer closed the entire time (the
              normal case for a bulk run: nothing opens the drawer
              automatically). generationStage only ever holds real,
              already-reached states (see its own declaration above) — never
              a timer-driven guess — so this banner always describes
              whatever generateForProductMarketplace/ensureProductIntelligence
              are actually doing right now. */}
          {generationStage && (
            <div
              className={`mb-4 flex items-center justify-between gap-4 p-4 rounded-xl border ${
                generationStage.phase === 'failed'
                  ? dangerBannerClass
                  : generationStage.phase === 'complete'
                    ? 'border-[var(--success-border)] bg-[var(--success-bg)]'
                    : 'border-[var(--card-border)] bg-[var(--card-bg)]'
              }`}
            >
              <div className="flex items-center gap-3">
                {generationStage.phase !== 'complete' && generationStage.phase !== 'failed' && (
                  <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse shrink-0" aria-hidden="true" />
                )}
                <p
                  className={`text-sm font-medium ${
                    generationStage.phase === 'failed'
                      ? dangerTextClass
                      : generationStage.phase === 'complete'
                        ? 'text-[var(--success-text)]'
                        : 'text-[var(--heading-text)]'
                  }`}
                >
                  {describeGenerationStage(generationStage, enrichingProductId)}
                </p>
              </div>
              {/* Only the two terminal states get a dismiss control — the
                  in-flight ones are already transient by construction (the
                  next real transition overwrites them) and clearing them
                  early would just leave the banner blank mid-generation. */}
              {(generationStage.phase === 'complete' || generationStage.phase === 'failed') && (
                <button onClick={() => setGenerationStage(null)} className={linkButtonClass}>
                  Dismiss
                </button>
              )}
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

          {deleteError && (
            <div className={`mb-4 flex items-center justify-between gap-4 ${dangerBannerClass}`}>
              <p className={dangerTextClass}>{deleteError}</p>
              <button onClick={() => setDeleteError(null)} className={buttonSecondaryClass}>
                Dismiss
              </button>
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

          {/* Milestone C11 — which marketplaces the readiness gate excluded
              from the export the banner above just reported, and the real
              reason for each (never a generic "skipped some marketplaces"). */}
          {exportSkipped && exportSkipped.length > 0 && (
            <div className={`mb-4 ${warningBannerClass}`}>
              <p className={`${warningTextClass} font-medium mb-1`}>Skipped (not ready):</p>
              <ul className="list-disc list-inside">
                {exportSkipped.map(({ marketplace, reason }) => (
                  <li key={marketplace} className={warningTextClass}>
                    {MARKETPLACE_LABELS[marketplace]} — {reason}
                  </li>
                ))}
              </ul>
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
                  onDownloadApproved={handleOpenExportSummary}
                  onView={(id, marketplace) => setViewingTarget({ productId: id, marketplace })}
                  onEdit={handleEditProduct}
                  onDelete={handleDeleteProduct}
                  onRetry={handleRetryProductMarketplace}
                  onClearAll={() => setShowClearAllConfirm(true)}
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
          isAnalyzing={enrichingProductId === viewingProduct.id}
          onClose={() => setViewingTarget(null)}
          onApproveMarketplace={handleApproveMarketplace}
          onUnapproveMarketplace={handleUnapproveMarketplace}
          onRetryMarketplace={handleRetryProductMarketplace}
          onRegenerateField={handleRegenerateField}
          onAnalyzeProduct={handleAnalyzeProduct}
        />
      )}

      {showBrandProfile && selectedClient && (
        <BrandProfileModal
          brand={selectedClient}
          onClose={() => setShowBrandProfile(false)}
          onSaved={(updated) => {
            // Milestone C12 — keeps this session's selectedClient (used
            // directly as brandGuidelines in generation, see
            // generateForProductMarketplace) in sync with the just-saved
            // profile, without requiring a reload.
            setSelectedClient(updated)
          }}
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
      {showClearAllConfirm && (
        <ClearAllConfirmModal
          count={listingSummary.total}
          clearing={clearingAll}
          onCancel={() => setShowClearAllConfirm(false)}
          onConfirm={handleClearAll}
        />
      )}
      {showExportSummary && (
        <ExportSummaryModal
          exportableCounts={computeExportableCounts(draftProducts)}
          summary={listingSummary}
          exportError={exportError}
          readiness={exportReadiness}
          onClose={() => {
            setShowExportSummary(false)
            setExportError(null)
          }}
          onConfirmReady={(marketplaces) => performExport(marketplaces)}
        />
      )}
    </div>
  )
}
