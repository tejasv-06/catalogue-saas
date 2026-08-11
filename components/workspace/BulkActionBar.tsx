"use client"

import { buttonPrimaryClass, buttonSecondaryClass, linkButtonClass, cardClass } from '@/lib/uiClasses'

// Milestone C14 — the bulk operations bar for the current selection. Every
// action here is an ORCHESTRATION of an already-existing, already-tested
// per-item operation (Analyze -> the same /api/enrich-product call
// handleAnalyzeProduct already makes, Generate -> the same
// generateForProductMarketplace loop handleGenerateAll already runs,
// Approve -> the same handleApproveMarketplace write, Export -> the same
// C11 readiness-gated performExport) — this component only presents the
// buttons and the current selection/progress; none of the actual business
// logic lives here.
export default function BulkActionBar({
  selectedCount,
  onClear,
  onAnalyze,
  onGenerate,
  onApprove,
  onExport,
  canAnalyze,
  canGenerate,
  canApprove,
  canExport,
  busy,
  progressLabel
}: {
  selectedCount: number
  onClear: () => void
  onAnalyze: () => void
  onGenerate: () => void
  onApprove: () => void
  onExport: () => void
  canAnalyze: boolean
  canGenerate: boolean
  canApprove: boolean
  canExport: boolean
  busy: boolean
  progressLabel: string | null
}) {
  if (selectedCount === 0) return null

  return (
    <div className={`mb-3 p-3 flex flex-wrap items-center gap-3 ${cardClass}`}>
      <p className="text-sm font-medium text-[var(--heading-text)]">
        {selectedCount} selected
      </p>
      <button type="button" onClick={onClear} disabled={busy} className={linkButtonClass}>
        Clear
      </button>
      <div className="flex-1" />
      {progressLabel && <p className="text-xs text-[var(--muted-text)]">{progressLabel}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onAnalyze} disabled={busy || !canAnalyze} className={buttonSecondaryClass}>
          Analyze Selected
        </button>
        <button type="button" onClick={onGenerate} disabled={busy || !canGenerate} className={buttonSecondaryClass}>
          Generate Selected
        </button>
        <button type="button" onClick={onApprove} disabled={busy || !canApprove} className={buttonSecondaryClass}>
          Approve Selected
        </button>
        <button type="button" onClick={onExport} disabled={busy || !canExport} className={buttonPrimaryClass}>
          Export Selected
        </button>
      </div>
    </div>
  )
}
