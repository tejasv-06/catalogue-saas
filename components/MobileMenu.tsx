"use client"

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { TOOLS } from '@/components/ToolsDropdown'

const menuLinkClass =
  'block px-3 py-2.5 rounded-lg text-sm font-medium text-[var(--heading-text)] hover:bg-[var(--secondary-btn-bg-hover)] transition-colors'

// Mirrors the desktop nav's navLinks in Navbar.tsx — same five anchors/
// routes, same order.
const navLinks = [
  { href: '/#product', label: 'Product' },
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/#for-brands', label: 'For Brands' },
  { href: '/#for-agencies', label: 'For Agencies' },
  { href: '/#pricing', label: 'Pricing' }
]

export default function MobileMenu({ isLoggedIn }: { isLoggedIn: boolean }) {
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
    <div ref={containerRef} className="relative lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={open ? 'Close menu' : 'Open menu'}
        className="w-9 h-9 flex items-center justify-center rounded-lg border border-[var(--card-border)] text-[var(--heading-text)] hover:bg-[var(--secondary-btn-bg-hover)] focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-colors"
      >
        {open ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] max-w-sm max-h-[calc(100vh-5rem)] overflow-y-auto rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-xl p-2 z-50"
        >
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)} role="menuitem" className={menuLinkClass}>
              {link.label}
            </Link>
          ))}

          <div className="my-1 border-t border-[var(--card-border)]" />

          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              onClick={() => setOpen(false)}
              role="menuitem"
              className="block px-3 py-2.5 rounded-lg hover:bg-[var(--secondary-btn-bg-hover)] transition-colors"
            >
              <div className="text-sm font-semibold text-[var(--heading-text)]">{tool.title}</div>
              <div className="text-xs text-[var(--muted-text)] mt-0.5">{tool.subtext}</div>
            </Link>
          ))}

          <div className="my-1 border-t border-[var(--card-border)]" />

          {/* Mirrors the desktop nav's session-aware CTA in Navbar.tsx — see
              that file for why guests get "Try Tesolute Free" pointed at
              /workspace instead of "Go to Workspace" or a /login wall. */}
          {!isLoggedIn && (
            <Link href="/login" onClick={() => setOpen(false)} role="menuitem" className={menuLinkClass}>
              Sign In
            </Link>
          )}
          <Link
            href="/workspace"
            onClick={() => setOpen(false)}
            role="menuitem"
            className="block mt-1 text-center bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
          >
            {isLoggedIn ? 'Go to Workspace' : 'Try Tesolute Free →'}
          </Link>
        </div>
      )}
    </div>
  )
}
