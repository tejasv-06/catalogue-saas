import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const rawNext = searchParams.get('next')
  // Only accept a same-origin relative path — reject absolute/protocol-relative
  // URLs (e.g. "//evil.com") so this can't be used as an open redirect.
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/workspace'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url))
    }
    // Was silently swallowed before — logging it is the only way to tell
    // "code already used" (link scanners, double-clicks) apart from an
    // actual expired/invalid code without guessing.
    console.error('exchangeCodeForSession failed:', error.message)
  }

  return NextResponse.redirect(new URL('/login?error=auth', request.url))
}
