import { FileSpreadsheet, Sparkles, CheckCircle2, ChevronRight, ChevronDown } from 'lucide-react'

// The hero's product-transformation visual (spec section 8) — replaces the
// old three-mini-listing-card mockup with the actual input -> process ->
// output story: YOUR PRODUCT / TESOLUTE AI / MARKETPLACE LISTING. Static
// example data, not live product state — this is a demo visual, not a real
// generation run.
const processingSteps = [
  'Colour detected: Matte Black',
  'Material detected: Stainless Steel',
  'Capacity identified: 750 ml',
  'Design detected: Double-wall / insulated',
  'Feature detected: Leak-resistant lid',
  'Product category mapped',
  'Marketplace attributes matched',
  'Brand voice applied'
]

const glassCardClass = 'rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/60 backdrop-blur-xl shadow-2xl p-5 flex-1 min-w-0'

function ColumnLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-text)] mb-3">{children}</p>
}

function Arrow() {
  return (
    <div className="flex items-center justify-center shrink-0 text-[var(--accent-sky-text)]" aria-hidden="true">
      <ChevronRight size={20} strokeWidth={2.5} className="hidden lg:block" />
      <ChevronDown size={20} strokeWidth={2.5} className="lg:hidden" />
    </div>
  )
}

export default function HeroTransformDemo() {
  return (
    <div className="flex flex-col lg:flex-row items-stretch gap-3">
      {/* LEFT — your raw product data */}
      <div className={glassCardClass}>
        <ColumnLabel>Your Product</ColumnLabel>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-lg bg-[var(--placeholder-bg)] shrink-0" aria-hidden="true" />
          <div className="w-9 h-9 rounded-lg bg-[var(--placeholder-bg)] shrink-0" aria-hidden="true" />
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted-text)] bg-[var(--input-bg)]/40 border border-[var(--card-border)] rounded-lg px-2 py-1.5 min-w-0">
            <FileSpreadsheet size={13} className="shrink-0" />
            <span className="truncate">products.csv</span>
          </div>
        </div>
        <div className="rounded-xl border border-[var(--card-border)] bg-[var(--input-bg)]/40 p-3 text-xs font-mono text-[var(--body-text)] leading-relaxed">
          <div>SKU: WB-750-BLK</div>
          <div>Product: Insulated Stainless Steel Water Bottle</div>
          <div>Colour: Matte Black</div>
          <div>Capacity: 750 ml</div>
          <div>Material: Stainless Steel</div>
        </div>
      </div>

      <Arrow />

      {/* CENTER — the processing checklist, staggered fade-in */}
      <div className={glassCardClass}>
        <div className="flex items-center gap-1.5 mb-3">
          <Sparkles size={13} className="text-[var(--accent-sky-text)]" />
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-text)]">Tesolute AI</p>
        </div>
        <ul className="flex flex-col gap-2.5">
          {processingSteps.map((step, i) => (
            <li
              key={step}
              className="flex items-center gap-2 text-xs text-[var(--body-text)] animate-fade-in-up"
              style={{ animationDelay: `${i * 180}ms` }}
            >
              <CheckCircle2 size={14} className="text-[var(--accent-sky-text)] shrink-0" />
              {step}
            </li>
          ))}
        </ul>
      </div>

      <Arrow />

      {/* RIGHT — the generated, marketplace-ready output */}
      <div className={glassCardClass}>
        <div className="flex items-center justify-between mb-3">
          <ColumnLabel>Marketplace Listing</ColumnLabel>
        </div>
        <p className="text-xs font-semibold text-[var(--heading-text)] leading-snug mb-2">
          750ml Matte Black Insulated Stainless Steel Water Bottle with Leak-Resistant Lid
        </p>
        {/* text-left overrides the ancestor hero section's text-center —
            list-disc/list-inside otherwise inherits it, which barely showed
            with the original two similarly-short bullets but staggers
            visibly now that bullet lengths vary more. */}
        <ul className="text-left text-[11px] text-[var(--body-text)] leading-relaxed mb-2 list-disc list-inside">
          <li>Double-wall insulation helps maintain beverage temperature</li>
          <li>Durable stainless steel construction</li>
          <li>750ml capacity for everyday use</li>
          <li>Leak-resistant lid for travel and commuting</li>
          <li>Matte black finish with a clean, modern design</li>
        </ul>
        <div className="flex flex-wrap gap-1 mb-3">
          {['Material: Stainless Steel', 'Capacity: 750 ml', 'Colour: Black', 'Feature: Insulated'].map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--secondary-btn-bg)] border border-[var(--card-border)] text-[var(--secondary-btn-text)]"
            >
              {tag}
            </span>
          ))}
        </div>
        <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--success-text)] bg-[var(--success-bg)] border border-[var(--success-border)] rounded-full px-2.5 py-1">
          <CheckCircle2 size={12} />
          Marketplace Ready
        </div>
      </div>
    </div>
  )
}
