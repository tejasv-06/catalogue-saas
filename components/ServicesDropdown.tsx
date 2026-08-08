"use client"

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

// Exported so MobileMenu can render the same two services as a flat list
// instead of nesting a hover-dropdown inside a drawer, which doesn't
// translate well to touch.
export const SERVICES = [
  {
    href: '/workspace',
    title: 'AI Listing Generator',
    subtext: 'Generate marketplace-optimized titles, bullets, and descriptions instantly. 10 free generations included.'
  },
  {
    href: '/audit',
    title: 'Amazon Account Audit & Revenue Insights',
    subtext: 'Upload your seller traffic CSV to unlock a 30-day sales growth plan and revenue-leakage fixes.'
  }
]

export default function ServicesDropdown() {
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
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        // A real pointer click fires mouseenter (opening it) immediately
        // before the click event — a toggle here would immediately close
        // what hover just opened. Click just ensures it's open; outside
        // click, mouseleave, or Escape are what close it.
        onClick={() => setOpen(true)}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center gap-1 text-sm text-[var(--muted-text)] hover:text-[var(--heading-text)] transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 rounded"
      >
        Services
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        // The visual gap between trigger and panel used to be a `mt-2`
        // margin on the menu box itself — margin isn't part of the box for
        // hit-testing, so that 8px strip was dead space: moving the cursor
        // from the trigger straight down into it fired mouseleave on this
        // container (whose own hover box only wraps the trigger, since
        // absolutely-positioned descendants don't expand a relative
        // ancestor's flow height) and closed the menu before the cursor
        // ever reached it. Fix: push the gap inside this hoverable wrapper
        // as padding-top instead, so the wrapper's own box is flush against
        // the trigger with zero dead space, and the visible bordered menu
        // (the nested div) just renders lower inside it.
        <div className="absolute left-0 top-full w-80 pt-2 z-50">
          <div role="menu" className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-xl p-2">
            {SERVICES.map((service) => (
              <Link
                key={service.href}
                href={service.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-3 py-2.5 rounded-lg hover:bg-[var(--secondary-btn-bg-hover)] transition-colors"
              >
                <div className="text-sm font-semibold text-[var(--heading-text)]">{service.title}</div>
                <div className="text-xs text-[var(--muted-text)] mt-0.5">{service.subtext}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
