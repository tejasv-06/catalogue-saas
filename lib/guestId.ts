import { cookies } from 'next/headers'

export async function getOrCreateAnonId(): Promise<string> {
  const cookieStore = await cookies()
  let anonId = cookieStore.get('anon_id')?.value

  if (!anonId) {
    anonId = crypto.randomUUID()
    cookieStore.set('anon_id', anonId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/'
    })
  }

  return anonId
}
