"use client"

import Link from 'next/link'
import Image from 'next/image'
import type { ReactNode } from 'react'
import ThemeToggle from '@/components/ThemeToggle'
import ProfileMenu from '@/components/ProfileMenu'

// Full-width bar spanning the entire top of the screen on /workspace and
// /audit: replaces the old scattered arrangement (logo/credits/theme/logout
// used to live split across AppHeader and AppSidebar). AppSidebar now only
// holds the four destinations; the slim marketplace/client-selector bar
// (still called AppHeader) is unrelated and unaffected, it's a contextual
// toolbar inside the right panel's content, not part of this header.
export default function TopHeader({ usageSlot }: { usageSlot: ReactNode }) {
  return (
    <header className="fixed top-0 left-0 right-0 h-16 z-50 flex items-center justify-between gap-4 px-4 sm:px-6 bg-[var(--card-bg)] border-b border-[var(--card-border)]">
      <Link href="/" className="flex items-center gap-2 shrink-0">
        <Image src="/logo.png" alt="" width={32} height={32} priority />
        <span className="hidden sm:inline font-bold text-[var(--heading-text)]">Tesolute</span>
      </Link>

      <div className="flex items-center gap-3">
        {usageSlot}
        <ThemeToggle />
        <ProfileMenu />
      </div>
    </header>
  )
}
