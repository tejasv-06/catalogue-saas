import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'

export default async function Navbar() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const isLoggedIn = !!data?.claims

  return (
    <nav className="bg-[#0f2942]">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.png" alt="" width={36} height={36} className="rounded-lg" priority />
          <span className="font-bold text-lg text-white">Tesolute</span>
        </Link>
        <div className="flex items-center gap-6">
          <Link href="/" className="text-sm text-slate-300 hover:text-white transition-colors">
            Home
          </Link>
          <Link href="/how-it-works" className="text-sm text-slate-300 hover:text-white transition-colors">
            How It Works
          </Link>
          <Link href="/contact" className="text-sm text-slate-300 hover:text-white transition-colors">
            Contact
          </Link>
          <Link
            href={isLoggedIn ? '/workspace' : '/login'}
            className="bg-[#2563eb] hover:bg-[#1d4ed8] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {isLoggedIn ? 'Go to Workspace' : 'Login'}
          </Link>
        </div>
      </div>
    </nav>
  )
}
