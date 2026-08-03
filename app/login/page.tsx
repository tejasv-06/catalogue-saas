'use client'

import { Suspense, useState, type SubmitEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function LoginForm() {
  const searchParams = useSearchParams()
  const linkError = searchParams.get('error') === 'auth'

  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSendMagicLink(e: SubmitEvent) {
    e.preventDefault()
    setSending(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=/workspace`
      }
    })

    setSending(false)

    if (error) {
      setError(error.message)
      return
    }

    setSent(true)
  }

  async function handleGoogleSignIn() {
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/confirm?next=/workspace`
      }
    })
    if (error) {
      setError(error.message)
    }
  }

  return (
    <div className="w-full max-w-sm border rounded p-6 bg-white flex flex-col gap-4">
      <h1 className="text-xl font-bold">Sign in</h1>

      {linkError && !sent && (
        <p className="text-sm text-red-600">That link is invalid or expired. Please request a new one.</p>
      )}

      {sent ? (
        <p className="text-sm text-green-700">Check your email — we sent a magic link to {email}.</p>
      ) : (
        <form onSubmit={handleSendMagicLink} className="flex flex-col gap-3">
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border p-2 rounded"
          />
          <button
            type="submit"
            disabled={sending}
            className="bg-black text-white p-2 rounded disabled:opacity-50"
          >
            {sending ? 'Sending...' : 'Send Magic Link'}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      )}

      <div className="flex items-center gap-2 text-xs text-gray-400">
        <div className="flex-1 border-t" />
        or
        <div className="flex-1 border-t" />
      </div>

      <button onClick={handleGoogleSignIn} className="border p-2 rounded text-sm">
        Continue with Google
      </button>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-8">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
