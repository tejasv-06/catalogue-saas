"use client"

import { useEffect, useState } from 'react'
import { getProductExternalIds, setProductExternalId } from '@/lib/performance'
import { PERFORMANCE_MARKETPLACES, PERFORMANCE_MARKETPLACE_LABELS, type PerformanceMarketplace } from '@/lib/performanceAdapters'
import { labelClass, inputClass, buttonSecondarySmallClass } from '@/lib/uiClasses'

// Milestone C15 follow-up — lets a seller type a marketplace's own
// product identifier (Myntra Style ID, Amazon ASIN) directly onto a
// product BEFORE any performance report is ever uploaded. Saving here
// calls setProductExternalId, which writes into the exact same
// catalog_product_external_ids table the import flow's Confirm Import
// writes into (lib/performance.ts) — so a report uploaded afterward
// matches this product immediately, no dropdown needed. Ground truth
// typed by a human; this file never reads brand/category/price.

type FieldState = { value: string; saved: string | null; saving: boolean; error: string | null }

export default function ProductMarketplaceIds({ productId }: { productId: string | null | undefined }) {
  const [fields, setFields] = useState<Record<PerformanceMarketplace, FieldState> | null>(null)

  useEffect(() => {
    if (!productId) return
    let cancelled = false

    getProductExternalIds(productId)
      .then((mappings) => {
        if (cancelled) return
        const next = {} as Record<PerformanceMarketplace, FieldState>
        for (const m of PERFORMANCE_MARKETPLACES) {
          const existing = mappings.get(m) ?? ''
          next[m] = { value: existing, saved: existing || null, saving: false, error: null }
        }
        setFields(next)
      })
      .catch((err: any) => {
        console.error(`ProductMarketplaceIds: failed to load mappings for ${productId}:`, err?.message ?? err)
        if (cancelled) return
        const next = {} as Record<PerformanceMarketplace, FieldState>
        for (const m of PERFORMANCE_MARKETPLACES) next[m] = { value: '', saved: null, saving: false, error: null }
        setFields(next)
      })

    return () => {
      cancelled = true
    }
  }, [productId])

  if (!productId || !fields) return null

  async function handleSave(marketplace: PerformanceMarketplace) {
    if (!productId || !fields) return
    const value = fields[marketplace].value.trim()
    if (!value) return

    setFields((prev) => (prev ? { ...prev, [marketplace]: { ...prev[marketplace], saving: true, error: null } } : prev))
    try {
      await setProductExternalId(productId, marketplace, value)
      setFields((prev) => (prev ? { ...prev, [marketplace]: { value, saved: value, saving: false, error: null } } : prev))
    } catch (err: any) {
      setFields((prev) =>
        prev ? { ...prev, [marketplace]: { ...prev[marketplace], saving: false, error: err?.message ?? 'Failed to save' } } : prev
      )
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-[var(--card-border)]">
      <p className={labelClass}>Marketplace IDs</p>
      <p className="mt-1 text-xs text-[var(--muted-text)]">
        Enter this product&apos;s marketplace ID so performance reports match automatically on first import.
      </p>
      <div className="mt-2 flex flex-col gap-2">
        {PERFORMANCE_MARKETPLACES.map((m) => {
          const field = fields[m]
          const isDirty = field.value.trim() !== (field.saved ?? '')
          return (
            <div key={m} className="flex items-center gap-2">
              <label htmlFor={`marketplace-id-${m}`} className="w-16 shrink-0 text-xs text-[var(--muted-text)]">
                {PERFORMANCE_MARKETPLACE_LABELS[m]}
              </label>
              <input
                id={`marketplace-id-${m}`}
                type="text"
                value={field.value}
                onChange={(e) =>
                  setFields((prev) => (prev ? { ...prev, [m]: { ...prev[m], value: e.target.value } } : prev))
                }
                placeholder={m === 'myntra' ? 'Style ID' : 'ASIN'}
                className={`${inputClass} py-1.5 text-xs flex-1`}
              />
              <button
                type="button"
                onClick={() => handleSave(m)}
                disabled={field.saving || !field.value.trim() || !isDirty}
                className={buttonSecondarySmallClass}
              >
                {field.saving ? 'Saving…' : field.saved && !isDirty ? 'Saved' : 'Save'}
              </button>
            </div>
          )
        })}
      </div>
      {PERFORMANCE_MARKETPLACES.some((m) => fields[m].error) && (
        <p className="mt-1 text-xs text-[var(--danger-text)]">
          {PERFORMANCE_MARKETPLACES.map((m) => fields[m].error).filter(Boolean)[0]}
        </p>
      )}
    </div>
  )
}
