'use client'

import { Suspense, useState, type SubmitEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { inputClass, buttonPrimaryClass, buttonSecondaryClass, cardClass } from '@/lib/uiClasses'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const linkError = searchParams.get('error') === 'auth'

  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSendCode(e: SubmitEvent) {
    e.preventDefault()
    setSending(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({ email })

    setSending(false)

    if (error) {
      setError(error.message)
      return
    }

    setStep('code')
  }

  async function handleVerifyCode(e: SubmitEvent) {
    e.preventDefault()
    setVerifying(true)
    setError(null)

    // Strip anything that isn't a digit — a pasted code commonly picks up
    // stray whitespace/newlines from the email, which would otherwise make
    // an exact-match token comparison fail silently-looking.
    const cleanedCode = code.replace(/\D/g, '')

    const supabase = createClient()
    const { error } = await supabase.auth.verifyOtp({ email, token: cleanedCode, type: 'email' })

    setVerifying(false)

    if (error) {
      setError(error.message)
      return
    }

    router.push('/workspace')
    router.refresh()
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

      {linkError && (
        <p className="text-sm text-red-400">That sign-in attempt is invalid or expired. Please try again.</p>
      )}

      {step === 'email' ? (
        <form onSubmit={handleSendCode} className="flex flex-col gap-3">
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
          <button type="submit" disabled={sending} className={buttonPrimaryClass}>
            {sending ? 'Sending...' : 'Send Code'}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </form>
      ) : (
        <form onSubmit={handleVerifyCode} className="flex flex-col gap-3">
          <p className="text-sm text-slate-300">Enter the code we sent to {email}.</p>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            required
            placeholder="Enter code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={inputClass}
            autoFocus
          />
          <button type="submit" disabled={verifying} className={buttonPrimaryClass}>
            {verifying ? 'Verifying...' : 'Verify Code'}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep('email')
              setCode('')
              setError(null)
            }}
            className={buttonSecondaryClass}
          >
            Use a different email
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
