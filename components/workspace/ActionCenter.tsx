"use client"

import { useMemo, useState } from 'react'
import {
  summarizeByPriority,
  filterRecommendationsByPriority,
  type CatalogActionRecommendation,
  type RecommendationPriority,
  type RecommendationPriorityFilter
} from '@/lib/catalogRecommendations'
import { buttonSecondaryClass, buttonSecondarySmallClass, cardClass, sectionHeadingClass, bodyTextClass, labelClass } from '@/lib/uiClasses'

// Milestone C15 — Action Center. Purely a PRESENTATION layer over
// lib/catalogRecommendations.ts's already-computed, already-sorted
// recommendation list: this component makes no recommendation decisions of
// its own (no priority logic, no readiness logic) and triggers no action by
// itself — every button here calls `onExecute`, which CatalogueWorkspace.tsx
// wires to the exact same existing handlers QueueTable/the drawer/
// BulkActionBar already use. Simply rendering this component (including on
// every reload) has zero side effects: no fetch, no credit spend, no
// mutation — it only reads the `recommendations` prop it's given.

const PRIORITY_META: Record<RecommendationPriority, { emoji: string; label: string; badgeClass: string }> = {
  critical: { emoji: '🔴', label: 'Critical', badgeClass: 'bg-[var(--danger-bg)] text-[var(--danger-text)] border-[var(--danger-border)]' },
  high: { emoji: '🟠', label: 'High', badgeClass: 'bg-amber-600 text-white border-amber-600' },
  medium: { emoji: '🟡', label: 'Medium', badgeClass: 'bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]' },
  low: { emoji: '🔵', label: 'Low', badgeClass: 'bg-blue-600/10 text-blue-500 border-blue-600/30' }
}

const ACTION_LABELS: Record<CatalogActionRecommendation['actionType'], string> = {
  ANALYZE: 'Analyze',
  GENERATE: 'Generate',
  FIX_LISTING: 'Review Listing',
  COMPLETE_INFORMATION: 'Review Product',
  APPROVE: 'Approve',
  EXPORT: 'Export',
  REVIEW_BRAND: 'Review Brand'
}

// Milestone C16 — lowered from 5 to 3: the Action Center sat above the
// catalog table and could push it well below the fold before this. The
// prominent "What should I do next?" card above already surfaces the single
// highest-priority item at full size; these are the NEXT few, rendered
// lighter/tighter (see RecommendationCard's compact prop below) — "View all
// N" still reaches every recommendation, nothing is hidden, just not shown
// by default.
const DEFAULT_VISIBLE_COUNT = 3

const PRIORITY_FILTER_OPTIONS: { id: RecommendationPriorityFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'critical', label: 'Critical' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' }
]

// Milestone C16 — `compact` is a presentation-only variant (smaller text,
// tighter padding, no blockingIssues list, a small action button) used for
// every card except the single prominent "What should I do next?" one —
// exactly the spec's "show the top recommendation prominently, keep the
// remaining recommendations visually lighter." No data is hidden: title,
// product, reason, and the action button are always present either way —
// only the detail list and type scale shrink.
function RecommendationCard({
  rec,
  onExecute,
  busy,
  compact = false
}: {
  rec: CatalogActionRecommendation
  onExecute: (rec: CatalogActionRecommendation) => void
  busy: boolean
  compact?: boolean
}) {
  const meta = PRIORITY_META[rec.priority]
  return (
    <div className={`rounded-xl border border-[var(--row-border)] flex flex-col ${compact ? 'p-2.5 gap-1' : 'p-3 gap-1.5'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`font-medium text-[var(--heading-text)] ${compact ? 'text-xs' : 'text-sm'}`}>
          {meta.emoji} {rec.title}
        </p>
        {rec.creditCost != null && rec.creditCost > 0 && (
          <span className="shrink-0 text-xs text-[var(--muted-text)]">{rec.creditCost} credit{rec.creditCost === 1 ? '' : 's'}</span>
        )}
      </div>
      {rec.productName && <p className="text-xs text-[var(--muted-text)]">Product: {rec.productName}</p>}
      <p className={compact ? 'text-xs text-[var(--muted-text)]' : bodyTextClass}>{rec.reason}</p>
      {!compact && rec.blockingIssues && rec.blockingIssues.length > 0 && (
        <ul className="ml-4 list-disc list-inside text-xs text-[var(--muted-text)]">
          {rec.blockingIssues.map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      )}
      <div>
        <button
          type="button"
          onClick={() => onExecute(rec)}
          disabled={busy}
          className={compact ? buttonSecondarySmallClass : buttonSecondaryClass}
        >
          {ACTION_LABELS[rec.actionType]}
        </button>
      </div>
    </div>
  )
}

export default function ActionCenter({
  recommendations,
  hasProducts,
  loading,
  busy,
  onExecute
}: {
  recommendations: CatalogActionRecommendation[]
  hasProducts: boolean
  loading: boolean
  busy: boolean
  onExecute: (rec: CatalogActionRecommendation) => void
}) {
  const [priorityFilter, setPriorityFilter] = useState<RecommendationPriorityFilter>('all')
  const [expanded, setExpanded] = useState(false)

  const summary = useMemo(() => summarizeByPriority(recommendations), [recommendations])
  const filtered = useMemo(() => filterRecommendationsByPriority(recommendations, priorityFilter), [recommendations, priorityFilter])
  const visible = expanded ? filtered : filtered.slice(0, DEFAULT_VISIBLE_COUNT)
  const topRecommendation = recommendations[0] ?? null

  if (loading) {
    return (
      <div className={`p-4 mb-4 animate-pulse ${cardClass}`}>
        <div className="h-4 w-40 rounded bg-[var(--skeleton-bg)]" />
      </div>
    )
  }

  return (
    <div className={`p-3 sm:p-4 mb-4 flex flex-col gap-3 ${cardClass}`}>
      <div>
        <h2 className={sectionHeadingClass}>Action Center</h2>

        {!hasProducts ? (
          <p className={`mt-1 ${bodyTextClass}`}>Add products to start receiving catalog recommendations.</p>
        ) : recommendations.length === 0 ? (
          <div className="mt-1">
            <p className={bodyTextClass}>Your catalog is in good shape.</p>
            <ul className="mt-1 text-xs text-[var(--success-text)] flex flex-col gap-0.5">
              <li>✓ No critical issues</li>
              <li>✓ No blocked listings</li>
              <li>✓ No marketplace export blockers</li>
            </ul>
          </div>
        ) : (
          <>
            <p className={`mt-1 ${bodyTextClass}`}>
              <span className="font-semibold text-[var(--heading-text)]">{recommendations.length}</span> action
              {recommendations.length === 1 ? '' : 's'} need attention
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(['critical', 'high', 'medium', 'low'] as RecommendationPriority[]).map((p) => {
                const meta = PRIORITY_META[p]
                if (summary[p] === 0) return null
                return (
                  <span
                    key={p}
                    className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border ${meta.badgeClass}`}
                  >
                    {meta.emoji} {meta.label} {summary[p]}
                  </span>
                )
              })}
            </div>
          </>
        )}
      </div>

      {topRecommendation && (
        <div className="pt-3 border-t border-[var(--card-border)]">
          <p className={`${labelClass} mb-1`}>What should I do next?</p>
          <RecommendationCard rec={topRecommendation} onExecute={onExecute} busy={busy} />
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="pt-3 border-t border-[var(--card-border)] flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {PRIORITY_FILTER_OPTIONS.map((option) => {
              const isActive = priorityFilter === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setPriorityFilter(option.id)}
                  aria-pressed={isActive}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    isActive
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-[var(--secondary-btn-bg)] border-[var(--secondary-btn-border)] text-[var(--secondary-btn-text)] hover:bg-[var(--secondary-btn-bg-hover)]'
                  }`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          <div className="flex flex-col gap-1.5">
            {visible.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} onExecute={onExecute} busy={busy} compact />
            ))}
          </div>

          {filtered.length > DEFAULT_VISIBLE_COUNT && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className={buttonSecondaryClass}>
              {expanded ? 'Show less' : `View all ${filtered.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
