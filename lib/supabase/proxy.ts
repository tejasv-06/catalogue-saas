import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        }
      }
    }
  )

  // Refreshes the session cookie if one exists, but no longer gates access —
  // /workspace is publicly viewable now. CatalogueWorkspace.tsx checks session
  // client-side purely to decide whether to show the Brand/Clients dropdown.
  const { data } = await supabase.auth.getClaims()

  // Guests get a first-party anonymous id cookie on their first /workspace visit,
  // used server-side only to enforce the guest generation rate limit.
  if (!data?.claims && !request.cookies.get('anon_id')) {
    supabaseResponse.cookies.set('anon_id', crypto.randomUUID(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/'
    })
  }

  return supabaseResponse
}
