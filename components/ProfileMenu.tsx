"use client"

import { useEffect, useRef, useState } from 'react'
import LogoutButton from '@/components/LogoutButton'

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

// Avatar + dropdown in the top header — the only place a logout control
// renders now (see LogoutButton's menuItem variant). Plain click-toggle,
// no hover involved, matching MobileMenu's interaction pattern.
export default function ProfileMenu() {
  const [open, setOpen] = useState(false)
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
        <div role="menu" className="absolute right-0 top-full mt-2 w-40 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-xl p-1 z-50">
          <div onClick={() => setOpen(false)}>
            <LogoutButton variant="menuItem" />
          </div>
        </div>
      )}
    </div>
  )
}
