"use client"

import { useState } from 'react'
import { buttonPrimaryClass, buttonSecondaryClass, buttonSecondarySmallClass, linkButtonClass, cardClass } from '@/lib/uiClasses'

// Milestone C14 — the bulk operations bar for the current selection. Every
// action here is an ORCHESTRATION of an already-existing, already-tested
// per-item operation (Analyze -> the same /api/enrich-product call
// handleAnalyzeProduct already makes, Generate -> the same
// generateForProductMarketplace loop handleGenerateAll already ran,
// Approve -> the same handleApproveMarketplace write, Export -> the same
// C11 readiness-gated performExport) — this component only presents the
// buttons and the current selection/progress; none of the actual business
// logic lives here.
//
// Milestone C17 (corrected) — this bar is now explicitly SECONDARY:
// selection narrows a bulk action to a subset, it is never the primary
// path (that's QueueTable's zero-selection Generate Listings/Approve
// All/Export Listings toolbar). "Analyze" is credit-neutral background
// work, not a user-facing verb, so per the corrected spec it is never
// promoted to primary — pipeline order for the primary slot is
// generate/regenerate -> approve -> export only, falling back to no
// primary button (analyze still reachable via "More actions") when none
// of those apply yet.
type BulkAction = 'analyze' | 'generate' | 'approve' | 'export'

const ACTION_LABEL: Record<BulkAction, string> = {
  analyze: 'Analyze selected',
  generate: 'Bulk Generate',
  approve: 'Bulk Approve',
  export: 'Export selected'
}

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
  isRegenerate,
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
  // True when the current selection includes at least one already-generated
  // product, so the generate button reads "Bulk Regenerate" instead of
  // "Bulk Generate" — same handler either way (generateForProductMarketplace
  // overwrites in place regardless), just honest labeling.
  isRegenerate?: boolean
  busy: boolean
  progressLabel: string | null
}) {
  const [showMore, setShowMore] = useState(false)

  if (selectedCount === 0) return null

  const handlers: Record<BulkAction, () => void> = { analyze: onAnalyze, generate: onGenerate, approve: onApprove, export: onExport }
  const available: Record<BulkAction, boolean> = { analyze: canAnalyze, generate: canGenerate, approve: canApprove, export: canExport }
  const labels: Record<BulkAction, string> = {
    ...ACTION_LABEL,
    generate: isRegenerate ? 'Bulk Regenerate' : 'Bulk Generate'
  }

  // Pipeline order for the ONE primary slot: generate/regenerate -> approve
  // -> export. Analyze is deliberately excluded from ever being primary —
  // it's background understanding, not an action a seller should have to
  // reach for.
  const PRIMARY_ORDER: BulkAction[] = ['generate', 'approve', 'export']
  const primary: BulkAction | null = PRIMARY_ORDER.find((a) => available[a]) ?? null
  const secondaryActions = (['analyze', 'generate', 'approve', 'export'] as BulkAction[]).filter(
    (a) => a !== primary && available[a]
  )

  return (
    <div className={`mb-3 p-3 flex flex-wrap items-center gap-3 ${cardClass}`}>
      <p className="text-sm font-medium text-[var(--heading-text)]">{selectedCount} selected</p>
      <button type="button" onClick={onClear} disabled={busy} className={linkButtonClass}>
        Clear
      </button>
      <div className="flex-1" />
      {progressLabel && <p className="text-xs text-[var(--muted-text)]">{progressLabel}</p>}

      {primary && (
        <button type="button" onClick={handlers[primary]} disabled={busy || !available[primary]} className={buttonPrimaryClass}>
          {labels[primary]}
        </button>
      )}

      {secondaryActions.length > 0 && (
        <div className="relative">
          <button type="button" onClick={() => setShowMore((v) => !v)} disabled={busy} className={buttonSecondaryClass}>
            More actions {showMore ? '▲' : '▼'}
          </button>
          {showMore && (
            <div
              className={`absolute right-0 top-full mt-1 z-10 p-2 flex flex-col gap-1 min-w-[180px] ${cardClass}`}
            >
              {secondaryActions.map((action) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => {
                    handlers[action]()
                    setShowMore(false)
                  }}
                  disabled={busy}
                  className={`${buttonSecondarySmallClass} text-left`}
                >
                  {labels[action]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
