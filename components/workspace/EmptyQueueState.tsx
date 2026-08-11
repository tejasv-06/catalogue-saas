import { cardClass } from '@/lib/uiClasses'

// Milestone C17 — QueueTable renders a card grid now, not a <table>, so
// this is a plain block instead of a <tr><td>. Same message contract as
// before (an override for "filtered to nothing" vs. the default "you have
// zero products" copy).
export default function EmptyQueueState({
  message = 'No products yet — create your first listing above to get started.'
}: {
  message?: string
}) {
  return (
    <div className={`p-8 text-left text-sm text-[var(--muted-text)] ${cardClass}`}>
      {message}
    </div>
  )
}
