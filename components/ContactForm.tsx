'use client'

import { useState, type FormEvent } from 'react'

export default function ContactForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [submitted, setSubmitted] = useState(false)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // No backend wired up yet — this is a placeholder confirmation only.
    setSubmitted(true)
  }

  if (submitted) {
    return <p className="text-sm text-green-700">Thanks, we&apos;ll be in touch.</p>
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-md">
      <input
        type="text"
        required
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="border p-2 rounded"
      />
      <input
        type="email"
        required
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="border p-2 rounded"
      />
      <textarea
        required
        placeholder="Message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={5}
        className="border p-2 rounded"
      />
      <button type="submit" className="bg-black text-white p-2 rounded">
        Send
      </button>
    </form>
  )
}
