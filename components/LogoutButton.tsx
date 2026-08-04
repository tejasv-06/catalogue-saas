'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LogoutButton() {
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  // Only ever rendered inside AppHeader's navy bar — light-on-dark instead of
  // linkButtonClass's slate-on-white treatment, which would be unreadable here.
  return (
    <button
      onClick={handleLogout}
      className="text-sm text-slate-300 underline hover:text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0f2942] focus:ring-white/70 rounded transition-colors"
    >
      Log out
    </button>
  )
}
