export default function EmptyQueueState({
  colSpan = 5,
  message = 'No products yet — add one manually or upload a CSV to get started.'
}: {
  colSpan?: number
  message?: string
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-8 text-center text-sm text-slate-500">
        {message}
      </td>
    </tr>
  )
}
