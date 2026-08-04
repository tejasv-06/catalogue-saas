import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AuditHeader from '@/components/reports/AuditHeader'
import AccountAuditPanel from '@/components/reports/AccountAuditPanel'

// Unlike /workspace (deliberately guest-accessible), this touches a seller's
// real revenue data — signed in only, no guest preview.
export default async function AuditPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  if (!data?.claims) {
    redirect('/login?next=/audit')
  }

  return (
    <div className="min-h-screen bg-[var(--page-bg)] text-[var(--body-text)]">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <AuditHeader />
        <AccountAuditPanel />
      </div>
    </div>
  )
}
