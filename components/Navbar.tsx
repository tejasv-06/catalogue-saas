import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'
import ThemeToggle from '@/components/ThemeToggle'
import ToolsDropdown from '@/components/ToolsDropdown'
import MobileMenu from '@/components/MobileMenu'

// Product/For Brands/For Agencies/Pricing have no dedicated pages — they're
// anchors into sections on this same homepage (id= on those sections in
// app/page.tsx, including id="pricing" now that a real Pricing section
// exists there).
const navLinks = [
  { href: '/#product', label: 'Product' },
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/#for-brands', label: 'For Brands' },
  { href: '/#for-agencies', label: 'For Agencies' },
  { href: '/#pricing', label: 'Pricing' }
]

export default async function Navbar() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const isLoggedIn = !!data?.claims

  return (
    // sticky (not fixed) deliberately — it keeps its own height in normal
    // flow, so the pages that render this (/, /contact, /how-it-works)
    // don't need any compensating top padding the way a fixed header would
    // require; it only starts floating once the page scrolls past it.
    // bg/border are theme CSS vars with an added /80 opacity + backdrop-blur
    // for the glassmorphism effect, not a literal bg-slate-950/80 — that
    // hardcoded value is dark-only and would pair dark-mode text colors
    // with a near-black bar in the light theme (ThemeToggle exists for a
    // reason), same fix pattern as every other color in this build.
    <nav className="sticky top-0 z-50 w-full border-b shadow-lg bg-[var(--card-bg)]/80 backdrop-blur-md border-[var(--card-border)] transition-all duration-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Image src="/logo.png" alt="" width={36} height={36} priority />
          <span className="font-bold text-lg text-[var(--heading-text)]">Tesolute</span>
        </Link>

        {/* Full nav row, hidden below lg in favor of the hamburger drawer —
            six items plus a CTA no longer fits comfortably at md. */}
        <div className="hidden lg:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-[var(--muted-text)] hover:text-[var(--heading-text)] transition-colors whitespace-nowrap"
            >
              {link.label}
            </Link>
          ))}
          <ToolsDropdown />
        </div>

        <div className="hidden lg:flex items-center gap-3 shrink-0">
          <ThemeToggle />
          {/* A first-time visitor has never used the product — "Go to
              Workspace" would be a meaningless label to them, and /login
              forces a signup step before they've seen any value. Since
              /workspace is deliberately guest-accessible (free-preview
              credits), guests get "Try Tesolute Free" pointed straight at
              it instead, same destination a returning signed-in user's own
              "Go to Workspace" resolves to — just an honest label either
              way. A separate small "Sign In" stays available for anyone
              who already has an account. */}
          {!isLoggedIn && (
            <Link href="/login" className="text-sm text-[var(--muted-text)] hover:text-[var(--heading-text)] transition-colors whitespace-nowrap">
              Sign In
            </Link>
          )}
          <Link
            href="/workspace"
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg shadow-blue-500/20 ring-1 ring-white/15 transition-colors whitespace-nowrap"
          >
            {isLoggedIn ? 'Go to Workspace' : 'Try Tesolute Free →'}
          </Link>
        </div>

        {/* Mobile/tablet: theme toggle stays visible, everything else
            collapses into the hamburger drawer. */}
        <div className="flex items-center gap-2 lg:hidden">
          <ThemeToggle />
          <MobileMenu isLoggedIn={isLoggedIn} />
        </div>
      </div>
    </nav>
  )
}
