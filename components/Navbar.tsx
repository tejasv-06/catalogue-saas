import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'

export default async function Navbar() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const isLoggedIn = !!data?.claims

  return (
    <nav className="bg-[#113856] backdrop-blur-md border-b border-white/15 shadow-lg text-white">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.png" alt="" width={36} height={36} className="rounded-lg" priority />
          <span className="font-bold text-lg text-white">Tesolute</span>
        </Link>
        <div className="flex items-center gap-6">
          <Link href="/" className="text-sm text-white/90 hover:text-white transition-colors">
            Home
          </Link>
          <Link href="/how-it-works" className="text-sm text-white/90 hover:text-white transition-colors">
            How It Works
          </Link>
          <Link href="/contact" className="text-sm text-white/90 hover:text-white transition-colors">
            Contact
          </Link>
          <Link
            href={isLoggedIn ? '/workspace' : '/login'}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg shadow-blue-500/20 ring-1 ring-white/40 transition-colors"
          >
            {isLoggedIn ? 'Go to Workspace' : 'Login'}
          </Link>
        </div>
      </div>
    </nav>
  )
}
