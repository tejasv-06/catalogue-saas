"use client"

import type { DraftProduct, Marketplace } from '@/lib/types'
import type { ReadinessFilter } from '@/components/CatalogueWorkspace'
import { SUPPORTED_MARKETPLACES, MARKETPLACE_LABELS } from '@/lib/platformShapers'
import { computeListingHealth } from '@/lib/listingHealth'
import ProductThumbnail from '@/components/ProductThumbnail'
import ListingHealthBadge, { type RowHealthStatus } from '@/components/workspace/ListingHealthBadge'
import EmptyQueueState from '@/components/workspace/EmptyQueueState'
import TableSkeleton from '@/components/workspace/TableSkeleton'
import { CREDIT_COSTS } from '@/lib/creditCosts'
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonDestructiveSmallClass,
  linkButtonClass,
  linkButtonDestructiveClass,
  cardClass
} from '@/lib/uiClasses'

const COLUMN_COUNT = 6

// One row per (product, marketplace) pair that's actually been attempted —
// answers "is this specific listing ready to upload," which a single
// product-level row couldn't when a product spans several marketplaces. The
// marketplace currently generating is included too, even before it has any
// content/error of its own, so it gets its own "Generating…" row instead of
// silently having no row at all until it resolves. A product with nothing
// attempted or in flight yet still gets exactly one row (marketplace slot
// null) so it doesn't disappear from the queue before generation runs.
function getDisplayMarketplaces(product: DraftProduct, generatingMarketplace: Marketplace | null): Marketplace[] {
  const displaySet = new Set(
    SUPPORTED_MARKETPLACES.filter((m) => product.generatedContent[m] !== null || product.generationError[m] !== null)
  )
  if (generatingMarketplace) displaySet.add(generatingMarketplace)
  return SUPPORTED_MARKETPLACES.filter((m) => displaySet.has(m))
}

// One row's worth of pre-computed display facts — built once per candidate
// marketplace so filtering (below) and rendering both work off the exact
// same computeListingHealth call, never a second one that could drift from it.
type RowData = {
  marketplace: Marketplace | null
  isGenerating: boolean
  content: any | null
  error: string | null
  health: ReturnType<typeof computeListingHealth> | null
  rowStatus: RowHealthStatus
}

function buildRowData(product: DraftProduct, generatingMarketplace: Marketplace | null): RowData[] {
  const displayMarketplaces = getDisplayMarketplaces(product, generatingMarketplace)
  const marketplaceRows: (Marketplace | null)[] = displayMarketplaces.length > 0 ? displayMarketplaces : [null]

  return marketplaceRows.map((marketplace) => {
    const isGenerating = marketplace !== null && marketplace === generatingMarketplace
    const content = marketplace ? product.generatedContent[marketplace] : null
    const error = marketplace ? product.generationError[marketplace] : null
    const health =
      marketplace && !isGenerating ? computeListingHealth(marketplace, content, error, product.generationMeta[marketplace]) : null

    const rowStatus: RowHealthStatus = isGenerating
      ? 'generating'
      : !marketplace
        ? 'not-generated'
        : (health!.status as RowHealthStatus)

    return { marketplace, isGenerating, content, error, health, rowStatus }
  })
}

// A product can span several marketplaces at different readiness states
// (Amazon Ready, Flipkart Needs Review) — filtering must operate at the same
// (product, marketplace) granularity QueueRows renders at, not hide/show a
// whole product's rows as one unit. 'all' keeps everything, including the
// in-flight/not-yet-attempted placeholder rows; any specific status keeps
// only the rows whose own real health.status matches it — a row still
// generating (health null) or never attempted (health null) never matches a
// specific filter.
function filterRowData(rows: RowData[], filter: ReadinessFilter): RowData[] {
  if (filter === 'all') return rows
  return rows.filter((r) => r.health?.status === filter)
}

// Whether this product has at least one row visible under the current
// filter — used by QueueTable to decide which products to render at all,
// using the exact same per-row data (and therefore the exact same
// computeListingHealth calls) QueueRows itself renders from.
function productHasVisibleRow(product: DraftProduct, generatingMarketplace: Marketplace | null, filter: ReadinessFilter): boolean {
  return filterRowData(buildRowData(product, generatingMarketplace), filter).length > 0
}

function QueueRows({
  product,
  generatingMarketplace,
  filter,
  selected,
  onToggleSelect,
  onView,
  onEdit,
  onDelete,
  onRetry
}: {
  product: DraftProduct
  // The one marketplace of THIS product currently generating, or null — not
  // a product-wide flag, so a row whose own marketplace already finished
  // doesn't get stuck showing "Generating…" just because a sibling row for
  // the same product is still in flight.
  generatingMarketplace: Marketplace | null
  filter: ReadinessFilter
  selected: boolean
  onToggleSelect: (id: string) => void
  onView: (id: string, marketplace: Marketplace) => void
  onEdit: (product: DraftProduct) => void
  onDelete: (id: string) => void
  onRetry: (id: string, marketplace: Marketplace) => void
}) {
  const marketplaceRows = filterRowData(buildRowData(product, generatingMarketplace), filter)
  if (marketplaceRows.length === 0) return null

  return (
    <>
      {marketplaceRows.map(({ marketplace, isGenerating, content, error, health, rowStatus }, i) => {
        const failedChecks = health ? health.checks.filter((c) => c.applicable && !c.passed).length : 0

        return (
          <tr key={`${product.id}-${marketplace ?? 'none'}`} className="border-b border-[var(--row-border)]">
            {i === 0 && (
              <td className="py-3 px-4 align-top" rowSpan={marketplaceRows.length}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleSelect(product.id)}
                  aria-label={`Select ${product.brandName || 'product'}`}
                  className="w-4 h-4 rounded border-[var(--card-border)]"
                />
              </td>
            )}
            {i === 0 && (
              <td className="py-3 px-4 align-top" rowSpan={marketplaceRows.length}>
                <div className="flex items-center gap-3">
                  <ProductThumbnail imageFile={product.imageFile} imageUrl={product.imageUrl} alt={product.brandName} size={56} />
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-[var(--heading-text)] truncate">{product.brandName || '-'}</p>
                    <p className="text-xs text-[var(--muted-text)] truncate">{product.category || '-'}</p>
                    <div className="flex gap-2 mt-1">
                      <button onClick={() => onEdit(product)} className={linkButtonClass}>
                        Edit
                      </button>
                      <button onClick={() => onDelete(product.id)} className={linkButtonDestructiveClass}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </td>
            )}
            <td className="py-3 px-4 text-sm text-[var(--body-text)]">
              {marketplace ? MARKETPLACE_LABELS[marketplace] : '—'}
            </td>
            <td className="py-3 px-4">
              <div className="flex flex-col gap-0.5">
                <ListingHealthBadge status={rowStatus} />
                {health && <span className="text-xs text-[var(--muted-text)]">{health.percentComplete}% complete</span>}
              </div>
            </td>
            <td className="py-3 px-4 text-sm text-[var(--body-text)]">{health ? failedChecks : '—'}</td>
            <td className="py-3 px-4 whitespace-nowrap space-x-2">
              {/* marketplace narrowed explicitly (not just content||error)
                  so onView always carries the exact row's own marketplace —
                  this is the one (product, marketplace) pair this row
                  represents, and the drawer it opens must show only this
                  one, not every marketplace this product has ever attempted. */}
              {marketplace && (content || error) && (
                <button onClick={() => onView(product.id, marketplace)} className={linkButtonClass}>
                  View
                </button>
              )}
              {error && marketplace && (
                <button
                  onClick={() => onRetry(product.id, marketplace)}
                  disabled={isGenerating}
                  className={buttonDestructiveSmallClass}
                >
                  Retry
                </button>
              )}
            </td>
          </tr>
        )
      })}
    </>
  )
}

export default function QueueTable({
  draftProducts,
  // Milestone C14 — the real, unfiltered product count, used only to tell
  // "you have zero products at all" apart from "your filters/search matched
  // zero of your real products" — CatalogueWorkspace itself already renders
  // WorkspaceEmptyState for the former case, so this only ever disambiguates
  // the latter (filtered-to-nothing) from QueueTable's own default empty
  // copy, which would otherwise be misleading once filters exist.
  totalProductCount,
  readinessFilter,
  currentlyGenerating,
  selectedMarketplaces,
  generating,
  hasApproved,
  loading,
  hasSession,
  pendingCount,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onGenerateAll,
  onBulkApprove,
  onDownloadApproved,
  onView,
  onEdit,
  onDelete,
  onRetry
}: {
  draftProducts: DraftProduct[]
  totalProductCount: number
  // Filtering happens here, at the same (product, marketplace) granularity
  // the rows themselves render at (see filterRowData/productHasVisibleRow
  // above) — draftProducts is passed in unfiltered so a product with, say,
  // one Ready and one Needs Review marketplace can show just the matching
  // row under either filter instead of both.
  readinessFilter: ReadinessFilter
  // Only one (product, marketplace) pair is ever generating at a time (the
  // generation loop is sequential) — passed through as-is so each row can
  // tell whether it specifically is the one in flight, not just its product.
  currentlyGenerating: { productId: string; marketplace: Marketplace } | null
  selectedMarketplaces: Marketplace[]
  generating: boolean
  hasApproved: boolean
  loading: boolean
  hasSession: boolean
  pendingCount: number
  // Milestone C14 — bulk-selection state, at product granularity (one
  // checkbox per product row-group, not per marketplace row) — selection
  // scope for BulkActionBar's Analyze/Generate/Approve/Export actions.
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  onGenerateAll: () => void
  onBulkApprove: () => void
  onDownloadApproved: () => void
  onView: (id: string, marketplace: Marketplace) => void
  onEdit: (product: DraftProduct) => void
  onDelete: (id: string) => void
  onRetry: (id: string, marketplace: Marketplace) => void
}) {
  const allVisibleSelected = draftProducts.length > 0 && draftProducts.every((p) => selectedIds.has(p.id))
  const hasSelectedMarketplaces = selectedMarketplaces.length > 0

  // Sequential "what's next" highlight: exactly one of the three actions is
  // primary blue at a time, based on where the queue actually is — not the
  // active tab or any manual toggle.
  //
  // Two things `status` alone can no longer answer, now that a product can
  // span several marketplaces generated independently:
  //   1. "hasGenerated" (status 'generated'/'partial' existing anywhere) can
  //      go true mid-batch — a product flips to 'partial' the instant its
  //      FIRST marketplace lands, while its others are still in flight in
  //      the very same run. Gating on `generating` fixes Bulk Approve
  //      lighting up before the batch actually finishes.
  //   2. Approving a marketplace never changes `status` (approval is fully
  //      independent of it) — so "no generated-status product exists" is
  //      never true again once anything has ever been generated, which
  //      made Download practically unreachable. What actually matters is
  //      whether any generated marketplace is still *unapproved* anywhere,
  //      not whether `status` ever resets.
  const hasDraft = draftProducts.some((p) => p.status === 'draft')
  const hasUnapprovedContent = draftProducts.some((p) =>
    SUPPORTED_MARKETPLACES.some((m) => p.generatedContent[m] !== null && !p.approved[m])
  )

  const generateIsPrimary = hasDraft
  const bulkApproveIsPrimary = !generating && !hasDraft && hasUnapprovedContent
  const downloadIsPrimary = !generating && !hasDraft && !hasUnapprovedContent && hasApproved

  // Guests aren't credit-metered (they have the separate free-preview count
  // shown in the header), so the cost preview only applies once signed in —
  // computed from the actual pending count and selected marketplaces, not
  // hardcoded, so it can't drift from what generating will actually cost.
  // Total cost is simply products × marketplaces (one credit per pair), the
  // same sum the generation loop actually charges, not a separate formula.
  const totalGenerations = pendingCount * selectedMarketplaces.length
  const creditCost = totalGenerations * CREDIT_COSTS.listingGeneration
  // Plain label on the button itself; the cost (when it applies) is small
  // secondary text underneath instead of folded into one long sentence —
  // Generate Listings is the thing being decided, not the arithmetic.
  const generateLabel = generating ? 'Generating...' : 'Generate Listings'
  const showCreditCost = !generating && hasSession && pendingCount > 0 && hasSelectedMarketplaces

  return (
    <div className={`w-full min-w-0 h-full flex flex-col p-6 ${cardClass}`}>
      <div className="flex flex-row flex-wrap items-center justify-between gap-3 mb-4 shrink-0">
        <div className="flex flex-row flex-wrap items-start gap-3">
          <div>
            <button
              onClick={onGenerateAll}
              // Deliberately NOT gated on hasSelectedMarketplaces — this
              // button must stay clickable with zero marketplaces selected
              // so the click reaches handleGenerateAll's own
              // requireMarketplace() check, which is what actually shows
              // "Please select at least one target marketplace." A disabled
              // button here would silently swallow that click and make the
              // warning unreachable, the same problem the old
              // Add-Product-side gate had.
              disabled={!hasDraft || generating}
              className={generateIsPrimary ? buttonPrimaryClass : buttonSecondaryClass}
            >
              {generateLabel}
            </button>
            {showCreditCost && (
              <p className="text-xs text-[var(--muted-text)] mt-1">
                Uses {creditCost} credit{creditCost === 1 ? '' : 's'}
              </p>
            )}
          </div>
          <button
            onClick={onBulkApprove}
            disabled={!hasSelectedMarketplaces || !hasUnapprovedContent}
            className={bulkApproveIsPrimary ? buttonPrimaryClass : buttonSecondaryClass}
          >
            Bulk Approve
          </button>
        </div>
        <button
          onClick={onDownloadApproved}
          disabled={!hasSelectedMarketplaces || !hasApproved}
          className={downloadIsPrimary ? buttonPrimaryClass : buttonSecondaryClass}
        >
          Export Listings
        </button>
      </div>
      {/* flex-1 + min-h-0 lets this fill the card down to its border on a
          short queue instead of leaving empty space beneath the table, and
          scroll internally (rather than growing the page) once the queue
          outgrows the available height. */}
      {/* Milestone C16 — min-w-[680px] gives every column a sane floor
          (checkbox/Product/Marketplace/Health/Issues/Actions each keep a
          readable width) instead of shrinking arbitrarily as the viewport
          narrows. Below that floor this container (already overflow-auto)
          scrolls horizontally on its own — the table/data region, never the
          whole page — exactly the existing, correct pattern; this just
          gives it a real floor to kick in at instead of letting `table-auto`
          layout squeeze every column to its bare minimum content width. */}
      <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-[var(--card-border)]">
        <table className="w-full min-w-[680px] border-collapse">
          <thead>
            <tr className="border-b border-[var(--row-border)] bg-[var(--table-head-bg)] text-left text-xs text-[var(--muted-text)]">
              <th className="py-3 px-4">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={onToggleSelectAll}
                  aria-label="Select all visible products"
                  className="w-4 h-4 rounded border-[var(--card-border)]"
                />
              </th>
              <th className="py-3 px-4">Product</th>
              <th className="py-3 px-4">Marketplace</th>
              <th className="py-3 px-4">Health</th>
              <th className="py-3 px-4">Issues</th>
              <th className="py-3 px-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton columns={COLUMN_COUNT} />
            ) : draftProducts.length === 0 ? (
              <EmptyQueueState
                colSpan={COLUMN_COUNT}
                message={totalProductCount > 0 ? 'No listings match your filters or search.' : undefined}
              />
            ) : !draftProducts.some((p) =>
                productHasVisibleRow(
                  p,
                  currentlyGenerating?.productId === p.id ? currentlyGenerating.marketplace : null,
                  readinessFilter
                )
              ) ? (
              <EmptyQueueState colSpan={COLUMN_COUNT} message="No listings match this filter." />
            ) : (
              draftProducts.map((product) => (
                <QueueRows
                  key={product.id}
                  product={product}
                  generatingMarketplace={currentlyGenerating?.productId === product.id ? currentlyGenerating.marketplace : null}
                  filter={readinessFilter}
                  selected={selectedIds.has(product.id)}
                  onToggleSelect={onToggleSelect}
                  onView={onView}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onRetry={onRetry}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
