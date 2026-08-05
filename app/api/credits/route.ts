import { NextResponse } from 'next/server'
import { createClient as createAuthClient } from '@/lib/supabase/server'
import { getOrCreateCreditBalance } from '@/lib/credits'

// Used by the header/dashboard credits-balance display — signed-in users
// only, mirroring the guard on generate-account-insights and the credit
// check in generate-single.
export async function GET() {
  const authClient = await createAuthClient()
  const { data: authData } = await authClient.auth.getClaims()
  const userId = authData?.claims?.sub as string | undefined

  if (!userId) {
    return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  }

  try {
    const creditsRemaining = await getOrCreateCreditBalance(userId)
    return NextResponse.json({ creditsRemaining })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load credit balance' }, { status: 500 })
  }
}
