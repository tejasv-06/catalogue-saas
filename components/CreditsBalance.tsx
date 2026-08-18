"use client"

import { useEffect, useState } from 'react'
import BuyCreditsModal from '@/components/BuyCreditsModal'

// Fired by any client component after an action that spends credits
// succeeds (see CatalogueWorkspace's generateForProduct and
// AccountReportDashboard's handleGenerate): window-level rather than a
// prop, because AuditHeader and AccountReportDashboard are siblings under a
// server component (app/audit/page.tsx), not parent/child, so there's no
// prop path to thread a refresh signal through.
export const CREDITS_CHANGED_EVENT = 'credits:changed'

export function notifyCreditsChanged() {
  window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT))
}

// Milestone C13: polls the real purchase-status endpoint after a Stripe
// Checkout redirect, never trusting the redirect itself. `?checkout=
// success&session_id=...` only means "the browser came back from Stripe,"
// not "credits were awarded": award_purchase_credits() (the webhook's own
// atomic RPC) is the only actual authority, and this polls exactly that
// fact via GET /api/billing/purchase-status, which reads the same
// server-side purchase row the webhook writes to. Stops polling once the
// purchase reaches 'fulfilled' (or a terminal failure state), and cleans
// the query string off the URL either way so reloading never re-shows a
// stale "processing" banner for a purchase that finished (or failed) long
// ago.
function useCheckoutStatusBanner(onFulfilled: () => void): { message: string | null; tone: 'processing' | 'success' | 'error' } | null {
  const [banner, setBanner] = useState<{ message: string | null; tone: 'processing' | 'success' | 'error' } | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const checkout = params.get('checkout')
    const sessionId = params.get('session_id')

    if (checkout === 'cancel') {
      setBanner({ message: 'Checkout cancelled: no charge was made.', tone: 'error' })
      window.history.replaceState(null, '', window.location.pathname)
      return
    }

    if (checkout !== 'success' || !sessionId) return

    let cancelled = false
    let attempts = 0
    const maxAttempts = 10 // ~20s at 2s intervals: webhook fulfillment is normally within a couple seconds

    setBanner({ message: 'Payment received: processing your credits…', tone: 'processing' })
    window.history.replaceState(null, '', window.location.pathname)

    async function poll() {
      attempts++
      try {
        const res = await fetch(`/api/billing/purchase-status?session_id=${encodeURIComponent(sessionId!)}`)
        const data = await res.json().catch(() => null)
        if (cancelled) return

        if (res.ok && data?.status === 'fulfilled') {
          setBanner({ message: 'Credits added to your account.', tone: 'success' })
          onFulfilled()
          return
        }
        if (res.ok && (data?.status === 'failed' || data?.status === 'cancelled')) {
          setBanner({ message: 'Payment was not completed: no credits were added.', tone: 'error' })
          return
        }
      } catch {
        // Transient fetch failure: just retry on the next tick below.
      }

      if (!cancelled && attempts < maxAttempts) {
        setTimeout(poll, 2000)
      } else if (!cancelled) {
        setBanner({ message: 'Still processing: your balance will update shortly.', tone: 'processing' })
      }
    }

    poll()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return banner
}

// Rendered in TopHeader's usage slot on both /workspace and /audit: same
// shared balance either way. Badge styling matches the small status-pill
// pattern used elsewhere in the app (e.g. StatusBadge), not plain text, since
// it now sits in a prominent always-visible header position.
export default function CreditsBalance() {
  const [credits, setCredits] = useState<number | null>(null)
  const [showBuyCredits, setShowBuyCredits] = useState(false)

  useEffect(() => {
    let cancelled = false

    function load() {
      fetch('/api/credits')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!cancelled && data && typeof data.creditsRemaining === 'number') {
            setCredits(data.creditsRemaining)
          }
        })
        .catch(() => {
          // Balance display is non-critical: a failed fetch just leaves the
          // pill blank rather than surfacing an error in the header.
        })
    }

    load()
    window.addEventListener(CREDITS_CHANGED_EVENT, load)
    return () => {
      cancelled = true
      window.removeEventListener(CREDITS_CHANGED_EVENT, load)
    }
  }, [])

  const banner = useCheckoutStatusBanner(notifyCreditsChanged)

  return (
    <div className="flex items-center gap-2">
      {credits !== null && (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border bg-[var(--secondary-btn-bg)] border-[var(--secondary-btn-border)] text-[var(--secondary-btn-text)] whitespace-nowrap">
          {`${credits} Credit${credits === 1 ? '' : 's'}`}
        </span>
      )}
      <button
        type="button"
        onClick={() => setShowBuyCredits(true)}
        className="text-xs font-medium text-[var(--link-text)] underline hover:text-[var(--link-text-hover)] whitespace-nowrap"
      >
        Buy Credits
      </button>

      {banner?.message && (
        <span
          className={`text-xs whitespace-nowrap ${
            banner.tone === 'success'
              ? 'text-[var(--success-text)]'
              : banner.tone === 'error'
                ? 'text-[var(--danger-text)]'
                : 'text-[var(--muted-text)]'
          }`}
        >
          {banner.message}
        </span>
      )}

      {showBuyCredits && <BuyCreditsModal onClose={() => setShowBuyCredits(false)} />}
    </div>
  )
}
