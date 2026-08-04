export type BadgeStatus = 'draft' | 'generating' | 'generated' | 'approved'

const styles: Record<BadgeStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  generating: 'bg-yellow-100 text-yellow-700 animate-pulse',
  generated: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700'
}

const labels: Record<BadgeStatus, string> = {
  draft: 'draft',
  generating: 'Generating…',
  generated: 'generated',
  approved: 'approved'
}

export default function StatusBadge({ status }: { status: BadgeStatus }) {
  return <span className={`text-xs font-medium px-2 py-1 rounded-full ${styles[status]}`}>{labels[status]}</span>
}
