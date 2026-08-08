import { AlertTriangle, TrendingDown, CheckCircle2, type LucideIcon } from 'lucide-react'

// Right-side visual for the Account Audit section's hero-parity layout,
// styled to match HeroMockup's glass card. Modular the same way
// VideoPlaceholder already is: pass `youtubeId` once a real audit
// walkthrough exists and this renders a real embed instead of the mock
// diagnostics — no change needed anywhere this component is used.
const diagnostics: { icon: LucideIcon; iconClass: string; label: string; detail: string }[] = [
  {
    icon: AlertTriangle,
    iconClass: 'text-red-400 bg-red-500/10 border border-red-500/20',
    label: 'High Dropoff Alert',
    detail: 'Title missing top search keywords'
  },
  {
    icon: TrendingDown,
    iconClass: 'text-amber-400 bg-amber-500/10 border border-amber-500/20',
    label: 'Price Competitiveness Flag',
    detail: 'Priced above category median'
  },
  {
    icon: CheckCircle2,
    iconClass: 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20',
    label: '30-Day Conversion Action Plan',
    detail: 'Ready to review and apply'
  }
]

export default function AuditPreview({ youtubeId }: { youtubeId?: string }) {
  if (youtubeId) {
    return (
      <div className="rounded-xl overflow-hidden border border-[var(--card-border)] aspect-video">
        <iframe
          className="w-full h-full"
          src={`https://www.youtube.com/embed/${youtubeId}`}
          title="Account Audit walkthrough"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    )
  }

  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="absolute -inset-6 rounded-3xl bg-gradient-to-br from-blue-500/20 via-blue-400/10 to-transparent blur-2xl"
      />
      <div className="relative rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/60 backdrop-blur-xl shadow-2xl p-5">
        <div className="flex items-center gap-1.5 mb-4">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" />
          <span className="ml-2 text-xs text-[var(--muted-text)]">Live audit diagnostic preview</span>
        </div>

        <div className="flex flex-col gap-3">
          {diagnostics.map((d) => (
            <div
              key={d.label}
              className="flex gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--input-bg)]/40 p-3"
            >
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${d.iconClass}`}>
                <d.icon size={16} strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--heading-text)] leading-snug mb-1">{d.label}</p>
                <p className="text-[11px] text-[var(--muted-text)]">{d.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
