import { NextResponse } from 'next/server'
import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js'
import { createClient as createAuthClient } from '@/lib/supabase/server'
import { getOrCreateAnonId } from '@/lib/guestId'

const BUCKET = 'product-images'

// service_role key is read ONLY here, inside this server-only route file —
// same discipline as app/api/generate-single/route.ts.
function getSupabaseAdminClient() {
  return createSupabaseAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 })
    }

    const authClient = await createAuthClient()
    const { data: authData } = await authClient.auth.getClaims()
    const userId = authData?.claims?.sub as string | undefined

    // Every upload is namespaced under the uploader's own id (real user id if
    // signed in, anon_id cookie if a guest) with a random filename — this is what
    // actually prevents one guest session from reading/overwriting another's
    // files, since all writes go through this server route using the service_role
    // key (bypassing RLS), never directly from the browser with the anon key.
    const ownerId = userId || (await getOrCreateAnonId())
    const extension = file.name.split('.').pop() || 'jpg'
    const path = `${ownerId}/${crypto.randomUUID()}.${extension}`

    const admin = getSupabaseAdminClient()
    const arrayBuffer = await file.arrayBuffer()

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, arrayBuffer, { contentType: file.type || 'image/jpeg' })

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    const { data: publicUrlData } = admin.storage.from(BUCKET).getPublicUrl(path)

    return NextResponse.json({ url: publicUrlData.publicUrl })
  } catch (err: any) {
    // Catches anything that throws synchronously before a response is built
    // (e.g. getSupabaseAdminClient() failing when SUPABASE_SERVICE_ROLE_KEY is
    // missing) — without this, the route crashes with an empty body and the
    // client's res.json() fails with a confusing "Unexpected end of JSON input"
    // that hides the real error.
    return NextResponse.json({ error: err.message || 'Image upload failed' }, { status: 500 })
  }
}
