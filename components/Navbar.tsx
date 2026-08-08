import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'
import ThemeToggle from '@/components/ThemeToggle'
import ServicesDropdown from '@/components/ServicesDropdown'
import MobileMenu from '@/components/MobileMenu'

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
    // for the glassmorphism effect, not the literal bg-slate-950/80 asked
    // for — that hardcoded value is dark-only and would pair dark-mode text
    // colors with a near-black bar in the light theme (ThemeToggle exists
    // for a reason), same fix pattern as every other color in this build.
    <nav className="sticky top-0 z-50 w-full border-b shadow-lg bg-[var(--card-bg)]/80 backdrop-blur-md border-[var(--card-border)] transition-all duration-200">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Image src="/logo.png" alt="" width={36} height={36} priority />
          <span className="font-bold text-lg text-[var(--heading-text)]">Tesolute</span>
        </Link>

        {/* Full nav row, hidden below md in favor of the hamburger drawer */}
        <div className="hidden md:flex items-center gap-6">
          <Link href="/" className="text-sm text-[var(--muted-text)] hover:text-[var(--heading-text)] transition-colors">
            Home
          </Link>
          <ServicesDropdown />
          <Link href="/how-it-works" className="text-sm text-[var(--muted-text)] hover:text-[var(--heading-text)] transition-colors">
            How It Works
          </Link>
          <Link href="/contact" className="text-sm text-[var(--muted-text)] hover:text-[var(--heading-text)] transition-colors">
            Contact
          </Link>
          <ThemeToggle />
          {/* Session-aware in both label and destination: a signed-in user
              gets routed straight back into the app ("Go to Workspace"), a
              guest gets the actual login page ("Sign In") — neither state
              should ever say "Sign In" while linking to /workspace, or vice
              versa. */}
          <Link
            href={isLoggedIn ? '/workspace' : '/login'}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg shadow-blue-500/20 ring-1 ring-white/15 transition-colors whitespace-nowrap"
          >
            {isLoggedIn ? 'Go to Workspace' : 'Sign In'}
          </Link>
        </div>

        {/* Mobile: theme toggle stays visible, everything else collapses
            into the hamburger drawer. */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <MobileMenu isLoggedIn={isLoggedIn} />
        </div>
      </div>
    </nav>
  )
}
