import Image from 'next/image'
import Link from 'next/link'
import LogoutButton from '@/components/LogoutButton'
import ThemeToggle from '@/components/ThemeToggle'

// Same shell as AppHeader (workspace) — sits directly on the page background,
// not inside a card. Trimmed down: no marketplace/brand controls, since none
// of that applies to an account audit.
export default function AuditHeader() {
  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <Link
          href="/"
          className="text-sm text-[var(--muted-text)] hover:text-[var(--heading-text)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--page-bg)] focus:ring-blue-500/40 rounded transition-colors"
        >
          ← Back to Home
        </Link>
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="" width={40} height={40} priority />
          <span className="text-2xl font-bold text-[var(--heading-text)]">Account Audit & Insights</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <LogoutButton />
      </div>
    </div>
  )
}
