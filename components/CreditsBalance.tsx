"use client"

import { useEffect, useState } from 'react'

// Fired by any client component after an action that spends credits
// succeeds (see CatalogueWorkspace's generateForProduct and
// AccountReportDashboard's handleGenerate) — window-level rather than a
// prop, because AuditHeader and AccountReportDashboard are siblings under a
// server component (app/audit/page.tsx), not parent/child, so there's no
// prop path to thread a refresh signal through.
export const CREDITS_CHANGED_EVENT = 'credits:changed'

export function notifyCreditsChanged() {
  window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT))
}

// Rendered in TopHeader's usage slot on both /workspace and /audit — same
// shared balance either way. Badge styling matches the small status-pill
// pattern used elsewhere in the app (e.g. StatusBadge), not plain text, since
// it now sits in a prominent always-visible header position.
export default function CreditsBalance() {
  const [credits, setCredits] = useState<number | null>(null)

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
          // Balance display is non-critical — a failed fetch just leaves the
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

  if (credits === null) return null

  return (
    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border bg-[var(--secondary-btn-bg)] border-[var(--secondary-btn-border)] text-[var(--secondary-btn-text)] whitespace-nowrap">
      {`${credits} Credit${credits === 1 ? '' : 's'}`}
    </span>
  )
}
