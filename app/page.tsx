import Link from 'next/link'
import { Upload, Search, ScanEye, ClipboardCheck, Download, Tags, Zap, Lock, ShieldCheck, type LucideIcon } from 'lucide-react'
import Navbar from '@/components/Navbar'
import HeroMockup from '@/components/HeroMockup'
import AuditPreview from '@/components/AuditPreview'
import { cardClass } from '@/lib/uiClasses'
import { GUEST_GENERATION_LIMIT } from '@/lib/limits'
import { SUPPORTED_MARKETPLACES, MARKETPLACE_LABELS } from '@/lib/platformShapers'

const valueProps: { title: string; description: string; icon: LucideIcon }[] = [
  {
    title: '90% Faster Catalog Launch',
    description:
      'Eliminate spreadsheet chaos and manual copy-pasting. Go from raw CSV or photo uploads to multi-channel launch-ready files in minutes.',
    icon: Zap
  },
  {
    title: '100% Locked Brand Voice',
    description:
      'Never sound like generic AI. Teach the system your tone once — whether premium, technical, or playful — and keep every single SKU strictly on-brand.',
    icon: Lock
  },
  {
    title: 'Channel-Compliant SEO',
    description:
      'Built-in character validation, bullet point limits, and A9/search-indexed backend keywords for Amazon, Flipkart, Etsy, and Myntra.',
    icon: ShieldCheck
  }
]

// Sky/cyan highlight for feature-card titles (replaced an earlier amber
// version). Reuses the --accent-sky-text CSS var rather than a literal
// text-sky-400 class because that solid color measures 7.51:1 on the dark
// card background but only 2.14:1 in the light theme — see the var's
// definition in app/globals.css for the full comparison.
const skyTitleClass = 'text-[var(--accent-sky-text)]'

// title is JSX rather than a plain string so the "high-intent" phrase in
// each one can be wrapped in skyTitleClass inline, at the exact word
// boundaries given — simpler and less fragile than storing a substring and
// splitting the title string at render time.
const features: { title: React.ReactNode; description: string; icon: LucideIcon }[] = [
  {
    title: (
      <>
        Upload Your <span className={skyTitleClass}>Whole Catalog</span>
      </>
    ),
    description: "Got 10 products or 10,000? Upload a CSV or your product photos, and we'll handle the rest.",
    icon: Upload
  },
  {
    title: (
      <>
        Listings That <span className={skyTitleClass}>Actually Get Found</span>
      </>
    ),
    description:
      "We write titles and descriptions the way each marketplace's search really works, so more shoppers find your products.",
    icon: Search
  },
  {
    title: (
      <>
        AI Reads Your <span className={skyTitleClass}>Product Photos</span>
      </>
    ),
    description:
      "Just upload a photo. Our AI notices the color, material, and style, so you don't have to type it all in.",
    icon: ScanEye
  },
  {
    title: (
      <>
        <span className={skyTitleClass}>Review</span> Before You Publish
      </>
    ),
    description:
      "Check every listing, tweak the wording, or regenerate it. Approve a whole batch in one click when you're happy.",
    icon: ClipboardCheck
  },
  {
    title: (
      <>
        Download, <span className={skyTitleClass}>Ready to Upload</span>
      </>
    ),
    description: "Get a file that's already in the right format for each marketplace. No fixing spreadsheets by hand.",
    icon: Download
  },
  {
    title: (
      <>
        The <span className={skyTitleClass}>Right Keywords</span>, Automatically
      </>
    ),
    description: 'Every listing includes the search terms shoppers actually type, built in from day one.',
    icon: Tags
  }
]

const steps = [
  { title: 'Ingest Assets', description: 'Drop raw CSVs, product URLs, or photo folders.' },
  { title: 'Automated SEO Copywriting', description: 'AI generates channel-compliant titles, specs, and search terms.' },
  { title: 'Review & Refine', description: 'Tweak messaging, adjust keyword density, or approve in batch view.' },
  { title: 'Scale & Export', description: 'Download ready-to-upload catalog flat files and boost marketplace reach.' }
]

const testimonials = [
  {
    quote:
      'We scaled from handling 5 brand catalogs to 25 brands without adding copywriters. Our client product pages now rank organically 4x faster across Amazon and Flipkart.',
    name: 'Priya N.',
    role: 'Founder, E-commerce Operations Agency'
  },
  {
    quote:
      'Eliminating channel listing rejections saved us hundreds of operational hours. The marketplace-specific keyword formatting alone bumped our search impressions by 35% in week one.',
    name: 'Marcus T.',
    role: 'Head of Cataloging, D2C Brand'
  },
  {
    quote:
      'I used to spend full weekends reformatting bullet points for Etsy and Amazon. Now I auto-generate visual-based attributes and localized keywords in one click.',
    name: 'Dana R.',
    role: 'Multi-Channel Seller'
  }
]

const primaryCtaClass =
  'inline-block bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl text-base font-semibold shadow-lg shadow-blue-500/20 transition-colors'

const eyebrowClass = 'inline-block text-xs font-semibold uppercase tracking-wide text-blue-600 mb-2'

// Same pill treatment on both service cards (Listing Generation, Account
// Audit), so the two "free trial" callouts read as one consistent pattern
// rather than each card inventing its own badge style.
const freeIncludedBadgeClass =
  'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--success-bg)] text-[var(--success-text)] border border-[var(--success-border)]'

const marketplaceChipClass =
  'px-3 py-1 rounded-full text-xs font-medium border border-[var(--card-border)] bg-[var(--secondary-btn-bg)] text-[var(--secondary-btn-text)]'

// Border-only hover glow, matching the icon/title sky accent — simpler
// than the shadow-based glow this replaced, just a brighter border tint on
// hover instead of the plain opacity dim used elsewhere on the page.
const featureCardHoverClass = 'hover:border-sky-500/40 transition-colors duration-200'

// Sky icon badge to match the sky heading highlight next to it — bg and
// border are plain Tailwind sky-500 opacity utilities (as asked for) since
// alpha-blended backgrounds/borders don't have a WCAG text-contrast failure
// mode the way solid foreground color does; only the icon's own stroke
// color (which the badge's text-* class drives via currentColor) is
// swapped for the theme-aware --accent-sky-text var used everywhere else
// on this page, since literal text-sky-400 drops to 2.14:1 in the light
// theme (see skyTitleClass above).
const featureIconClass =
  'bg-sky-500/10 text-[var(--accent-sky-text)] border border-sky-500/20 p-2.5 rounded-lg shrink-0 flex items-center justify-center'

function BenefitItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-[var(--body-text)]">
      <span className="text-blue-600 mt-0.5">✓</span>
      <span>{children}</span>
    </li>
  )
}

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-[var(--page-bg)] text-[var(--body-text)]">
      <Navbar />

      <main className="flex-1">
        {/* Value-prop section, now the first thing below the nav header,
            directly above the Listing Generation hero — moved up per an
            explicit re-order request. Colors still deviate from a literal
            slate-900/text-white/text-sky-400 spec for the same reason as
            when this section was first added: this page has a real light
            theme (ThemeToggle in Navbar), and every other section uses the
            --heading-text/--body-text/--card-bg/--accent-sky-text CSS vars
            specifically so it doesn't break there — see those vars'
            definitions in app/globals.css for the measured contrast
            ratios. bg/border opacity utilities (sky-500/10, sky-500/20)
            are literal Tailwind classes as specified, since alpha-blended
            fills don't have that same contrast-failure mode. */}
        <section className="max-w-6xl mx-auto px-6 py-16 text-center">
          <span className="inline-block px-4 py-1.5 rounded-full text-xs font-semibold tracking-wider text-[var(--accent-sky-text)] bg-sky-500/10 border border-sky-500/20 mb-4">
            PURPOSE-BUILT FOR E-COMMERCE BRANDS &amp; AGENCIES
          </span>
          <h2 className="text-3xl md:text-4xl font-extrabold text-[var(--heading-text)] mb-4">
            Stop Wasting Days on Manual Cataloging &amp; Generic AI Copy
          </h2>
          <p className="max-w-3xl mx-auto text-[var(--body-text)] text-base md:text-lg leading-relaxed mb-12">
            Most AI tools spit out generic ChatGPT text that fails marketplace character limits, ignores backend
            search algorithms, and strips away your brand's unique identity. Tesolute is engineered specifically for
            e-commerce operators — combining computer vision with platform-tailored SEO to transform raw assets into
            high-converting, brand-aligned listings instantly.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            {valueProps.map((prop) => (
              <div
                key={prop.title}
                className="bg-[var(--card-bg)]/60 backdrop-blur-xl border border-[var(--card-border)] p-6 rounded-2xl"
              >
                <prop.icon size={22} strokeWidth={2} className="text-[var(--accent-sky-text)] mb-3" />
                <h3 className="font-semibold text-[var(--heading-text)] mb-2">{prop.title}</h3>
                <p className="text-sm text-[var(--body-text)]">{prop.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-6 py-12">
          <div className={`p-8 grid grid-cols-1 lg:grid-cols-2 gap-8 items-center ${cardClass}`}>
            <div>
              <span className={eyebrowClass}>Listing Generation</span>
              <h1 className="text-3xl font-bold text-[var(--heading-text)] mb-4">
                List Products Everywhere. In Minutes, Not Hours.
              </h1>
              <ul className="flex flex-col gap-2.5 mb-6">
                <BenefitItem>
                  <strong className="text-[var(--heading-text)]">Platform-Tailored &amp; Brand-Voice Aware</strong> —
                  not generic ChatGPT output, copy engineered specifically for each platform's algorithm and your
                  brand's tone.
                </BenefitItem>
                <BenefitItem>
                  <strong className="text-[var(--heading-text)]">SEO Optimized with Top 10 High-Intent Keywords</strong>{' '}
                  — automatically extracts and embeds high-converting search keywords into titles, bullet points, and
                  backend search terms.
                </BenefitItem>
                <BenefitItem>
                  <strong className="text-[var(--heading-text)]">Zero Hallucination Vision AI</strong> — reads
                  product attributes, colors, materials, and features directly from your uploaded images.
                </BenefitItem>
              </ul>
              <div className="flex flex-wrap gap-2 mb-6">
                {SUPPORTED_MARKETPLACES.map((marketplace) => (
                  <span key={marketplace} className={marketplaceChipClass}>
                    {MARKETPLACE_LABELS[marketplace]}
                  </span>
                ))}
              </div>
              <div className="flex flex-col items-start gap-2">
                <Link href="/workspace" className={primaryCtaClass}>
                  Start Generating Listings
                </Link>
                <span className={freeIncludedBadgeClass}>{GUEST_GENERATION_LIMIT} Free Credits Included</span>
              </div>
            </div>
            <HeroMockup />
          </div>
        </section>

        {/* Same container width/padding as the Listing Generation hero
            above, and the same two-column shape (bullets + CTA left, a
            hero-style preview card right) — the two service cards are meant
            to read as one consistent pattern, not two different layouts. */}
        <section className="max-w-7xl mx-auto px-6 py-12">
          <div className={`p-8 grid grid-cols-1 lg:grid-cols-2 gap-8 items-center ${cardClass}`}>
            <div>
              <span className={eyebrowClass}>Account Audit</span>
              <h2 className="text-3xl font-bold text-[var(--heading-text)] mb-4">
                Find Out What's Actually Costing You Sales.
              </h2>
              <ul className="flex flex-col gap-2.5 mb-6">
                <BenefitItem>
                  <strong className="text-[var(--heading-text)]">Upload your Amazon sales &amp; traffic report</strong>{' '}
                  and get a verified, AI-written diagnosis.
                </BenefitItem>
                <BenefitItem>
                  <strong className="text-[var(--heading-text)]">See exactly which products drive revenue</strong>{' '}
                  and which ones are burning traffic for nothing.
                </BenefitItem>
                <BenefitItem>
                  <strong className="text-[var(--heading-text)]">Get a prioritized 30-day action plan</strong>, not
                  just a pile of numbers.
                </BenefitItem>
              </ul>
              <div className="flex flex-col items-start gap-2">
                <Link href="/audit" className={primaryCtaClass}>
                  Audit Your Amazon Account Now
                </Link>
                <span className={freeIncludedBadgeClass}>1 Free Audit Included</span>
              </div>
            </div>
            <AuditPreview />
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-6 py-16">
          <h2 className="text-2xl font-bold text-[var(--heading-text)] text-center mb-10">
            Everything You Need to List &amp; Scale Faster
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <div
                key={i}
                className={`p-6 ${featureCardHoverClass} ${cardClass}`}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className={featureIconClass}>
                    <feature.icon size={20} strokeWidth={2} />
                  </div>
                  <h3 className="font-semibold text-[var(--heading-text)] leading-snug">{feature.title}</h3>
                </div>
                <p className="text-sm text-[var(--body-text)]">{feature.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="py-16 bg-[var(--table-head-bg)]">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold text-[var(--heading-text)] text-center mb-10">How it works</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
              {steps.map((step, i) => (
                <div key={step.title} className="text-center">
                  {/* amber-600 -> orange-600, not the lighter 500 shades the
                      "vibrant gradient" ask literally named — white text on
                      amber-500/orange-500 only measures 2.15-2.80:1 (fails
                      even the 3:1 large-text minimum); shifting one step
                      darker holds the same gradient identity and passes at
                      3.19:1 at its lightest point. */}
                  <div className="w-10 h-10 rounded-full bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-lg shadow-orange-500/20 flex items-center justify-center mx-auto mb-3 font-bold">
                    {i + 1}
                  </div>
                  <h3 className="font-semibold text-[var(--heading-text)] mb-1">{step.title}</h3>
                  <p className="text-sm text-[var(--body-text)]">{step.description}</p>
                </div>
              ))}
            </div>
            <div className="text-center mt-8">
              <Link href="/how-it-works" className="text-sm text-blue-600 hover:opacity-80 underline transition-colors">
                See the full walkthrough
              </Link>
            </div>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h2 className="text-2xl font-bold text-[var(--heading-text)] text-center mb-2">What sellers are saying</h2>
          <p className="text-center text-xs text-[var(--muted-text)] mb-10">
            (Placeholder quotes, will be replaced with real customer testimonials)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {testimonials.map((t) => (
              <div
                key={t.name}
                className={`p-6 hover:opacity-90 transition ${cardClass}`}
              >
                <p className="text-sm text-[var(--body-text)] mb-4">&ldquo;{t.quote}&rdquo;</p>
                <p className="text-sm font-semibold text-[var(--heading-text)]">{t.name}</p>
                <p className="text-xs text-[var(--muted-text)]">{t.role}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t py-8 border-[var(--card-border)]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-[var(--muted-text)]">
          <p>&copy; {new Date().getFullYear()} Tesolute. All rights reserved.</p>
          <div className="flex gap-6">
            <Link href="/" className="hover:text-[var(--heading-text)] transition-colors">
              Home
            </Link>
            <Link href="/how-it-works" className="hover:text-[var(--heading-text)] transition-colors">
              How It Works
            </Link>
            <Link href="/contact" className="hover:text-[var(--heading-text)] transition-colors">
              Contact
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
