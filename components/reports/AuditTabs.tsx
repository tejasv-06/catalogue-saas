"use client"

import { useState } from 'react'
import AccountAuditPanel from '@/components/reports/AccountAuditPanel'
import PerformanceIntelligencePanel from '@/components/reports/PerformanceIntelligencePanel'
import { buttonPrimarySmallClass, buttonSecondarySmallClass } from '@/lib/uiClasses'

// Milestone C15: a tab strip inside the EXISTING /audit page (Account
// Audit's own established home for report-upload tools), not a new
// top-level navigation entry (§12/§24). AccountAuditPanel itself is
// completely untouched: this only adds a sibling tab.
type Tab = 'account-audit' | 'performance'

export default function AuditTabs() {
  const [tab, setTab] = useState<Tab>('account-audit')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('account-audit')}
          className={tab === 'account-audit' ? buttonPrimarySmallClass : buttonSecondarySmallClass}
        >
          Account Audit
        </button>
        <button
          type="button"
          onClick={() => setTab('performance')}
          className={tab === 'performance' ? buttonPrimarySmallClass : buttonSecondarySmallClass}
        >
          Performance Reports
        </button>
      </div>

      {tab === 'account-audit' && <AccountAuditPanel />}
      {tab === 'performance' && <PerformanceIntelligencePanel />}
    </div>
  )
}
