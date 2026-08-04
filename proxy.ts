import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

export async function proxy(request: NextRequest) {
  // Supabase falls back to redirecting to the dashboard's Site URL (landing
  // here on "/") instead of /auth/confirm whenever the exact callback URL
  // isn't in the Redirect URLs allow-list — the auth code then lands on the
  // home page, which has no code-exchange logic, and the visitor is silently
  // never signed in. Recovering here means the sign-in flow doesn't depend
  // on that dashboard config being correct.
  if (request.nextUrl.pathname === '/' && request.nextUrl.searchParams.has('code')) {
    const redirectUrl = new URL('/auth/confirm', request.url)
    redirectUrl.search = request.nextUrl.search
    if (!redirectUrl.searchParams.has('next')) {
      redirectUrl.searchParams.set('next', '/workspace')
    }
    return NextResponse.redirect(redirectUrl)
  }

  return updateSession(request)
}

export const config = {
  matcher: ['/workspace/:path*', '/audit/:path*', '/']
}
