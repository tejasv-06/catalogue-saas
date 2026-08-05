"use client"

import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react'

const OTP_LENGTH = 6

// Six separate boxes rather than one text field — the standard OTP pattern,
// and what lets each digit auto-advance focus as it's typed. Paste of a full
// code (from a password manager or copied out of the email) still works,
// distributing across all six boxes from whichever one was focused.
export default function OtpPinInput({
  value,
  onChange,
  autoFocus,
  disabled
}: {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
  disabled?: boolean
}) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  function setDigitAt(index: number, digit: string) {
    const digits = value.padEnd(OTP_LENGTH, ' ').split('')
    digits[index] = digit
    onChange(digits.join('').trimEnd())
  }

  function handleChange(index: number, raw: string) {
    const digit = raw.replace(/\D/g, '').slice(-1)
    setDigitAt(index, digit)
    if (digit && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !value[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH)
    if (!pasted) return
    onChange(pasted)
    inputRefs.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus()
  }

  return (
    <div className="flex gap-2 justify-between" role="group" aria-label="6-digit verification code">
      {Array.from({ length: OTP_LENGTH }).map((_, index) => (
        <input
          key={index}
          ref={(el) => {
            inputRefs.current[index] = el
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          autoFocus={autoFocus && index === 0}
          disabled={disabled}
          value={value[index] ?? ''}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          aria-label={`Digit ${index + 1} of 6`}
          className="w-full aspect-square max-w-12 text-center text-lg font-semibold bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--heading-text)] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 disabled:opacity-50 transition"
        />
      ))}
    </div>
  )
}
