"use client"

import type { RefObject } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import LogoutButton from '@/components/LogoutButton'
import ClientSelector, { type Client } from '@/components/ClientSelector'
import ThemeToggle from '@/components/ThemeToggle'
import { SUPPORTED_MARKETPLACES, MARKETPLACE_LABELS } from '@/lib/platformShapers'
import { selectClass } from '@/lib/uiClasses'

// Uses var(--card-border) rather than Tailwind's dark: variant — this app's
// theme is an explicit data-theme toggle (see globals.css), not OS-driven,
// and dark: isn't wired to that attribute, so every other themed element
// here reads the same CSS vars to stay in sync with the toggle.
const dividerClass = 'border-l border-[var(--card-border)] h-5 mx-2'

function UsagePill({
  hasSession,
  productCount,
  guestProductLimit
}: {
  hasSession: boolean
  productCount: number
  guestProductLimit: number
}) {
  if (!hasSession) {
    return (
      <span className="text-sm font-medium text-[var(--muted-text)]">{`${productCount}/${guestProductLimit} (free preview)`}</span>
    )
  }

  // TODO(Milestone 34): swap for real per-account credits once usage-based
  // billing exists. Showing the honest in-session count in the meantime
  // rather than a fabricated number that isn't backed by anything real.
  return <span className="text-sm font-medium text-[var(--muted-text)]">{`Products in Session (${productCount})`}</span>
}

// Sits directly on the page background, not inside a card — a persistent
// top bar rather than another elevated panel, per the layout spec.
export default function AppHeader({
  hasSession,
  targetMarketplace,
  onMarketplaceChange,
  marketplaceError,
  marketplaceFlash,
  marketplaceSelectRef,
  productCount,
  guestProductLimit,
  selectedClientId,
  onSelectClient
}: {
  hasSession: boolean
  targetMarketplace: string
  onMarketplaceChange: (value: string) => void
  marketplaceError: string | null
  marketplaceFlash: boolean
  marketplaceSelectRef: RefObject<HTMLSelectElement | null>
  productCount: number
  guestProductLimit: number
  selectedClientId: string
  onSelectClient: (client: Client | null) => void
}) {
  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <Link
          href="/"
          className="text-sm text-[var(--muted-text)] hover:text-[var(--heading-text)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--page-bg)] focus:ring-blue-500/40 rounded transition-colors"
        >
          ← Back to Home
        </Link>
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="" width={40} height={40} priority />
          <span className="text-2xl font-bold text-[var(--heading-text)]">Tesolute Workspace</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <select
                ref={marketplaceSelectRef}
                value={targetMarketplace}
                onChange={(e) => onMarketplaceChange(e.target.value)}
                className={`${selectClass} ${
                  marketplaceError
                    ? `border-red-500 ring-2 ring-red-500 ${marketplaceFlash ? 'animate-pulse' : ''}`
                    : ''
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
              <UsagePill hasSession={hasSession} productCount={productCount} guestProductLimit={guestProductLimit} />
            </div>
            {marketplaceError && <p className="text-xs font-medium text-[var(--danger-link-text)]">{marketplaceError}</p>}
          </div>
          {hasSession && <ClientSelector selectedClientId={selectedClientId} onSelectClient={onSelectClient} />}
        </div>

        <div className={dividerClass} />

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LogoutButton />
        </div>
      </div>
    </div>
  )
}
