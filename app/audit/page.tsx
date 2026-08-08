import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TopHeader from '@/components/TopHeader'
import AppSidebar from '@/components/AppSidebar'
import CreditsBalance from '@/components/CreditsBalance'
import AuditHeader from '@/components/reports/AuditHeader'
import AccountAuditPanel from '@/components/reports/AccountAuditPanel'

// Unlike /workspace (deliberately guest-accessible), this touches a seller's
// real revenue data — signed in only, no guest preview. This check runs
// first, before anything else renders, exactly as before — a direct visit
// while logged out still redirects server-side with no page flash,
// regardless of how TopHeader/AppSidebar below are laid out.
export default async function AuditPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  if (!data?.claims) {
    redirect('/login?next=/audit')
  }

  return (
    <div className="min-h-screen bg-[var(--page-bg)] text-[var(--body-text)]">
      {/* Always signed in past the check above, so the usage slot is always
          the real credit balance — no guest-preview branch needed here. */}
      <TopHeader usageSlot={<CreditsBalance />} />

      <div className="pt-16 h-screen flex flex-col">
        <AppSidebar>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 py-6">
              <AuditHeader />
              <AccountAuditPanel />
            </div>
          </div>
        </AppSidebar>
      </div>
    </div>
  )
}
