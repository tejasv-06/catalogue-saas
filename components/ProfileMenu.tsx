"use client"

import { useEffect, useRef, useState } from 'react'
import LogoutButton from '@/components/LogoutButton'
import ExportHistoryModal from '@/components/ExportHistoryModal'

function HistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l4 2" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

// Avatar + dropdown in the top header: the only place a logout control
// renders now (see LogoutButton's menuItem variant). Plain click-toggle,
// no hover involved, matching MobileMenu's interaction pattern.
export default function ProfileMenu() {
  const [open, setOpen] = useState(false)
  const [showExportHistory, setShowExportHistory] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-1 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500/40"
      >
        <span className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0">
          <UserIcon />
        </span>
        <span className="text-[var(--muted-text)]">
          <ChevronDownIcon />
        </span>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 w-44 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-xl p-1 z-50">
          <button
            onClick={() => {
              setOpen(false)
              setShowExportHistory(true)
            }}
            role="menuitem"
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-left text-[var(--heading-text)] hover:bg-[var(--secondary-btn-bg-hover)] transition-colors"
          >
            <HistoryIcon />
            Export History
          </button>
          <div onClick={() => setOpen(false)}>
            <LogoutButton variant="menuItem" />
          </div>
        </div>
      )}

      {showExportHistory && <ExportHistoryModal onClose={() => setShowExportHistory(false)} />}
    </div>
  )
}
