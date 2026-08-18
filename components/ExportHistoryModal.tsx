"use client"

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getExportHistory, type CatalogExportRow } from '@/lib/catalog'
import { MARKETPLACE_LABELS } from '@/lib/platformShapers'
import { useFocusTrap } from '@/lib/useFocusTrap'
import { cardClass, sectionHeadingClass, bodyTextClass, linkButtonClass, buttonPrimaryClass, dangerBannerClass, dangerTextClass } from '@/lib/uiClasses'

// Milestone 29 (C7): reuses the exact modal shell already established by
// ExportGateModal/ExportSummaryModal in CatalogueWorkspace.tsx (fixed
// inset-0 z-40 overlay + backdrop + useFocusTrap + cardClass panel) for
// visual consistency, without adding a new route or sidebar destination:
// per the milestone brief, this stays inside the existing /workspace
// architecture. Session-awareness is self-contained here (its own
// supabase.auth.getUser() check) rather than threaded through
// TopHeader/ProfileMenu props, since this is the only consumer that needs
// it and both of those are shared across /workspace and /audit.
type LoadState = 'checking' | 'guest' | 'loading' | 'loaded' | 'error'

export default function ExportHistoryModal({ onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, onClose)

  const [state, setState] = useState<LoadState>('checking')
  const [rows, setRows] = useState<CatalogExportRow[]>([])

  useEffect(() => {
    let cancelled = false

    async function load() {
      const supabase = createClient()
      const { data } = await supabase.auth.getUser()
      if (cancelled) return

      if (!data.user) {
        setState('guest')
        return
      }

      setState('loading')
      try {
        const history = await getExportHistory(supabase)
        if (cancelled) return
        setRows(history)
        setState('loaded')
      } catch {
        if (cancelled) return
        setState('error')
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Export history"
        className={`relative p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto focus:outline-none ${cardClass}`}
      >
        <h2 className={`${sectionHeadingClass} mb-3`}>Export History</h2>

        {state === 'checking' || state === 'loading' ? (
          <p className={bodyTextClass}>Loading export history…</p>
        ) : state === 'guest' ? (
          <>
            <p className={`${bodyTextClass} mb-4`}>Sign in to view your export history.</p>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className={linkButtonClass}>
                Close
              </button>
              <Link href="/login" onClick={onClose} className={buttonPrimaryClass}>
                Sign In
              </Link>
            </div>
          </>
        ) : state === 'error' ? (
          <>
            <div className={`mb-4 ${dangerBannerClass}`}>
              <p className={dangerTextClass}>Couldn&apos;t load export history. Please try again.</p>
            </div>
            <div className="flex justify-end">
              <button onClick={onClose} className={linkButtonClass}>
                Close
              </button>
            </div>
          </>
        ) : rows.length === 0 ? (
          <>
            <p className={`${bodyTextClass} mb-4`}>No exports yet. Exported listings will show up here.</p>
            <div className="flex justify-end">
              <button onClick={onClose} className={linkButtonClass}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <ul className="mb-4 flex flex-col gap-2">
              {rows.map((row) => (
                <li key={row.id} className="p-3 rounded-xl border border-[var(--row-border)] flex flex-col gap-0.5">
                  <div className="flex justify-between text-sm font-medium text-[var(--heading-text)]">
                    <span>{MARKETPLACE_LABELS[row.marketplace]}</span>
                    <span>{row.item_count} item{row.item_count === 1 ? '' : 's'}</span>
                  </div>
                  {row.file_name && <div className="text-xs text-[var(--muted-text)]">{row.file_name}</div>}
                  <div className="text-xs text-[var(--muted-text)]">{new Date(row.created_at).toLocaleString()}</div>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <button onClick={onClose} className={linkButtonClass}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
