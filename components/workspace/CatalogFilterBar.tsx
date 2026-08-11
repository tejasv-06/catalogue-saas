"use client"

import type { Marketplace } from '@/lib/types'
import { MARKETPLACE_LABELS, SUPPORTED_MARKETPLACES } from '@/lib/platformShapers'
import { SORT_OPTIONS, type ProductFilters, type ProductSortKey, type AttentionItem } from '@/lib/catalogOperations'
import { inputClass, selectClass, linkButtonClass } from '@/lib/uiClasses'

// Milestone C14 — search + composable filters over the product queue.
// Deliberately display-only, same pattern the existing ReadinessFilter
// strip in CatalogueWorkspace.tsx already established: Generate All / Bulk
// Approve / Export still read the full, unfiltered draftProducts, so
// narrowing this bar's filters never changes what those actions operate on
// — only what the table currently shows and what a bulk-selection can
// select from.
export default function CatalogFilterBar({
  filters,
  onFiltersChange,
  sortKey,
  onSortKeyChange,
  availableBrands,
  availableCategories,
  needsAttention,
  onClearFilters
}: {
  filters: ProductFilters
  onFiltersChange: (filters: ProductFilters) => void
  sortKey: ProductSortKey
  onSortKeyChange: (key: ProductSortKey) => void
  availableBrands: string[]
  availableCategories: string[]
  needsAttention: AttentionItem[]
  onClearFilters: () => void
}) {
  const attentionCount = new Set(needsAttention.map((i) => i.productId)).size

  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          placeholder="Search brand, category, description…"
          aria-label="Search listings"
          className={`${inputClass} flex-1 min-w-[180px] py-2`}
        />

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
          aria-label="Sort listings"
          className={`${selectClass} py-2`}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>

        {(filters.search || filters.brand !== 'all' || filters.category !== 'all' || filters.marketplace !== 'all' || filters.approval !== 'all' || filters.attentionOnly) && (
          <button type="button" onClick={onClearFilters} className={linkButtonClass}>
            Clear filters
          </button>
        )}
      </div>

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
          ⚠ {attentionCount} listing{attentionCount === 1 ? '' : 's'} need{attentionCount === 1 ? 's' : ''} attention
          {filters.attentionOnly ? ' — showing only these' : ' — click to view'}
        </button>
      )}
    </div>
  )
}
