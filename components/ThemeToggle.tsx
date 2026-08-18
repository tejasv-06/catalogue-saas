"use client"

import { useEffect, useState } from 'react'

export default function ThemeToggle() {
  // Starts false (dark) to match the server-rendered markup, then syncs to
  // whatever the no-FOUC script in layout.tsx already set on <html> before
  // paint: avoids a hydration mismatch between server and client render.
  const [isLight, setIsLight] = useState(false)

  useEffect(() => {
    setIsLight(document.documentElement.getAttribute('data-theme') === 'light')
  }, [])

  function toggleTheme() {
    const next = !isLight
    setIsLight(next)
    if (next) {
      document.documentElement.setAttribute('data-theme', 'light')
      localStorage.setItem('theme', 'light')
    } else {
      document.documentElement.removeAttribute('data-theme')
      localStorage.setItem('theme', 'dark')
    }
  }

  return (
    <button
      onClick={toggleTheme}
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      className="w-9 h-9 flex items-center justify-center rounded-lg border border-[var(--card-border)] text-[var(--heading-text)] hover:bg-[var(--secondary-btn-bg-hover)] focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
    >
      {isLight ? (
        // Moon: shown in light mode, click to go dark.
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        </svg>
      ) : (
        // Sun: shown in dark mode, click to go light.
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      )}
    </button>
  )
}
