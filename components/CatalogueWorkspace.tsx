"use client"

import { useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from 'react'
import Papa from 'papaparse'
import JSZip from 'jszip'
import { pick } from '@/lib/csvMapping'
import { exportColumns, flattenRow } from '@/lib/exportShapers'
import { type Client } from '@/components/ClientSelector'
import BrandProfileModal from '@/components/BrandProfileModal'
import StatusBadge from '@/components/StatusBadge'
import ProductThumbnail from '@/components/ProductThumbnail'
import AppHeader from '@/components/AppHeader'
import TopHeader from '@/components/TopHeader'
import LeftPanel from '@/components/workspace/LeftPanel'
import ImageOnlyPanel from '@/components/workspace/ImageOnlyPanel'
import AppSidebar, { type WorkspaceDestination } from '@/components/AppSidebar'
import QueueTable from '@/components/workspace/QueueTable'
import CatalogFilterBar from '@/components/workspace/CatalogFilterBar'
import BulkActionBar from '@/components/workspace/BulkActionBar'
import ListingHealthBadge from '@/components/workspace/ListingHealthBadge'
import { marketplaceChipFor, explainMissing, CHIP_TONE_CLASS } from '@/components/workspace/humanCopy'
import { computeListingHealth, FIELD_SPECS, type GenerationMeta } from '@/lib/listingHealth'
import { createClient } from '@/lib/supabase/client'
import { recordProductHistoryEvent } from '@/lib/productHistory'
import ProductHistory from '@/components/ProductHistory'
import { reconcileCatalog } from '@/lib/catalogReconciliation'
import { getCatalog, createProduct, upsertListing, setApproval, deleteProduct, recordExport, updateProduct } from '@/lib/catalog'
import { PRODUCT_INTELLIGENCE_FIELD_KEYS, type ProductIntelligence, type ProductIntelligenceFieldKey } from '@/lib/productIntelligence'
import { evaluateMarketplaceExportReadiness, readyMarketplaces, type MarketplaceExportReadiness, type ExportCandidateItem } from '@/lib/exportReadiness'
import {
  computeNeedsAttention,
  filterProducts,
  sortProducts,
  getAvailableBrands,
  getAvailableCategories,
  gatherExportCandidateItems,
  DEFAULT_PRODUCT_FILTERS,
  type ProductFilters,
  type ProductSortKey
} from '@/lib/catalogOperations'
// Milestone C17 — ActionCenter.tsx (the global "N actions need attention"
// card-stack) is no longer mounted here; the recommendation engine it was
// built on stays in active use, surfaced per-product instead (see
// QueueTable's own `recommendations` prop and handleExecuteRecommendation
// below).
import { computeCatalogRecommendations, type CatalogActionRecommendation } from '@/lib/catalogRecommendations'
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
// Milestone C17 — the plain-language labels for these are now defined once,
// in components/workspace/CatalogFilterBar.tsx's own STATUS_OPTIONS
// (the only place this filter's UI renders since the Action Center's
// removal from the primary experience).

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

// Milestone C15 — gatherExportCandidateItems moved to lib/catalogOperations.ts
// (imported below) so lib/catalogRecommendations.ts can reuse the exact same
// function instead of re-deriving the same approved[marketplace] mapping.

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
  onAnalyzeProduct,
  onSwitchMarketplace
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
  // Milestone C14 — "marketplace status view": lets the seller jump between
  // this product's other marketplaces without closing/reopening the drawer
  // from a different table row. Purely a navigation convenience — reuses
  // the exact same computeListingHealth call every other status chip in
  // this file already uses, never a new judgment about readiness.
  onSwitchMarketplace: (marketplace: Marketplace) => void
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
        {/* Milestone C17 — "Product Studio": the drawer is where the seller
            goes deep on one product — what Tesolute understands about it,
            its marketplace-ready content, and what's left to do. The old
            draft/partial/generated progress badge is dropped here (that's
            an internal generation-progress concept, not a seller-facing
            one) in favor of the per-marketplace chips just below, which
            already say more useful things in plain language. */}
        <div className="mb-4">
          <h2 className={sectionHeadingClass}>Product Studio</h2>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <ProductThumbnail imageFile={product.imageFile} imageUrl={product.imageUrl} alt={product.brandName} size={60} />
          <div>
            <p className="font-medium text-[var(--heading-text)]">{product.brandName}</p>
            <p className="text-sm text-[var(--muted-text)]">{product.category}</p>
          </div>
        </div>

        {/* Milestone C14 — marketplace status view / quick switch: every
            marketplace this product could target, so the seller can see
            (and jump to) the whole picture without leaving the drawer.
            Milestone C17 — the color AND label now come from the same
            plain-language humanCopy translation the product cards use
            (marketplaceChipFor), never the raw ready/needs-review/
            missing-data/error vocabulary. */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {SUPPORTED_MARKETPLACES.map((m) => {
            const mContent = product.generatedContent[m]
            const mError = product.generationError[m]
            const attempted = mContent !== null || mError !== null
            const mHealth = attempted ? computeListingHealth(m, mContent, mError, product.generationMeta[m]) : null
            const chip = marketplaceChipFor(attempted, mHealth)
            const isActive = m === marketplace
            return (
              <button
                key={m}
                type="button"
                onClick={() => onSwitchMarketplace(m)}
                aria-current={isActive}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${CHIP_TONE_CLASS[chip.tone]} ${
                  isActive ? 'ring-2 ring-blue-500' : 'opacity-75 hover:opacity-100'
                }`}
              >
                {MARKETPLACE_LABELS[m]} · {chip.label}
              </button>
            )
          })}
        </div>

        {/* Milestone C17 — "What Tesolute Understands." Same C9
            product_intelligence data, C14 visualAttributes, and the
            seller's own typed-in fields as before — reorganized so the
            seller can tell CONFIRMED (their own input) from OBSERVED
            (detected in their photo) from INFERRED (the AI's own
            reasoning, never presented as settled fact) at a glance, per
            the explicit "never present an uncertain AI inference as a
            confirmed product fact" requirement. */}
        <div className="mb-4 pb-4 border-b border-[var(--card-border)]">
          <p className={`${labelClass} mb-2`}>What Tesolute Understands</p>

          {/* Confirmed — verbatim from the seller's own form fields, never
              re-derived. */}
          {(product.brandName || product.category || product.description) && (
            <div className="mb-3">
              <p className="text-xs font-medium text-[var(--success-text)] mb-1">✓ Confirmed by you</p>
              <div className="flex flex-col gap-0.5">
                {product.brandName && (
                  <p className="text-sm text-[var(--body-text)]">
                    <span className="text-[var(--muted-text)]">Brand: </span>
                    {product.brandName}
                  </p>
                )}
                {product.category && (
                  <p className="text-sm text-[var(--body-text)]">
                    <span className="text-[var(--muted-text)]">Category: </span>
                    {product.category}
                  </p>
                )}
                {product.description && (
                  <p className="text-sm text-[var(--body-text)]">
                    <span className="text-[var(--muted-text)]">Description: </span>
                    {product.description}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium text-[var(--accent-sky-text)]">Inferred by Tesolute</p>
            <button
              onClick={() => onAnalyzeProduct(product.id)}
              disabled={isAnalyzing || !product.serverId}
              title={!product.serverId ? 'Product is still being saved — try again in a moment' : undefined}
              className={buttonSecondarySmallClass}
            >
              {isAnalyzing
                ? 'Analyzing…'
                : product.productIntelligence?.status === 'completed'
                  ? 'Re-analyze'
                  : product.productIntelligence?.status === 'failed'
                    ? 'Retry Analysis'
                    : 'Analyze Product'}
            </button>
          </div>

          {(!product.productIntelligence || product.productIntelligence.status === 'not_started') && !isAnalyzing && (
            <p className="text-xs text-[var(--muted-text)]">Not analyzed yet — Tesolute hasn't looked at this product closely.</p>
          )}

          {product.productIntelligence?.status === 'failed' && (
            <p className="text-xs text-[var(--danger-text)]">
              Analysis failed{product.productIntelligence.error ? `: ${product.productIntelligence.error}` : '.'}
            </p>
          )}

          {product.productIntelligence?.data && (
            <div className="mt-1 flex flex-col gap-1">
              {/* Every inferred fact is explicitly framed as AI reasoning
                  with its own confidence, never stated as settled — a
                  "low"/"unknown" confidence gets an extra nudge to verify
                  before publishing, exactly per spec. */}
              {PRODUCT_INTELLIGENCE_FIELD_KEYS.map((key) => {
                const field = product.productIntelligence!.data![key]
                if (field.value == null || (Array.isArray(field.value) && field.value.length === 0)) return null
                const needsVerification = field.confidence === 'low' || field.confidence === 'unknown'
                return (
                  <p key={key} className="text-sm text-[var(--body-text)]">
                    <span className="text-[var(--muted-text)]">{INTELLIGENCE_FIELD_LABELS[key]}: </span>
                    {formatIntelligenceValue(field.value)}
                    <span className={`text-xs ${needsVerification ? 'text-[var(--warn-text)]' : 'text-[var(--muted-text)]'}`}>
                      {' '}
                      ({needsVerification ? 'unverified — worth checking' : `${field.confidence} confidence`})
                    </span>
                  </p>
                )
              })}

              {product.productIntelligence.missing_information.length > 0 && (
                <div className={`mt-2 ${warningBannerClass}`}>
                  <p className={`${warningTextClass} font-medium mb-1`}>Tesolute needs more to work with:</p>
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
            <p className="text-xs font-medium text-[var(--accent-sky-text)] mb-1">Observed in your photo</p>
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

            // Milestone C17 — the plain-language line every field-level
            // annotation below already backs up with real detail; never a
            // second, independent judgment about this listing's status.
            const humanStatusLine = !isGenerating && (content || error) ? explainMissing(MARKETPLACE_LABELS[marketplace], health) : null

            return (
              <div key={marketplace} className="pt-4 border-t border-[var(--card-border)] first:pt-0 first:border-t-0">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-[var(--heading-text)]">{MARKETPLACE_LABELS[marketplace]}</h3>
                  <div className="flex items-center gap-2">
                    {isApproved && <StatusBadge status="approved" />}
                    {(content || error) && <ListingHealthBadge status={isGenerating ? 'generating' : health.status} />}
                  </div>
                </div>
                {!isGenerating && content && !error && (
                  <p className={`mb-2 text-sm ${humanStatusLine ? 'text-[var(--warn-text)]' : 'text-[var(--success-text)]'}`}>
                    {humanStatusLine ?? `Your ${MARKETPLACE_LABELS[marketplace]} content is complete.`}
                  </p>
                )}

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
// unchanged from Milestone 1's tab-strip. Milestone C17 — no longer a
// permanent sidebar column: mounted inline inside the create hero only
// while it's expanded (see CatalogueWorkspace's showCreatePanel state).
// None of LeftPanel/ImageOnlyPanel's own props, fields, or submit logic
// changed, only where and how this whole block is framed.
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
    // Milestone C17 — a plain full-width card now, mounted inline within
    // the create hero rather than a permanent sidebar column (the old
    // lg→xl breakpoint tuning from C16 no longer applies since this never
    // competes for row width with anything anymore).
    // Milestone C17 — max-w-2xl (not the full hero-card width): a focused
    // creation task reads better as a centered ~672px form than a
    // full-bleed field stretching the entire workspace width.
    <aside id="add-products-panel" className={`w-full max-w-2xl mx-auto p-6 ${cardClass}`}>
      <h2 className={sectionHeadingClass}>Add Products</h2>
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
function WorkspaceEmptyState({ onOpenCreate }: { onOpenCreate: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className={`flex flex-col items-center text-center gap-2 px-8 py-8 max-w-sm ${cardClass}`}>
        <p className={sectionHeadingClass}>Your products will show up here</p>
        <p className={bodyTextClass}>Give Tesolute a product to work with and it'll show up here, ready to review.</p>
        <button onClick={onOpenCreate} className={`mt-2 ${buttonPrimaryClass}`}>
          + Create your first listing
        </button>
      </div>
    </div>
  )
}

export default function CatalogueWorkspace() {
  // Global/session-scoped, same as the old single-value dropdown — not
  // frozen onto individual products at add time. Every batch generation
  // path (runGenerationBatch, driven by handleBulkGenerateSelected) reads
  // whatever's currently selected here, applied to every product it
  // touches in that run.
  const [selectedMarketplaces, setSelectedMarketplaces] = useState<Marketplace[]>([])
  const [draftProducts, setDraftProducts] = useState<DraftProduct[]>([])
  const [activeTab, setActiveTab] = useState<WorkspaceDestination>('manual')
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>('all')
  // Milestone C14 — Catalog Command Center: product-level search/filter/sort
  // (display-only, same "narrows the view, never what bulk actions read"
  // rule readinessFilter above already established) and bulk-selection
  // state. selectedProductIds is product-granularity (one checkbox per
  // product row-group in QueueTable), not per (product, marketplace) row.
  const [catalogFilters, setCatalogFilters] = useState<ProductFilters>(DEFAULT_PRODUCT_FILTERS)
  const [sortKey, setSortKey] = useState<ProductSortKey>('newest')
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set())
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgressLabel, setBulkProgressLabel] = useState<string | null>(null)
  // Milestone C14 — when set, Export All Ready (opened from BulkActionBar's
  // "Export Selected") is scoped to exactly these product ids instead of
  // every approved row in the workspace; null (the default, and what the
  // header's own "Export Listings" button always uses) means unscoped,
  // exactly today's C11 behavior.
  const [exportScopeIds, setExportScopeIds] = useState<Set<string> | null>(null)
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
  // Milestone C17 (corrected) — the create panel now starts COLLAPSED,
  // always. A previous pass had it auto-expanded by default, which is
  // exactly the "form inside form" / "already-expanded giant form"
  // complaint this correction fixes: the workspace should open calm, with
  // one obvious entry point, never a form the seller didn't ask for yet.
  // `createIntent` only changes the hint copy shown above the (100%
  // unchanged) existing AddProductsPanel form — "Create" and "Improve" are
  // two framings of the exact same commitAddProduct pipeline, never two
  // separate code paths. Bulk Upload is reached from WITHIN the opened
  // panel via its own existing tab strip (see ADD_METHOD_TABS) — it is an
  // INPUT METHOD inside the one Create Product flow, not a third
  // competing top-level entry point.
  const [showCreatePanel, setShowCreatePanel] = useState(false)
  const [createIntent, setCreateIntent] = useState<'create' | 'improve'>('create')

  function openCreatePanel(intent: 'create' | 'improve') {
    setCreateIntent(intent)
    setActiveTab('manual')
    setShowCreatePanel(true)
  }
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
  // Milestone 32 (C9) — client-side single-flight guard, same purpose as
  // currentlyGenerating above: disables the "Analyze Product" button for the
  // one product currently being enriched, so a double-click can't fire two
  // concurrent requests for the same product from this tab. The server route
  // has its own independent 'processing'-status check for the same reason
  // (a second tab/device, or a request that outlives this component).
  const [enrichingProductId, setEnrichingProductId] = useState<string | null>(null)
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
  // Milestone C17 — surfaced only when a server-side delete genuinely
  // fails (see handleDeleteProduct below); a product is never removed from
  // local state until the server confirms the delete, so this is the one
  // and only case where a delete attempt visibly doesn't "stick."
  const [deleteError, setDeleteError] = useState<string | null>(null)
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
    // relevant to generation (see requireMarketplace()). A product can
    // exist in the catalog before any marketplace has
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
    commitAddProduct(true, uploadedImageUrl, '', 'photo')
  }

  function commitAddProduct(
    skipBrandVoice: boolean,
    uploadedImageUrl: string | null,
    descriptionOverride?: string,
    // Milestone C14 — which create-panel tab this product actually came
    // from, threaded through to ensureServerProduct so product_created's
    // metadata.source is a real fact, not a guess. Defaults to 'manual'
    // since that covers both handleAddProduct's own call and the
    // mismatch-confirm callback AddProductsPanel invokes through the
    // onCommitAddProduct prop (2-arg signature, unchanged by this
    // milestone) — both are the manual-entry tab either way.
    source: 'manual' | 'photo' = 'manual'
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
                ...(uploadedImageUrl ? { imageFile: null, imageUrl: uploadedImageUrl } : {})
              }
            : p
        )
      )
      // Milestone C14 — persists the edit server-side (lib/catalog.ts's new,
      // additive updateProduct — see that file's own comment for why it
      // didn't exist before this milestone) and records product_updated
      // only once that write actually succeeds. Same fire-and-forget,
      // best-effort convention as every other catalog-persistence call in
      // this file: never blocks the local edit, never surfaces as a
      // user-facing error, and is skipped entirely for a product with no
      // serverId yet (nothing persisted to update) or no session (guest).
      if (hasSession && existing?.serverId) {
        const serverId = existing.serverId
        void updateProduct(serverId, {
          brand_name: brandName || null,
          description: effectiveDescription || null,
          category: category || null,
          ...(uploadedImageUrl ? { image_url: uploadedImageUrl } : {})
        })
          .then(() => recordProductHistoryEvent({ productId: serverId, eventType: 'product_updated' }))
          .catch((err: any) => {
            console.error(`Catalog persistence: failed to update catalog_products ${serverId}:`, err?.message ?? err)
          })
      }
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
      skipBrandVoice,
      // Milestone C17 — identical expression to ensureServerProduct's own
      // client_id, computed here too so "My Products" can scope to the
      // active brand immediately, without waiting on a server round-trip.
      clientId: skipBrandVoice ? null : selectedClient?.id ?? null
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
    setBrandMismatchPending(false)
    setPendingImageUrl(null)
    // Milestone C17 — collapse the creation panel and bring the seller's
    // attention back to their product library once a product has actually
    // been added, instead of leaving them stranded above/below an
    // already-done form (the CSV bulk-import path has its own separate
    // commitCsvUpload and is intentionally unaffected — adding many
    // products at once shouldn't auto-close mid-batch).
    setShowCreatePanel(false)
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
    // Milestone C17 — the create panel is collapsed by default now, so
    // editing an existing product must explicitly reopen it (on Manual
    // Entry, with the pre-filled form) rather than assuming it's already
    // on screen.
    setActiveTab('manual')
    setCreateIntent('create')
    setShowCreatePanel(true)
  }

  // Milestone C17 — fixes the confirmed delete-doesn't-persist bug: this
  // used to only ever call setDraftProducts, never any server call, so the
  // next reconcileCatalog (on reload) pulled the still-present row straight
  // back in. Now the local removal only ever happens AFTER lib/catalog.ts's
  // deleteProduct() confirms the row is actually gone (RLS-owner-scoped,
  // cascades to catalog_listings/catalog_listing_approvals) — a failed
  // server delete leaves the product visibly in place with deleteError set,
  // rather than silently showing a "deleted" state that isn't real.
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
        skipBrandVoice: false,
        // Milestone C17 — same brand association a CSV row's own
        // ensureServerProduct call already sends server-side.
        clientId: selectedClient?.id ?? null
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
      skipBrandVoice: true,
      clientId: null
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
  // Milestone C14 — the shared batch-generation loop (same credit-stop
  // semantics either way), used by BOTH handleGenerateAll (the whole
  // current batch, zero selection needed) and handleBulkGenerateSelected
  // (a selected subset) — see computeProductStatus above for why
  // runMarketplaces must stay fixed for the whole run rather than
  // re-reading live state.
  async function runGenerationBatch(products: DraftProduct[], runMarketplaces: Marketplace[]) {
    if (products.length === 0) return

    setGenerating(true)
    setCreditsStoppedInfo(null)

    const totalPairs = products.length * runMarketplaces.length
    // completedPairs = attempts made so far, for the "attempt N of totalPairs"
    // progress indicator. succeededPairs = attempts that actually generated
    // content — a distinct count, since the one that trips
    // 'insufficient_credits' increments completedPairs but produced nothing,
    // and the stopped-banner needs to report real completions, not attempts.
    let completedPairs = 0
    let succeededPairs = 0

    outer: for (const product of products) {
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

  // Milestone C17 (corrected) — restored as the PRIMARY, zero-selection
  // generation action: "selection is not the primary workflow" — a seller
  // who just added N products wants Tesolute to work on all of them, not
  // to select each one first. Operates on every current-batch draft
  // product (status === 'draft'); handleBulkGenerateSelected (below)
  // remains available as the secondary, selection-scoped variant for
  // narrowing to a subset.
  async function handleGenerateAll() {
    if (selectedMarketplaces.length === 0) {
      flagMissingMarketplace()
      return
    }
    const pending = draftProducts.filter((p) => p.status === 'draft')
    if (pending.length === 0) return
    await runGenerationBatch(pending, selectedMarketplaces)
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

  // Milestone 32 (C9) — "Analyze Product" in the review drawer. Requires
  // serverId (a catalog_products row must already exist — true for every
  // authenticated add since C8's eager creation, never true for a guest,
  // matching the fact that the enrichment API operates on a persisted row
  // and derives ownership from the session, not from anything in this
  // request body). Does not block or affect generation in any way if it
  // fails — errors are surfaced via draftProducts' own productIntelligence
  // status field (rendered in the drawer), never a thrown/alerted error.
  async function handleAnalyzeProduct(id: string) {
    const product = draftProducts.find((p) => p.id === id)
    if (!product?.serverId || enrichingProductId) return

    setEnrichingProductId(id)
    try {
      const res = await fetch('/api/enrich-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.serverId })
      })
      const data = await res.json().catch(() => null)
      const intelligence: ProductIntelligence | undefined = data?.productIntelligence
      if (intelligence) {
        setDraftProducts((prev) => prev.map((p) => (p.id === id ? { ...p, productIntelligence: intelligence } : p)))
      } else if (!res.ok) {
        console.error(`Product intelligence: enrichment request failed for product ${id}:`, data?.error ?? res.status)
      }
    } catch (err: any) {
      console.error(`Product intelligence: enrichment request failed for product ${id}:`, err?.message ?? err)
    } finally {
      setEnrichingProductId(null)
    }
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
  async function ensureServerProduct(
    product: DraftProduct,
    // Milestone C14 — only ever meaningful the one time this function
    // actually calls createProduct (see below); ignored on every other
    // path (early serverId return, in-flight-promise reuse), which is
    // exactly why product_created can never double-fire for one product —
    // those are the same two guards that already prevented a duplicate
    // createProduct call.
    source: 'manual' | 'csv' | 'photo' = 'manual'
  ): Promise<string> {
    if (product.serverId) return product.serverId

    const existing = serverProductPromises.current.get(product.id)
    if (existing) return existing

    const promise = (async () => {
      const id = await createProduct({
        brand_name: product.brandName || null,
        description: product.description || null,
        category: product.category || null,
        image_url: product.imageUrl || null,
        client_id: product.skipBrandVoice ? null : selectedClient?.id ?? null
      })
      setDraftProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, serverId: id } : p)))
      // Milestone C14 — fire-and-forget, same convention as every other
      // catalog-persistence call below: product creation has already fully
      // succeeded by this point (id is real), so a history-recording
      // failure must never be treated as a creation failure.
      void recordProductHistoryEvent({ productId: id, eventType: 'product_created', metadata: { source } }).catch(
        (err: any) => {
          console.error(`Product history: failed to record product_created for ${id}:`, err?.message ?? err)
        }
      )
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
      serverId = await ensureServerProduct(product)
    } catch (err: any) {
      console.error(
        `Catalog persistence: failed to create/resolve catalog_products for draft product ${product.id}:`,
        err?.message ?? err
      )
      return
    }

    // Milestone C14 — captured BEFORE the upsert below, from the caller's
    // own snapshot: a marketplace that already had a persisted
    // catalog_listings row means this call is regenerating/overwriting
    // existing content (listing_edited); no prior row means this is the
    // first successful generation for this (product, marketplace) pair
    // (listing_generated). upsertListing itself can't tell these apart —
    // it's the same upsert either way — so the distinction is made here,
    // the one place that already knows the "before" state.
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
      // Milestone C14 — fire-and-forget, same convention as every other
      // catalog-persistence call in this function: the listing write above
      // has already fully succeeded by this point, so a history-recording
      // failure must never be treated as a generation failure.
      void recordProductHistoryEvent({
        productId: serverId,
        eventType: hadExistingListing ? 'listing_edited' : 'listing_generated',
        marketplace,
        listingId: listing.id
      }).catch((err: any) => {
        console.error(`Product history: failed to record listing event for ${serverId}/${marketplace}:`, err?.message ?? err)
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
          fieldGroup,
          // Milestone 32 (C9) — only ever sent when a completed analysis
          // exists; omitted (undefined, dropped by JSON.stringify) for
          // 'not_started'/'processing'/'failed' or when the product has
          // never been analyzed at all, so the route's existing behavior is
          // completely unchanged whenever intelligence isn't available
          // (C9-AC14).
          productIntelligence: product.productIntelligence?.status === 'completed' ? product.productIntelligence.data : undefined
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
      // Milestone C14 — this codebase's approval workflow is a single
      // boolean toggle (approved/unapproved), not a separate reject
      // action, so "unapprove" is what maps to listing_rejected here —
      // same existing workflow, no second approval mechanism, just the
      // two event types the toggle's two states already correspond to.
      // Fire-and-forget, same convention as every other catalog-
      // persistence call: the approval write above already succeeded, so
      // a history-recording failure must never be treated as an approval
      // failure.
      if (product?.serverId) {
        void recordProductHistoryEvent({
          productId: product.serverId,
          eventType: approved ? 'listing_approved' : 'listing_rejected',
          marketplace,
          listingId
        }).catch((err: any) => {
          console.error(`Product history: failed to record approval event for listing ${listingId}:`, err?.message ?? err)
        })
      }
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
  // --- Milestone C14 — bulk selection + orchestration -----------------
  // Every handler below operates on the CURRENT selection and reuses an
  // already-existing per-item operation (never a second implementation of
  // analyze/generate/approve/export); see BulkActionBar's own header
  // comment for the exact mapping.

  function toggleSelectProduct(id: string) {
    setSelectedProductIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Selects/deselects every currently VISIBLE (filtered) product — never the
  // full draftProducts — so "select all" respects whatever search/filters
  // are active, per C14's own requirement.
  function toggleSelectAllVisible() {
    const allVisibleSelected = visibleProducts.length > 0 && visibleProducts.every((p) => selectedProductIds.has(p.id))
    setSelectedProductIds((prev) => {
      const next = new Set(prev)
      for (const p of visibleProducts) {
        if (allVisibleSelected) next.delete(p.id)
        else next.add(p.id)
      }
      return next
    })
  }

  function clearSelection() {
    setSelectedProductIds(new Set())
  }

  // Reuses handleAnalyzeProduct (the exact same /api/enrich-product call the
  // drawer's "Analyze Product" button makes) sequentially per selected
  // product — credit-neutral (enrichment never calls deductCredits, see
  // app/api/enrich-product/route.ts), and skips any selected product with no
  // serverId (guests, or a create-product write still in flight) exactly
  // the way the single-product button already does via its own disabled
  // state.
  async function handleBulkAnalyzeSelected() {
    const targets = draftProducts.filter((p) => selectedProductIds.has(p.id) && p.serverId)
    if (targets.length === 0 || bulkRunning) return
    setBulkRunning(true)
    for (let i = 0; i < targets.length; i++) {
      setBulkProgressLabel(`Analyzing ${i + 1} of ${targets.length}…`)
      await handleAnalyzeProduct(targets[i].id)
    }
    setBulkProgressLabel(null)
    setBulkRunning(false)
  }

  // Reuses runGenerationBatch, scoped to whatever's currently selected —
  // doubles as "Bulk Regenerate" per the C17 correction (selecting already-
  // generated products and running this re-runs generation for them, the
  // same way the single-product "Regenerate" button already overwrites
  // that one marketplace's content via generateForProductMarketplace's own
  // spread). No status filter: a selected draft product generates for the
  // first time, a selected generated/partial product regenerates — same
  // call, same credit-authority/stop behavior, no new billing path.
  async function handleBulkGenerateSelected() {
    if (selectedMarketplaces.length === 0) {
      flagMissingMarketplace()
      return
    }
    const targets = draftProducts.filter((p) => selectedProductIds.has(p.id))
    if (targets.length === 0 || bulkRunning) return
    setBulkRunning(true)
    await runGenerationBatch(targets, selectedMarketplaces)
    setBulkRunning(false)
  }

  // Milestone C17 (corrected) — restored as the PRIMARY, zero-selection
  // approval action: "Bulk Approve means approve all eligible generated
  // listings" when nothing is selected. Every draft product with
  // status 'generated' or 'partial' gets every marketplace it actually
  // has content for marked approved. handleBulkApproveSelected (below)
  // remains the secondary, selection-scoped variant for approving a
  // narrower subset.
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

  // Secondary, selection-scoped approval — same generated-content-implies-
  // approvable rule as handleBulkApprove, narrowed to selectedProductIds.
  // Same lack of a persistApprovalToCatalog call — that's an existing
  // C1-C13 property of bulk approval this milestone doesn't change.
  function handleBulkApproveSelected() {
    if (!requireMarketplace()) return
    setDraftProducts((prev) =>
      prev.map((p) => {
        if (!selectedProductIds.has(p.id)) return p
        if (p.status !== 'generated' && p.status !== 'partial') return p
        const approved = { ...p.approved }
        for (const marketplace of SUPPORTED_MARKETPLACES) {
          if (p.generatedContent[marketplace] !== null) approved[marketplace] = true
        }
        return { ...p, approved }
      })
    )
  }

  // Opens the SAME ExportSummaryModal/performExport pipeline the header's
  // "Export Listings" button uses — exportScopeIds is the only difference,
  // and it only ever narrows which approved rows the C11 readiness gate and
  // the export loop itself consider (see the useEffect below and
  // performExport's own scopedProducts). No second readiness judgment.
  function handleBulkExportSelected() {
    if (!hasSession) {
      setShowExportGateModal(true)
      return
    }
    if (!requireMarketplace()) return
    setExportError(null)
    setExportReadiness(null)
    setExportSkipped(null)
    setExportScopeIds(new Set(selectedProductIds))
    setShowExportSummary(true)
  }

  // Milestone C15 — Action Center dispatch. Every branch here calls an
  // ALREADY-EXISTING handler (the exact same function QueueTable's row
  // actions, the drawer's buttons, or the header's own Export Listings
  // button already call) — this function contains no new business logic,
  // it only routes a recommendation's actionType to the one existing
  // handler that already implements it. Clicking is therefore the same
  // explicit user action C1-C14 already required; the recommendation only
  // ever suggested it.
  function handleExecuteRecommendation(rec: CatalogActionRecommendation) {
    switch (rec.actionType) {
      case 'ANALYZE':
        if (rec.productId) void handleAnalyzeProduct(rec.productId)
        return
      case 'GENERATE':
        if (rec.productId && rec.marketplace) void runGeneration(rec.productId, rec.marketplace)
        return
      case 'APPROVE':
        if (rec.productId && rec.marketplace) handleApproveMarketplace(rec.productId, rec.marketplace)
        return
      case 'EXPORT':
        // Marketplace-level, not product-specific — opens the SAME
        // C11-gated export summary the header's own Export Listings button
        // uses (unscoped: every currently-approved, currently-READY row).
        handleOpenExportSummary()
        return
      case 'FIX_LISTING':
        // Opens the existing product/listing drawer at exactly this
        // (product, marketplace) pair — never a second listing-editing UI.
        if (rec.productId && rec.marketplace) setViewingTarget({ productId: rec.productId, marketplace: rec.marketplace })
        return
      case 'COMPLETE_INFORMATION': {
        // Product-level (not marketplace-specific) — opens the drawer on
        // whichever marketplace this product has already attempted (the
        // Product Intelligence section it's about renders above the
        // marketplace-specific section regardless of which one is shown),
        // falling back to the first supported marketplace for a product
        // with nothing generated yet.
        if (!rec.productId) return
        const product = draftProducts.find((p) => p.id === rec.productId)
        if (!product) return
        const attemptedMarketplace = SUPPORTED_MARKETPLACES.find(
          (m) => product.generatedContent[m] !== null || product.generationError[m] !== null
        )
        setViewingTarget({ productId: product.id, marketplace: attemptedMarketplace ?? SUPPORTED_MARKETPLACES[0] })
        return
      }
      case 'REVIEW_BRAND':
        setShowBrandProfile(true)
        return
    }
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
    // Milestone C14 — the header's own global Export Listings button always
    // means "every approved row," so any scope left over from a previous
    // Bulk Export Selected run is cleared here.
    setExportScopeIds(null)
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
    // Milestone C14 — scoped to exportScopeIds when Bulk Export Selected
    // opened this modal, otherwise every product (unchanged C11 behavior).
    // Still the one and only readiness judgment: evaluateMarketplaceExportReadiness
    // itself is untouched, only the candidate set feeding it is narrowed.
    const scopedProducts = exportScopeIds ? draftProducts.filter((p) => exportScopeIds.has(p.id)) : draftProducts
    const marketplacesInPlay = computeExportableCounts(scopedProducts).map((c) => c.marketplace)
    const results = marketplacesInPlay.map((m) =>
      evaluateMarketplaceExportReadiness(m, gatherExportCandidateItems(scopedProducts, m))
    )
    setExportReadiness(results)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showExportSummary, exportScopeIds])

  // Milestone C11 — `marketplaces` is the READY subset from the readiness
  // gate (never the full SUPPORTED_MARKETPLACES list) — a NOT_READY or
  // MISSING_FIELDS marketplace's approved rows are simply never visited by
  // this loop, so they can't reach flattenRow/recordExport/the
  // queue-clearing logic below no matter what. This is the one and only
  // call site; there is no path that bypasses the gate.
  async function performExport(marketplaces: Marketplace[]) {
    // Milestone C14 — scoped to exportScopeIds when set (Bulk Export
    // Selected), otherwise every product, unchanged from C11. Every
    // downstream step (the clearing flatMap over the FULL draftProducts
    // further below) already keys off exportedByProduct, itself built only
    // from flattenedRows — so a product outside this scope is structurally
    // untouched regardless, no separate scoping needed there.
    const scopedProducts = exportScopeIds ? draftProducts.filter((p) => exportScopeIds.has(p.id)) : draftProducts
    const flattenedRows: { id: string; marketplace: Marketplace; row: Record<string, string> }[] = []
    for (const p of scopedProducts) {
      for (const marketplace of marketplaces) {
        if (!p.approved[marketplace]) continue
        const row = flattenRow(marketplace, p.generatedContent[marketplace])
        if (row) flattenedRows.push({ id: p.id, marketplace, row })
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
          // Milestone C14 — tracked alongside listingIds (not re-derived
          // later) so the exported event recorded below points at exactly
          // the same listings recordExport itself was just given, per
          // product, for the product-centric timeline.
          const exportedListings: { productServerId: string; listingId: string }[] = []
          for (const r of flattenedRows) {
            if (r.marketplace !== marketplace) continue
            const exportedProduct = draftProducts.find((p) => p.id === r.id)
            const listingId = exportedProduct?.listingServerIds?.[marketplace]
            if (listingId) {
              listingIds.push(listingId)
              if (exportedProduct.serverId) exportedListings.push({ productServerId: exportedProduct.serverId, listingId })
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

          // Milestone C14 — the product-centric `exported` event is
          // recorded only AFTER recordExport (C7's own authoritative
          // export record) actually succeeds, one per (product, listing)
          // in this batch, each pointing at the SAME export row via
          // metadata.export_id — never a duplicate export record, just a
          // product-scoped pointer to the one C7 already created.
          void recordExport(marketplace, listingIds, `${marketplace}-listings.csv`)
            .then((exportRow) => {
              for (const { productServerId, listingId } of exportedListings) {
                void recordProductHistoryEvent({
                  productId: productServerId,
                  eventType: 'exported',
                  marketplace,
                  listingId,
                  metadata: { export_id: exportRow.id, format: 'csv' }
                }).catch((err: any) => {
                  console.error(
                    `Product history: failed to record exported event for ${productServerId}/${marketplace}:`,
                    err?.message ?? err
                  )
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
  // Display-only — Bulk Approve/Export above still read the full,
  // unfiltered draftProducts (via hasApproved and their own
  // handlers), so a "Ready" filter never narrows what an action operates
  // on, only what the table currently shows.
  // Milestone C14 — Catalog Command Center derived view. All display-only
  // (see catalogFilters/sortKey's own comment above): Generate All/Bulk
  // Approve/Export above still read the full, unfiltered draftProducts.
  // Milestone C17 — brand-first scoping: a specific selected brand (the
  // same selectedClient that already drives brand voice at creation time)
  // narrows "My Products" to only that brand's own products, via the
  // client_id association mirrored locally as DraftProduct.clientId (see
  // lib/types.ts's own comment). "No brand selected" (selectedClient ===
  // null) is the "All Brands" state — nothing is hidden. A product added
  // before this milestone shipped (clientId undefined) simply has no
  // brand association yet, same as any other additive field's honest
  // default — it shows under "All Brands," not under a specific one.
  const brandScopedProducts = selectedClient ? draftProducts.filter((p) => p.clientId === selectedClient.id) : draftProducts
  const needsAttention = computeNeedsAttention(brandScopedProducts)
  const availableBrands = getAvailableBrands(brandScopedProducts)
  const availableCategories = getAvailableCategories(brandScopedProducts)
  const visibleProducts = sortProducts(filterProducts(brandScopedProducts, catalogFilters), sortKey)
  const selectedCount = selectedProductIds.size
  const canBulkAnalyze = hasSession && draftProducts.some((p) => selectedProductIds.has(p.id) && p.serverId)
  // Milestone C17 (corrected) — no status filter: a selected draft product
  // generates for the first time, a selected already-generated product
  // regenerates. Any selected product makes this "Bulk Generate"/"Bulk
  // Regenerate" available (see handleBulkGenerateSelected's own comment).
  const canBulkGenerate = draftProducts.some((p) => selectedProductIds.has(p.id))
  const isBulkRegenerate = draftProducts.some((p) => selectedProductIds.has(p.id) && (p.status === 'generated' || p.status === 'partial'))
  const canBulkApprove = draftProducts.some(
    (p) => selectedProductIds.has(p.id) && (p.status === 'generated' || p.status === 'partial')
  )
  const canBulkExport = draftProducts.some(
    (p) => selectedProductIds.has(p.id) && SUPPORTED_MARKETPLACES.some((m) => p.approved[m])
  )
  // Milestone C17 (corrected) — drives the primary/enabled states AND the
  // credit-cost preview text of QueueTable's zero-selection toolbar
  // (Generate Listings/Approve All/Export Listings), the actual primary
  // workflow now that selection is confirmed secondary. A count, not just
  // a boolean, so the toolbar can say "Uses N credits" honestly.
  const pendingGenerationCount = draftProducts.filter((p) => p.status === 'draft').length
  const hasUnapprovedContent = draftProducts.some(
    (p) =>
      (p.status === 'generated' || p.status === 'partial') &&
      SUPPORTED_MARKETPLACES.some((m) => p.generatedContent[m] !== null && !p.approved[m])
  )
  // Milestone C15 — pure, synchronous, side-effect-free derivation (see
  // lib/catalogRecommendations.ts's own header comment). useMemo here is
  // purely a render-cost optimization (avoids re-deriving on every
  // unrelated re-render, e.g. a text input keystroke elsewhere in this
  // component) — it changes no behavior, since the underlying function is
  // pure regardless.
  const recommendations = useMemo(
    () => computeCatalogRecommendations(draftProducts, selectedClient),
    [draftProducts, selectedClient]
  )
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
          {/* Milestone C17 — Seller Core Experience redesign. One column,
              product-centric flow (brand context -> create hero -> My
              Products), replacing the old permanent Add-Products sidebar
              column and the C15 Action Center's global card-stack. Every
              handler either of those used is unchanged and reused (see
              openCreatePanel above, handleExecuteRecommendation below,
              QueueTable's per-card recommendation hint) — this is a
              presentation/information-architecture change only, no new
              business logic. */}
          <div className="flex-1 min-h-0 overflow-y-auto p-6">
            <div className="max-w-5xl mx-auto flex flex-col gap-6">
              {outdatedSessionDiscarded && (
                <div className={`flex items-center justify-between gap-4 ${warningBannerClass}`}>
                  <p className={warningTextClass}>Previous session format outdated, please start fresh.</p>
                  <button onClick={() => setOutdatedSessionDiscarded(false)} className={buttonSecondaryClass}>
                    Dismiss
                  </button>
                </div>
              )}

              {pendingRestoreCount !== null && (
                <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${warningBannerClass}`}>
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

              {/* Top-level and impossible to miss, deliberately — running
                  out of credits mid-batch is an account-level stop. No
                  purchase flow exists yet, so "Buy more credits" goes to
                  /contact (real, existing) rather than a fabricated route. */}
              {creditsStoppedInfo && (
                <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${dangerBannerClass}`}>
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

              {downloadMessage && (
                <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border border-[var(--success-border)] bg-[var(--success-bg)]`}>
                  <p className="text-sm text-[var(--success-text)]">✓ {downloadMessage}</p>
                </div>
              )}

              {deleteError && (
                <div className={`flex items-center justify-between gap-4 ${dangerBannerClass}`}>
                  <p className={dangerTextClass}>{deleteError}</p>
                  <button onClick={() => setDeleteError(null)} className={buttonSecondaryClass}>
                    Dismiss
                  </button>
                </div>
              )}

              {/* Milestone C11 — which marketplaces the readiness gate
                  excluded from the export the banner above just reported,
                  and the real reason for each. */}
              {exportSkipped && exportSkipped.length > 0 && (
                <div className={warningBannerClass}>
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

              {/* CREATE HERO — ONE canonical creation entry point. "Create
                  Product" and "Improve Existing Listing" are two framings
                  of the exact same AddProductsPanel/commitAddProduct
                  pipeline (see openCreatePanel above); Bulk Upload is an
                  input method reached from the tab strip INSIDE the panel
                  once it's open, never a third competing top-level button
                  — that was the exact "form inside form" / "Create
                  Product -> Bulk Create -> Create Product" confusion this
                  correction removes. */}
              <div className={`p-6 flex flex-col gap-4 ${cardClass}`}>
                <div>
                  <h1 className={sectionHeadingClass}>Create your next listing</h1>
                  <p className={bodyTextClass}>
                    Give Tesolute whatever you already have — photos, a description, or an existing listing — and it'll turn
                    it into marketplace-ready content
                    {selectedClient ? (
                      <>
                        {' '}
                        for <span className="font-medium text-[var(--heading-text)]">{selectedClient.client_name}</span>
                      </>
                    ) : null}
                    .
                  </p>
                </div>

                {/* Brand/marketplace context — persistent and always
                    visible (never buried inside the collapsible form
                    below), since it's genuinely lightweight (a handful of
                    pills + one dropdown) and other flows (bulk actions on
                    already-existing products) also depend on knowing which
                    marketplaces are currently selected. */}
                <AppHeader
                  hasSession={hasSession}
                  selectedMarketplaces={selectedMarketplaces}
                  onToggleMarketplace={handleToggleMarketplace}
                  marketplaceError={marketplaceError}
                  marketplaceFlash={marketplaceFlash}
                  marketplaceGroupRef={marketplaceSelectRef}
                  selectedClientId={selectedClient?.id || ''}
                  onSelectClient={setSelectedClient}
                  onOpenBrandProfile={() => setShowBrandProfile(true)}
                />

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => openCreatePanel('create')}
                    className={showCreatePanel && createIntent === 'create' ? buttonPrimaryClass : buttonSecondaryClass}
                  >
                    Create Product
                  </button>
                  <button
                    onClick={() => openCreatePanel('improve')}
                    className={showCreatePanel && createIntent === 'improve' ? buttonPrimaryClass : buttonSecondaryClass}
                  >
                    Improve Existing Listing
                  </button>
                  {showCreatePanel && (
                    <button onClick={() => setShowCreatePanel(false)} className={linkButtonClass}>
                      Close
                    </button>
                  )}
                </div>

                {showCreatePanel && (
                  <div className="flex flex-col gap-3">
                    {createIntent === 'improve' && activeTab === 'manual' && (
                      <p className={`${warningTextClass} px-3 py-2 rounded-lg ${warningBannerClass}`}>
                        Paste your existing listing's title, bullets, or description below — Tesolute will analyze it and
                        create improved, marketplace-ready content.
                      </p>
                    )}
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
                  </div>
                )}
              </div>

              {/* MY PRODUCTS — the primary object the seller thinks in
                  terms of, not "my marketplace tasks." */}
              <div className="flex flex-col gap-3">
                <h2 className={sectionHeadingClass}>My Products</h2>
                {sessionReady && brandScopedProducts.length === 0 ? (
                  <WorkspaceEmptyState onOpenCreate={() => openCreatePanel('create')} />
                ) : (
                  <>
                    {brandScopedProducts.length > 0 && (
                      <CatalogFilterBar
                        filters={catalogFilters}
                        onFiltersChange={setCatalogFilters}
                        sortKey={sortKey}
                        onSortKeyChange={setSortKey}
                        availableBrands={availableBrands}
                        availableCategories={availableCategories}
                        needsAttention={needsAttention}
                        onClearFilters={() => setCatalogFilters(DEFAULT_PRODUCT_FILTERS)}
                        readinessFilter={readinessFilter}
                        onReadinessFilterChange={setReadinessFilter}
                      />
                    )}
                    <BulkActionBar
                      selectedCount={selectedCount}
                      onClear={clearSelection}
                      onAnalyze={handleBulkAnalyzeSelected}
                      onGenerate={handleBulkGenerateSelected}
                      onApprove={handleBulkApproveSelected}
                      onExport={handleBulkExportSelected}
                      canAnalyze={canBulkAnalyze}
                      canGenerate={canBulkGenerate}
                      canApprove={canBulkApprove}
                      canExport={canBulkExport}
                      isRegenerate={isBulkRegenerate}
                      busy={bulkRunning || generating}
                      progressLabel={bulkProgressLabel}
                    />
                    <QueueTable
                      draftProducts={visibleProducts}
                      totalProductCount={brandScopedProducts.length}
                      readinessFilter={readinessFilter}
                      currentlyGenerating={currentlyGenerating}
                      selectedMarketplaces={selectedMarketplaces}
                      generating={generating}
                      pendingGenerationCount={pendingGenerationCount}
                      hasUnapprovedContent={hasUnapprovedContent}
                      hasApproved={hasApproved}
                      loading={!sessionReady}
                      selectedIds={selectedProductIds}
                      onToggleSelect={toggleSelectProduct}
                      onToggleSelectAll={toggleSelectAllVisible}
                      recommendations={recommendations}
                      onExecuteRecommendation={handleExecuteRecommendation}
                      onGenerateAll={handleGenerateAll}
                      onBulkApprove={handleBulkApprove}
                      onDownloadApproved={handleOpenExportSummary}
                      onView={(id, marketplace) => setViewingTarget({ productId: id, marketplace })}
                      onEdit={handleEditProduct}
                      onDelete={handleDeleteProduct}
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
          onSwitchMarketplace={(m) => setViewingTarget({ productId: viewingProduct.id, marketplace: m })}
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
      {showExportSummary && (
        <ExportSummaryModal
          // Milestone C14 — shows the SCOPED counts/summary when Bulk Export
          // Selected opened this modal, so the confirmation surface never
          // shows counts for products outside the export it's about to run.
          exportableCounts={computeExportableCounts(exportScopeIds ? draftProducts.filter((p) => exportScopeIds.has(p.id)) : draftProducts)}
          summary={computeListingSummary(exportScopeIds ? draftProducts.filter((p) => exportScopeIds.has(p.id)) : draftProducts)}
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
