"use client"

import { useRef, useState } from 'react'
import { useFocusTrap } from '@/lib/useFocusTrap'
import { CREDIT_PACKAGE_IDS, CREDIT_PACKAGES, type CreditPackageId } from '@/lib/creditPackages'
import { cardClass, sectionHeadingClass, bodyTextClass, buttonPrimaryClass, linkButtonClass, dangerBannerClass, dangerTextClass } from '@/lib/uiClasses'

// Milestone C13: package selection + checkout initiation. Reuses the
// established modal shell (fixed inset-0 z-40 overlay + backdrop +
// useFocusTrap + cardClass panel), same convention as every other modal in
// this app. lib/creditPackages.ts has no secrets and no env reads, so it's
// safe to import directly here: this is display data only; the actual
// credit/price resolution the payment depends on happens again, from the
// same file, server-side in app/api/billing/create-checkout/route.ts,
// never trusted from this component's own copy of the numbers.
export default function BuyCreditsModal({ onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, onClose)

  const [pendingPackage, setPendingPackage] = useState<CreditPackageId | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleBuy(packageId: CreditPackageId) {
    setPendingPackage(packageId)
    setError(null)
    try {
      const res = await fetch('/api/billing/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || 'Could not start checkout')
      }
      // Full-page redirect to Stripe Checkout: no local credit increment
      // happens anywhere in this flow, before or after this point.
      window.location.href = data.url
    } catch (err: any) {
      setError(err?.message || 'Could not start checkout. Please try again.')
      setPendingPackage(null)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Buy credits"
        className={`relative p-6 max-w-sm w-full mx-4 focus:outline-none ${cardClass}`}
      >
        <h2 className={`${sectionHeadingClass} mb-3`}>Buy Credits</h2>
        <p className={`${bodyTextClass} mb-4`}>Choose a credit package. You'll complete payment securely on Stripe.</p>

        <div className="flex flex-col gap-2 mb-4">
          {CREDIT_PACKAGE_IDS.map((id) => {
            const pkg = CREDIT_PACKAGES[id]
            const isPending = pendingPackage === id
            return (
              <button
                key={id}
                onClick={() => handleBuy(id)}
                disabled={pendingPackage !== null}
                className="flex items-center justify-between p-3 rounded-xl border border-[var(--card-border)] hover:bg-[var(--secondary-btn-bg-hover)] disabled:cursor-not-allowed disabled:opacity-60 text-left transition"
              >
                <span>
                  <span className="block text-sm font-medium text-[var(--heading-text)]">{pkg.label}</span>
                  <span className="block text-xs text-[var(--muted-text)]">${(pkg.unitAmount / 100).toFixed(2)}</span>
                </span>
                <span className="text-sm text-[var(--link-text)]">{isPending ? 'Redirecting…' : 'Buy'}</span>
              </button>
            )
          })}
        </div>

        {error && (
          <div className={`mb-4 ${dangerBannerClass}`}>
            <p className={dangerTextClass}>{error}</p>
          </div>
        )}

        <div className="flex justify-end">
          <button onClick={onClose} disabled={pendingPackage !== null} className={linkButtonClass}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
