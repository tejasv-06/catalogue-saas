// Swap in a real video once recorded: pass `youtubeId` (the part after
// "v=" or "youtu.be/" in the URL) and this renders a real embed instead of
// the "Coming soon" placeholder. No prop change needed anywhere else.
export default function VideoPlaceholder({
  youtubeId,
  label = 'Watch 1-Minute Walkthrough'
}: {
  youtubeId?: string
  label?: string
}) {
  if (youtubeId) {
    return (
      <div className="rounded-xl overflow-hidden border border-[var(--card-border)] aspect-video">
        <iframe
          className="w-full h-full"
          src={`https://www.youtube.com/embed/${youtubeId}`}
          title={label}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 p-4 rounded-xl border border-dashed border-[var(--card-border)] bg-[var(--secondary-btn-bg)]">
      <span className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-blue-500/15 text-blue-600">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
      <div>
        <p className="text-sm font-medium text-[var(--heading-text)]">{label}</p>
        <p className="text-xs text-[var(--muted-text)]">Coming soon</p>
      </div>
    </div>
  )
}
