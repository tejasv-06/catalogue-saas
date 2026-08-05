"use client"

import type { RefObject } from 'react'
import ClientSelector, { type Client } from '@/components/ClientSelector'
import { SUPPORTED_MARKETPLACES, MARKETPLACE_LABELS } from '@/lib/platformShapers'
import { selectClass } from '@/lib/uiClasses'

// Slim top bar for the right panel — logo, usage/credits, theme, and logout
// all live in AppSidebar now (shared with /audit). This keeps only what's
// actually specific to generating listings: which marketplace to shape
// output for, and which saved brand voice (if any) to apply. Sits directly
// on the page background, not inside a card.
export default function AppHeader({
  hasSession,
  targetMarketplace,
  onMarketplaceChange,
  marketplaceError,
  marketplaceFlash,
  marketplaceSelectRef,
  selectedClientId,
  onSelectClient
}: {
  hasSession: boolean
  targetMarketplace: string
  onMarketplaceChange: (value: string) => void
  marketplaceError: string | null
  marketplaceFlash: boolean
  marketplaceSelectRef: RefObject<HTMLSelectElement | null>
  selectedClientId: string
  onSelectClient: (client: Client | null) => void
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <div className="flex flex-col gap-1">
        <select
          ref={marketplaceSelectRef}
          value={targetMarketplace}
          onChange={(e) => onMarketplaceChange(e.target.value)}
          className={`${selectClass} ${
            marketplaceError ? `border-red-500 ring-2 ring-red-500 ${marketplaceFlash ? 'animate-pulse' : ''}` : ''
          }`}
        >
          <option value="" disabled>
            Select a marketplace
          </option>
          {SUPPORTED_MARKETPLACES.map((marketplace) => (
            <option key={marketplace} value={marketplace}>
              {MARKETPLACE_LABELS[marketplace]}
            </option>
          ))}
        </select>
        {marketplaceError && <p className="text-xs font-medium text-[var(--danger-link-text)]">{marketplaceError}</p>}
      </div>
      {hasSession && <ClientSelector selectedClientId={selectedClientId} onSelectClient={onSelectClient} />}
    </div>
  )
}
