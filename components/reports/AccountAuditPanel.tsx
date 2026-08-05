"use client"

import { useState, type ChangeEvent } from 'react'
import Papa from 'papaparse'
import { computeAccountReportStats, type AccountReportStats } from '@/lib/accountReportStats'
import AccountReportDashboard from '@/components/reports/AccountReportDashboard'
import { buttonPrimaryClass, cardClass, bodyTextClass, dangerBannerClass, dangerTextClass } from '@/lib/uiClasses'

export default function AccountAuditPanel() {
  const [stats, setStats] = useState<AccountReportStats | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setError(null)
    setFileName(file.name)

    const csvText = await file.text()
    const parsed = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true
    })

    if (parsed.data.length === 0) {
      setError('No rows found in this CSV.')
      setStats(null)
      return
    }

    setStats(computeAccountReportStats(parsed.data))
  }

  return (
    <div className="flex flex-col gap-6">
      <div className={`p-6 flex flex-col sm:flex-row sm:items-center gap-4 ${cardClass}`}>
        <label className={`inline-flex items-center justify-center shrink-0 cursor-pointer ${buttonPrimaryClass}`}>
          Upload CSV
          <input type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
        </label>
        <span className={bodyTextClass}>
          {fileName ??
            'Upload an Amazon "Detail Page Sales and Traffic by Child Item" CSV export to run the account audit.'}
        </span>
      </div>

      {error && (
        <div className={dangerBannerClass}>
          <p className={dangerTextClass}>{error}</p>
        </div>
      )}

      {stats && <AccountReportDashboard stats={stats} />}
    </div>
  )
}
