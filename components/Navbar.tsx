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
    <nav className="border-b shadow-lg bg-[var(--card-bg)] border-[var(--card-border)]">
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
          {/* "Start Generating Listings" duplicated the hero CTA directly
              below it — this just needs to get a signed-in user back into
              the app (or a guest to /login), not sell the product again. */}
          <Link
            href={isLoggedIn ? '/workspace' : '/login'}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg shadow-blue-500/20 ring-1 ring-white/15 transition-colors whitespace-nowrap"
          >
            Sign In
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
