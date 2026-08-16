"use client"

import type { RefObject } from 'react'
import ClientSelector, { type Client } from '@/components/ClientSelector'
import { SUPPORTED_MARKETPLACES, MARKETPLACE_LABELS } from '@/lib/platformShapers'
import type { Marketplace } from '@/lib/types'
import { labelClass, linkButtonClass } from '@/lib/uiClasses'

// Slim top bar for the right panel — logo, usage/credits, theme, and logout
// all live in AppSidebar now (shared with /audit). This keeps only what's
// actually specific to generating listings: which marketplace(s) to shape
// output for (now multi-select — a product can be generated for several at
// once), and which saved brand voice (if any) to apply. Sits directly on
// the page background, not inside a card.
export default function AppHeader({
  hasSession,
  selectedMarketplaces,
  onToggleMarketplace,
  marketplaceError,
  marketplaceFlash,
  marketplaceGroupRef,
  selectedClientId,
  onSelectClient,
  onOpenBrandProfile
}: {
  hasSession: boolean
  selectedMarketplaces: Marketplace[]
  onToggleMarketplace: (marketplace: Marketplace) => void
  marketplaceError: string | null
  marketplaceFlash: boolean
  marketplaceGroupRef: RefObject<HTMLDivElement | null>
  selectedClientId: string
  onSelectClient: (client: Client | null) => void
  // Milestone C12 — only ever called for an already-selected brand; the
  // button below doesn't render at all otherwise, so this is never invoked
  // with no active brand.
  onOpenBrandProfile: () => void
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-6">
      <div className="flex flex-col gap-1">
        <p className={labelClass}>Target Marketplaces</p>
        <div
          ref={marketplaceGroupRef}
          tabIndex={-1}
          role="group"
          aria-label="Target marketplaces"
          className={`flex flex-wrap gap-2 rounded-xl focus:outline-none ${
            marketplaceError ? `ring-2 ring-red-500 ${marketplaceFlash ? 'animate-pulse' : ''}` : ''
          }`}
        >
          {SUPPORTED_MARKETPLACES.map((marketplace) => {
            const isSelected = selectedMarketplaces.includes(marketplace)
            return (
              <button
                key={marketplace}
                type="button"
                onClick={() => onToggleMarketplace(marketplace)}
                aria-pressed={isSelected}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--page-bg)] focus:ring-blue-500 ${
                  isSelected
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--heading-text)] hover:bg-[var(--secondary-btn-bg-hover)]'
                }`}
              >
                {MARKETPLACE_LABELS[marketplace]}
              </button>
            )
          })}
        </div>
        {marketplaceError && <p className="text-xs font-medium text-[var(--danger-link-text)]">{marketplaceError}</p>}
      </div>
      {hasSession && (
        <div className="flex flex-col gap-1">
          <p className={labelClass}>Brand Voice</p>
          <div className="flex items-center gap-3">
            <ClientSelector selectedClientId={selectedClientId} onSelectClient={onSelectClient} />
            {/* Milestone C12 — only shown once a real brand is active, so
                "which brand is active" is never ambiguous: the button
                itself names it. */}
            {selectedClientId && (
              <button type="button" onClick={onOpenBrandProfile} className={linkButtonClass}>
                Edit Brand Profile
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
