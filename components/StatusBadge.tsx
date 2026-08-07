export type BadgeStatus = 'draft' | 'generating' | 'partial' | 'generated' | 'approved'

const styles: Record<BadgeStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  generating: 'bg-yellow-100 text-yellow-700 animate-pulse',
  // Some but not all of a product's selected marketplaces generated
  // successfully (e.g. credits ran out partway through) — visually distinct
  // from both "nothing done yet" (draft) and "fully done" (generated) so it
  // never reads as an ambiguous half-finished state.
  partial: 'bg-orange-100 text-orange-700',
  generated: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700'
}

const labels: Record<BadgeStatus, string> = {
  draft: 'draft',
  generating: 'Generating…',
  partial: 'partial',
  generated: 'generated',
  approved: 'approved'
}

export default function StatusBadge({ status }: { status: BadgeStatus }) {
  return <span className={`text-xs font-medium px-2 py-1 rounded-full ${styles[status]}`}>{labels[status]}</span>
}
