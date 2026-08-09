import Link from 'next/link'
import { Image as ImageIcon, ArrowRight } from 'lucide-react'

// Computer-vision section demo — a static example, not a live extraction.
// Same product as the hero's HeroTransformDemo (insulated stainless-steel
// water bottle), so the two demos read as one consistent story rather than
// two unrelated products. "Add to Listing" is a real link to /workspace
// (the actual place this attribute data would end up), not a decorative
// dead button.
const extractedAttributes: { label: string; value: string }[] = [
  { label: 'Colour', value: 'Matte Black' },
  { label: 'Material', value: 'Stainless Steel' },
  { label: 'Capacity', value: '750 ml' },
  { label: 'Design', value: 'Double-wall / Insulated' },
  { label: 'Feature', value: 'Leak-Resistant Lid' }
]

export default function AttributeExtractionDemo() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/60 backdrop-blur-xl shadow-2xl p-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-text)] mb-3">Product Image</p>
        <div className="aspect-square w-full max-w-xs rounded-xl bg-[var(--placeholder-bg)] flex flex-col items-center justify-center gap-2 text-[var(--muted-text)]">
          <ImageIcon size={28} strokeWidth={1.5} />
          <span className="text-xs px-4 text-center">Insulated Stainless Steel Water Bottle</span>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-text)] mb-3">AI Extraction</p>
        <dl className="flex flex-col gap-2 mb-5">
          {extractedAttributes.map((attr) => (
            <div
              key={attr.label}
              className="flex items-center justify-between rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)]/40 px-3 py-2"
            >
              <dt className="text-xs text-[var(--muted-text)]">{attr.label}</dt>
              <dd className="text-xs font-medium text-[var(--heading-text)]">{attr.value}</dd>
            </div>
          ))}
        </dl>
        <Link
          href="/workspace"
          className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg shadow-blue-500/20 transition-colors"
        >
          Add to Listing
          <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  )
}
