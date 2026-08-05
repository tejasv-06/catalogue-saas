'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { buttonSecondarySmallClass } from '@/lib/uiClasses'

function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

// 'menuItem' is the only variant actually in use right now — ProfileMenu's
// dropdown, the single logout control on the page (see TopHeader). 'button'
// is kept as the plain default for any future standalone placement, but
// nothing currently renders it.
export default function LogoutButton({ variant = 'button' }: { variant?: 'button' | 'menuItem' }) {
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  if (variant === 'menuItem') {
    return (
      <button
        onClick={handleLogout}
        role="menuitem"
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-left text-[var(--heading-text)] hover:bg-[var(--secondary-btn-bg-hover)] transition-colors"
      >
        <LogoutIcon />
        Log out
      </button>
    )
  }

  return (
    <button onClick={handleLogout} className={buttonSecondarySmallClass}>
      Log out
    </button>
  )
}
