'use client'

import { Suspense, useState, type SubmitEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { inputClass, buttonPrimaryClass, buttonSecondaryClass, cardClass } from '@/lib/uiClasses'

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
    <div className={`w-full max-w-sm p-6 flex flex-col gap-4 ${cardClass}`}>
      <h1 className="text-xl font-bold text-slate-100">Sign in</h1>

      {linkError && !sent && (
        <p className="text-sm text-red-400">That link is invalid or expired. Please request a new one.</p>
      )}

      {sent ? (
        <p className="text-sm text-green-400">Check your email — we sent a magic link to {email}.</p>
      ) : (
        <form onSubmit={handleSendMagicLink} className="flex flex-col gap-3">
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
          <button type="submit" disabled={sending} className={buttonPrimaryClass}>
            {sending ? 'Sending...' : 'Send Magic Link'}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      <div className="flex items-center gap-2 text-xs text-slate-500">
        <div className="flex-1 border-t border-slate-800" />
        or
        <div className="flex-1 border-t border-slate-800" />
      </div>

      <button onClick={handleGoogleSignIn} className={buttonSecondaryClass}>
        Continue with Google
      </button>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b1726] p-8">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
