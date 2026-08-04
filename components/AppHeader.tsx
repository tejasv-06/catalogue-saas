"use client"

import type { RefObject } from 'react'
import Image from 'next/image'
import LogoutButton from '@/components/LogoutButton'
import ClientSelector, { type Client } from '@/components/ClientSelector'
import { SUPPORTED_MARKETPLACES } from '@/lib/platformShapers'
import { selectClass } from '@/lib/uiClasses'

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
    return <span className="text-sm font-medium text-slate-200">{`${productCount}/${guestProductLimit} (free preview)`}</span>
  }

  // TODO(Milestone 34): swap for real per-account credits once usage-based
  // billing exists. Showing the honest in-session count in the meantime
  // rather than a fabricated number that isn't backed by anything real.
  return <span className="text-sm font-medium text-slate-200">{`Products in Session (${productCount})`}</span>
}

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
    <div className="bg-[#0f2942] rounded-xl p-4 shadow-sm mb-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <Image src="/logo.png" alt="" width={40} height={40} className="rounded-lg" priority />
        <span className="text-2xl font-bold text-white">Tesolute Workspace</span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
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
                  {marketplace}
                </option>
              ))}
            </select>
            <UsagePill hasSession={hasSession} productCount={productCount} guestProductLimit={guestProductLimit} />
          </div>
          {marketplaceError && <p className="text-xs font-medium text-red-300">{marketplaceError}</p>}
        </div>
        {hasSession && <ClientSelector selectedClientId={selectedClientId} onSelectClient={onSelectClient} />}
        <LogoutButton />
      </div>
    </div>
  )
}
