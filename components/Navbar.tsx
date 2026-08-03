import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function Navbar() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const isLoggedIn = !!data?.claims

  return (
    <nav className="border-b bg-white">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg">
          Tesolute
        </Link>
        <div className="flex items-center gap-6">
          <Link href="/" className="text-sm text-gray-600 hover:text-black">
            Home
          </Link>
          <Link href="/how-it-works" className="text-sm text-gray-600 hover:text-black">
            How It Works
          </Link>
          <Link href="/contact" className="text-sm text-gray-600 hover:text-black">
            Contact
          </Link>
          <Link
            href={isLoggedIn ? '/workspace' : '/login'}
            className="bg-black text-white px-4 py-2 rounded text-sm"
          >
            {isLoggedIn ? 'Go to Workspace' : 'Login'}
          </Link>
        </div>
      </div>
    </nav>
  )
}
