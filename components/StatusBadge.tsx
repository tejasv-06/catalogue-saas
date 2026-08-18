export type BadgeStatus = 'draft' | 'generating' | 'partial' | 'generated' | 'approved'

// Same --* theme variable families ListingHealthBadge uses (bg/text/border),
// so the two badge types (generation progress here, listing health there)
// stay visually consistent with each other in both themes instead of this
// one being a fixed light-mode pill next to a properly themed one.
const styles: Record<BadgeStatus, string> = {
  draft: 'bg-[var(--secondary-btn-bg)] text-[var(--secondary-btn-text)] border-[var(--secondary-btn-border)]',
  generating: 'bg-[var(--secondary-btn-bg)] text-[var(--secondary-btn-text)] border-[var(--secondary-btn-border)] animate-pulse',
  // Some but not all of a product's selected marketplaces generated
  // successfully (e.g. credits ran out partway through): visually distinct
  // from both "nothing done yet" (draft) and "fully done" (generated) so it
  // never reads as an ambiguous half-finished state.
  partial: 'bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]',
  generated: 'bg-[var(--accent-sky-bg)] text-[var(--accent-sky-text)] border-[var(--accent-sky-border)]',
  approved: 'bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]'
}

const labels: Record<BadgeStatus, string> = {
  draft: 'draft',
  generating: 'Generating…',
  partial: 'partial',
  generated: 'generated',
  approved: 'approved'
}

export default function StatusBadge({ status }: { status: BadgeStatus }) {
  return <span className={`text-xs font-medium px-2 py-1 rounded-full border ${styles[status]}`}>{labels[status]}</span>
}
