import { CheckCircle2, AlertTriangle, AlertCircle, XCircle, Clock, type LucideIcon } from 'lucide-react'

// Distinct from StatusBadge (draft/generating/partial/generated/approved,
// which tracks generation *progress* and is unchanged elsewhere) — this is
// the "is this pair ready to upload" axis: whether the row has been
// generated yet, and if so, whether it's actually complete per
// lib/listingHealth.ts. 'not-generated' covers a product/marketplace pair
// that hasn't been attempted at all, distinct from the 4 real health states.
export type RowHealthStatus = 'not-generated' | 'generating' | 'ready' | 'needs-review' | 'missing-data' | 'error'

const CONFIG: Record<RowHealthStatus, { label: string; icon: LucideIcon; className: string }> = {
  'not-generated': {
    label: 'Not generated',
    icon: Clock,
    className: 'bg-[var(--secondary-btn-bg)] text-[var(--secondary-btn-text)] border-[var(--secondary-btn-border)]'
  },
  generating: {
    label: 'Generating…',
    icon: Clock,
    // animate-pulse, not a spinner — matches the existing 'generating'
    // treatment in StatusBadge.tsx rather than introducing a new animation
    // style for the same purpose.
    className: 'bg-[var(--secondary-btn-bg)] text-[var(--secondary-btn-text)] border-[var(--secondary-btn-border)] animate-pulse'
  },
  ready: {
    label: 'Ready',
    icon: CheckCircle2,
    className: 'bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]'
  },
  'needs-review': {
    label: 'Needs Review',
    icon: AlertTriangle,
    className: 'bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]'
  },
  'missing-data': {
    label: 'Missing Data',
    icon: AlertCircle,
    className: 'bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]'
  },
  error: {
    label: 'Error',
    icon: XCircle,
    className: 'bg-[var(--danger-bg)] text-[var(--danger-text)] border-[var(--danger-border)]'
  }
}

// Milestone C14 — the same status->color mapping ListingHealthBadge itself
// uses, exposed so a compact custom chip (the drawer's marketplace
// quick-switch strip) can share the exact same color convention instead of
// re-deriving/duplicating it.
export function healthStatusClassName(status: RowHealthStatus): string {
  return CONFIG[status].className
}

export default function ListingHealthBadge({ status }: { status: RowHealthStatus }) {
  const { label, icon: Icon, className } = CONFIG[status]
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border ${className}`}>
      <Icon size={12} />
      {label}
    </span>
  )
}
