export default function EmptyQueueState({
  colSpan = 5,
  message = 'No products yet - add one manually or upload a CSV to get started.'
}: {
  colSpan?: number
  message?: string
}) {
  return (
    <tr>
      {/* Milestone C16 — left-aligned, not centered: this cell's colSpan
          spans the table's real (possibly wider-than-viewport, see
          QueueTable's own min-w-[680px]) width, and a horizontally-scrolled
          container always starts scrolled to its left edge — centering
          would center within the FULL table width, which can render
          off-screen at narrow viewports until the user scrolls right for
          no reason. Left-aligned text is visible immediately, no scroll
          needed, regardless of table width. */}
      <td colSpan={colSpan} className="p-8 text-left text-sm text-[var(--muted-text)]">
        {message}
      </td>
    </tr>
  )
}
