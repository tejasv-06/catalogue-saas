import { NextResponse } from 'next/server'
import { createClient as createAuthClient } from '@/lib/supabase/server'
import { getPurchaseByCheckoutSessionId } from '@/lib/purchases'

// Milestone C13: GET /api/billing/purchase-status?session_id=...
//
// Read-only, authenticated. Lets the success-page UI show the REAL
// fulfillment state (pending/paid/fulfilled/failed/cancelled) instead of
// guessing from a query-string redirect or a blind timeout: the browser
// never gets to assert "I have credits now," it can only ask "what does
// the server say happened," and even that requires being the purchase's
// own owner.
export async function GET(request: Request) {
  const authClient = await createAuthClient()
  const { data: authData } = await authClient.auth.getClaims()
  const userId = authData?.claims?.sub as string | undefined

  if (!userId) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const sessionId = new URL(request.url).searchParams.get('session_id')
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing session_id' }, { status: 400 })
  }

  try {
    const purchase = await getPurchaseByCheckoutSessionId(sessionId)

    // Same "not found and not yours" collapse used everywhere else in this
    // app's ownership checks (e.g. lib/catalog.ts's getProductById): never
    // reveal whether a session id belongs to someone else.
    if (!purchase || purchase.user_id !== userId) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })
    }

    return NextResponse.json({ status: purchase.status, credits: purchase.credits })
  } catch (err: any) {
    console.error('purchase-status: failed to load purchase:', err?.message ?? err)
    return NextResponse.json({ error: 'Could not load purchase status' }, { status: 500 })
  }
}
