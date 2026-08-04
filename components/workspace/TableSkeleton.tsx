// Shown wherever the queue table's data isn't resolved yet — today that's
// just the brief window before session-restore decides auto-restore vs. the
// banner (!sessionReady), but it's generic enough to reuse for any future
// async product fetch without rework.
export default function TableSkeleton({ rows = 4, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex} className="border-b border-slate-800/60 animate-pulse">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <td key={colIndex} className="py-3 px-4">
              <div className="h-4 bg-slate-800 rounded-md w-full max-w-[160px]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
