import { Shirt, Coffee, Headphones, type LucideIcon } from 'lucide-react'

// Code-built stand-in for a product screenshot — the app's real UI changes
// too often for a static screenshot to stay accurate, and there's no demo
// video yet (see VideoPlaceholder, used elsewhere on this page). This reads
// as "AI writes your listings" at a glance without pretending to be a real
// screen capture: three simplified mini listing cards in a glassmorphic
// panel, each with a marketplace tag, a generated title, and a bullet line.
// Every color here is a theme CSS variable (see app/globals.css), not a
// hardcoded white/black, so the glass effect holds up in both the dark
// ("Night") and light ("Day") themes instead of just one.
const sampleListings: { marketplace: string; title: string; bullet: string; icon: LucideIcon }[] = [
  {
    marketplace: 'Amazon',
    title: 'Organic Cotton Crew Neck T-Shirt — Soft, Breathable Everyday Fit',
    bullet: 'Premium combed cotton · pre-shrunk · true to size',
    icon: Shirt
  },
  {
    marketplace: 'Etsy',
    title: 'Handwoven Ceramic Mug Set, 3-Piece, Dishwasher Safe',
    bullet: 'Hand-glazed finish · gift-ready packaging',
    icon: Coffee
  },
  {
    marketplace: 'Flipkart',
    title: 'Wireless Earbuds with Active Noise Cancellation',
    bullet: '30-hour battery · IPX5 water resistant',
    icon: Headphones
  }
]

export default function HeroMockup() {
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
          <span className="ml-2 text-xs text-[var(--muted-text)]">AI-generated listings, live preview</span>
        </div>

        <div className="flex flex-col gap-3">
          {sampleListings.map((listing) => (
            <div
              key={listing.marketplace}
              className="flex gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--input-bg)]/40 p-3"
            >
              <div className="w-10 h-10 rounded-lg bg-[var(--placeholder-bg)] shrink-0 flex items-center justify-center text-[var(--muted-text)]">
                <listing.icon size={16} strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <span className="inline-block text-[10px] font-semibold uppercase tracking-wide text-blue-500 mb-1">
                  {listing.marketplace}
                </span>
                <p className="text-xs font-medium text-[var(--heading-text)] leading-snug mb-1 line-clamp-2">
                  {listing.title}
                </p>
                <p className="text-[11px] text-[var(--muted-text)] truncate">{listing.bullet}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
