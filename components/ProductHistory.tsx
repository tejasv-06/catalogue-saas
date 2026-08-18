"use client"

import { useEffect, useState } from 'react'
import { getProductHistory, describeProductHistoryEvent, type ProductHistoryEventRow } from '@/lib/productHistory'
import { labelClass } from '@/lib/uiClasses'

// Milestone C14 (Milestone 34): "PRODUCT -> PRODUCT EVENTS/HISTORY ->
// TIMELINE," mounted inside the existing product detail/review drawer
// (GeneratedListingDrawer in CatalogueWorkspace.tsx), never a new
// standalone navigation page. Self-contained: fetches getProductHistory
// itself on mount/when productId changes, so a failure here can never break
// the rest of the drawer: the only thing that can go wrong here is this
// component's own four states (loading/empty/error/loaded) below.
//
// Every label shown comes from lib/productHistory.ts's centralized
// describeProductHistoryEvent/EVENT_TYPE_LABELS: this file has no display
// strings of its own beyond the four UI-state sentences.

function formatEventTimestamp(iso: string): string {
  const date = new Date(iso)
  const datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${datePart} · ${timePart}`
}

type HistoryState =
  | { status: 'loading'; events: [] }
  | { status: 'loaded'; events: ProductHistoryEventRow[] }
  | { status: 'error'; events: [] }

export default function ProductHistory({ productId }: { productId: string | null | undefined }) {
  const [state, setState] = useState<HistoryState>({ status: 'loading', events: [] })

  useEffect(() => {
    if (!productId) return

    let cancelled = false
    setState({ status: 'loading', events: [] })

    getProductHistory(productId)
      .then((events) => {
        if (!cancelled) setState({ status: 'loaded', events })
      })
      .catch((err: any) => {
        console.error(`ProductHistory: failed to load history for ${productId}:`, err?.message ?? err)
        if (!cancelled) setState({ status: 'error', events: [] })
      })

    return () => {
      cancelled = true
    }
  }, [productId])

  return (
    <div className="mt-4 pt-4 border-t border-[var(--card-border)]">
      <p className={labelClass}>Product History</p>

      {!productId && (
        <p className="mt-1 text-xs text-[var(--muted-text)]">History is available once this product is saved.</p>
      )}

      {productId && state.status === 'loading' && (
        <div className="mt-2 flex flex-col gap-2" aria-busy="true" aria-label="Loading product history">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 rounded bg-[var(--skeleton-bg)] animate-pulse" />
          ))}
        </div>
      )}

      {productId && state.status === 'error' && (
        <p className="mt-1 text-xs text-[var(--danger-text)]">Unable to load product history.</p>
      )}

      {productId && state.status === 'loaded' && state.events.length === 0 && (
        <p className="mt-1 text-xs text-[var(--muted-text)]">No history yet.</p>
      )}

      {productId && state.status === 'loaded' && state.events.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2.5">
          {state.events.map((event) => {
            const display = describeProductHistoryEvent(event)
            return (
              <li key={event.id} className="text-sm">
                <p className="text-[var(--body-text)]">✓ {display.title}</p>
                {display.marketplaceLabel && <p className="text-xs text-[var(--muted-text)]">{display.marketplaceLabel}</p>}
                {display.sourceLabel && <p className="text-xs text-[var(--muted-text)]">{display.sourceLabel}</p>}
                <p className="text-xs text-[var(--muted-text)]">{formatEventTimestamp(event.created_at)}</p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
