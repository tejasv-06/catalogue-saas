"use client"

import { useState } from 'react'
import type { Marketplace } from '@/lib/types'
import type { ReadinessFilter } from '@/components/CatalogueWorkspace'
import { MARKETPLACE_LABELS, SUPPORTED_MARKETPLACES } from '@/lib/platformShapers'
import { SORT_OPTIONS, hasActiveFilters, type ProductFilters, type ProductSortKey, type AttentionItem } from '@/lib/catalogOperations'
import { inputClass, selectClass, linkButtonClass, buttonSecondarySmallClass } from '@/lib/uiClasses'

// Milestone C14 — search + composable filters over the product queue, all
// display-only: bulk/global actions still read the full, unfiltered
// draftProducts, so narrowing this bar never changes what those operate on
// — only what's currently shown and selectable.
//
// Milestone C17 — search stays always visible (the seller's one everyday
// tool); everything else (brand/category/marketplace/approval/sort/status)
// is real operational depth that stays fully functional but now sits
// behind a "Filters" toggle, collapsed by default, so it doesn't compete
// with the create hero and product cards for attention on a simple
// workspace. Same filter STATE and logic as before — this is presentation
// only. The readiness/status pills (previously a separate strip in
// CatalogueWorkspace.tsx) now live in here too, relabeled in plain
// language instead of the internal ready/needs-review/missing-data/error
// vocabulary.
const STATUS_OPTIONS: { id: ReadinessFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'Complete' },
  { id: 'needs-review', label: 'Needs a look' },
  { id: 'missing-data', label: 'Details needed' },
  { id: 'error', label: "Couldn't generate" }
]

export default function CatalogFilterBar({
  filters,
  onFiltersChange,
  sortKey,
  onSortKeyChange,
  availableBrands,
  availableCategories,
  needsAttention,
  onClearFilters,
  readinessFilter,
  onReadinessFilterChange
}: {
  filters: ProductFilters
  onFiltersChange: (filters: ProductFilters) => void
  sortKey: ProductSortKey
  onSortKeyChange: (key: ProductSortKey) => void
  availableBrands: string[]
  availableCategories: string[]
  needsAttention: AttentionItem[]
  onClearFilters: () => void
  readinessFilter: ReadinessFilter
  onReadinessFilterChange: (filter: ReadinessFilter) => void
}) {
  const attentionCount = new Set(needsAttention.map((i) => i.productId)).size
  // Starts open if a filter is already active (e.g. restored some other
  // way) so an active filter is never silently hidden — otherwise starts
  // collapsed, since most sessions don't need it on every visit.
  const [showMore, setShowMore] = useState(() => hasActiveFilters(filters) || readinessFilter !== 'all')

  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          placeholder="Search your products…"
          aria-label="Search your products"
          className={`${inputClass} flex-1 min-w-[180px] py-2`}
        />
        <button type="button" onClick={() => setShowMore((v) => !v)} className={buttonSecondarySmallClass}>
          {showMore ? 'Hide filters' : 'Filters'}
        </button>
      </div>

      {showMore && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filters.brand}
            onChange={(e) => onFiltersChange({ ...filters, brand: e.target.value })}
            aria-label="Filter by brand"
            className={`${selectClass} py-2`}
          >
            <option value="all">All Brands</option>
            {availableBrands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>

          <select
            value={filters.category}
            onChange={(e) => onFiltersChange({ ...filters, category: e.target.value })}
            aria-label="Filter by category"
            className={`${selectClass} py-2`}
          >
            <option value="all">All Categories</option>
            {availableCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={filters.marketplace}
            onChange={(e) => onFiltersChange({ ...filters, marketplace: e.target.value as Marketplace | 'all' })}
            aria-label="Filter by marketplace"
            className={`${selectClass} py-2`}
          >
            <option value="all">All Marketplaces</option>
            {SUPPORTED_MARKETPLACES.map((m) => (
              <option key={m} value={m}>
                {MARKETPLACE_LABELS[m]}
              </option>
            ))}
          </select>

          <select
            value={filters.approval}
            onChange={(e) => onFiltersChange({ ...filters, approval: e.target.value as ProductFilters['approval'] })}
            aria-label="Filter by approval status"
            className={`${selectClass} py-2`}
          >
            <option value="all">Any Approval Status</option>
            <option value="approved">Approved</option>
            <option value="partially-approved">Partially Approved</option>
            <option value="unapproved">Unapproved</option>
          </select>

          <select
            value={sortKey}
            onChange={(e) => onSortKeyChange(e.target.value as ProductSortKey)}
            aria-label="Sort products"
            className={`${selectClass} py-2`}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap gap-1.5">
            {STATUS_OPTIONS.map((option) => {
              const isActive = readinessFilter === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onReadinessFilterChange(option.id)}
                  aria-pressed={isActive}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
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

          {(hasActiveFilters(filters) || readinessFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                onClearFilters()
                onReadinessFilterChange('all')
              }}
              className={linkButtonClass}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {attentionCount > 0 && (
        <button
          type="button"
          onClick={() => onFiltersChange({ ...filters, attentionOnly: !filters.attentionOnly })}
          aria-pressed={filters.attentionOnly}
          className={`self-start px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            filters.attentionOnly
              ? 'bg-[var(--danger-bg)] border-[var(--danger-border)] text-[var(--danger-text)]'
              : 'bg-[var(--warn-bg)] border-[var(--warn-border)] text-[var(--warn-text)] hover:opacity-90'
          }`}
        >
          {attentionCount} product{attentionCount === 1 ? '' : 's'} could use a look
          {filters.attentionOnly ? ' — showing only these' : ' — tap to view'}
        </button>
      )}
    </div>
  )
}
