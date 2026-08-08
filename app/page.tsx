import Link from 'next/link'
import {
  ArrowRight,
  Check,
  X,
  CheckCircle2,
  Building2,
  Users,
  Upload,
  Sparkles,
  ClipboardCheck,
  Download,
  type LucideIcon
} from 'lucide-react'
import Navbar from '@/components/Navbar'
import HeroTransformDemo from '@/components/landing/HeroTransformDemo'
import AttributeExtractionDemo from '@/components/landing/AttributeExtractionDemo'
import { cardClass } from '@/lib/uiClasses'
import { SUPPORTED_MARKETPLACES, MARKETPLACE_LABELS } from '@/lib/platformShapers'

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const problemFlow = ['Photos', 'Attributes', 'Keywords', 'Copy', 'Marketplace Fields', 'Validation', 'Export']

const solutionSteps = [
  { number: '01', title: 'Understand', description: 'Upload product images, CSVs or existing product data.' },
  {
    number: '02',
    title: 'Enrich',
    description: 'Tesolute extracts product attributes and fills the information needed for marketplace listings.'
  },
  {
    number: '03',
    title: 'Generate',
    description: 'Create titles, bullet points, descriptions, attributes and search terms tailored to the marketplace.'
  },
  {
    number: '04',
    title: 'Export',
    description: 'Review your catalog, make changes inline and download marketplace-ready files.'
  }
]

const genericAiPoints = [
  'Generates text',
  'Requires manually supplied attributes',
  'Generic output',
  'No marketplace-specific structure',
  'Manual validation',
  'Inconsistent brand tone',
  'Copy/paste workflow'
]

const tesolutePoints = [
  'Builds complete listings',
  'Extracts attributes from product images',
  'Marketplace-specific output',
  'SEO-aware content',
  'Built-in validation',
  'Locked brand voice',
  'Bulk generation and export'
]

const marketplaceFields: { name: string; fields: string[] }[] = [
  { name: 'Amazon', fields: ['Title', 'Bullets', 'Search Terms', 'Attributes'] },
  { name: 'Flipkart', fields: ['Product Title', 'Description', 'Attributes', 'Category Fields'] },
  { name: 'Myntra', fields: ['Product Name', 'Description', 'Colour', 'Fabric', 'Pattern', 'Style'] },
  { name: 'Etsy', fields: ['Title', 'Description', 'Tags', 'Materials'] }
]

const brandVoiceTones = ['Premium', 'Minimal', 'Elegant', 'Confident']

const brandVoiceExamples: { product: string; copy: string }[] = [
  { product: 'Jacquard Saree', copy: 'A quietly confident weave — traditional pattern, modern restraint.' },
  { product: 'Leather Tote', copy: 'Considered materials, minimal hardware. Built for everyday use.' },
  { product: 'Ceramic Vase', copy: 'Understated form, deliberate proportions. Elegant on any shelf.' }
]

const bulkChecklist = ['Bulk CSV upload', 'Bulk image processing', 'Inline editing', 'Bulk approval', 'Marketplace-ready export']

const proofPoints: { problem: string; solution: string }[] = [
  { problem: 'Manual attribute entry', solution: 'Automated extraction' },
  { problem: 'Generic AI copy', solution: 'Brand-specific content' },
  { problem: 'Marketplace formatting', solution: 'Channel-specific generation' },
  { problem: 'Spreadsheet cleanup', solution: 'Ready-to-upload exports' }
]

const howItWorksSteps: { title: string; description: string; icon: LucideIcon }[] = [
  { title: 'Upload', description: 'Drop in your product images and CSV.', icon: Upload },
  { title: 'Generate', description: 'Tesolute analyzes your products and creates channel-specific listings.', icon: Sparkles },
  { title: 'Review', description: "Edit anything you want. Regenerate anything you don't.", icon: ClipboardCheck },
  { title: 'Export', description: 'Download your marketplace-ready catalog.', icon: Download }
]

// ---------------------------------------------------------------------------
// Shared style tokens (reused throughout — see lib/uiClasses.ts for the
// app-wide ones like cardClass; these are landing-page-specific)
// ---------------------------------------------------------------------------

const eyebrowClass = 'inline-block text-xs font-semibold uppercase tracking-wide text-blue-600 mb-3'
const sectionHeadingClass = 'text-3xl md:text-4xl font-bold text-[var(--heading-text)] mb-4'
const primaryCtaClass =
  'inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl text-base font-semibold shadow-lg shadow-blue-500/20 transition-colors'
const secondaryCtaClass =
  'inline-flex items-center gap-1.5 bg-[var(--secondary-btn-bg)] hover:bg-[var(--secondary-btn-bg-hover)] text-[var(--secondary-btn-text)] border border-[var(--secondary-btn-border)] px-6 py-3 rounded-xl text-base font-semibold transition-colors'
const marketplaceChipClass =
  'px-3 py-1 rounded-full text-xs font-medium border border-[var(--card-border)] bg-[var(--secondary-btn-bg)] text-[var(--secondary-btn-text)]'
const glassCardClass = 'rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/60 backdrop-blur-xl shadow-xl'

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-[var(--page-bg)] text-[var(--body-text)]">
      <Navbar />

      <main className="flex-1">
        {/* -------------------------------------------------------------
            HERO + PRODUCT TRANSFORMATION DEMO (spec sections 7-8)
            Combined into one section/anchor — the demo is the direct
            visual continuation of the hero's promise, not a separate
            topic. id="product" is the nav's "Product" anchor target. */}
        <section id="product" className="max-w-7xl mx-auto px-6 pt-16 pb-20 text-center">
          <span className={eyebrowClass}>AI Cataloging for E-Commerce</span>
          <h1 className="text-4xl md:text-5xl font-extrabold text-[var(--heading-text)] mb-5 max-w-3xl mx-auto leading-tight">
            Stop Writing Listings. Start Launching Products.
          </h1>
          <p className="max-w-2xl mx-auto text-[var(--body-text)] text-base md:text-lg leading-relaxed mb-8">
            Turn product photos and product data into marketplace-ready listings for Amazon, Flipkart, Myntra and
            Etsy — optimized for each channel and consistent with your brand.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mb-4">
            <Link href="/workspace" className={primaryCtaClass}>
              Create Your First Listing
              <ArrowRight size={16} />
            </Link>
            <Link href="/how-it-works" className={secondaryCtaClass}>
              See How It Works
            </Link>
          </div>
          <p className="text-xs text-[var(--muted-text)] mb-3">10 free credits · No credit card required</p>
          <p className="text-xs text-[var(--muted-text)] mb-12">
            {SUPPORTED_MARKETPLACES.map((m) => MARKETPLACE_LABELS[m]).join(' · ')}
          </p>

          <HeroTransformDemo />
        </section>

        {/* -------------------------------------------------------------
            PROBLEM (spec section 9) */}
        <section className="max-w-5xl mx-auto px-6 py-16 text-center">
          <span className={eyebrowClass}>The Cataloging Problem</span>
          <h2 className={sectionHeadingClass}>One product isn't the problem. 500 products are.</h2>
          <p className="max-w-2xl mx-auto text-[var(--body-text)] leading-relaxed mb-2">
            Every new SKU means another round of photos, attributes, keywords, titles, bullet points, descriptions,
            marketplace fields, character limits and spreadsheet cleanup.
          </p>
          <p className="max-w-2xl mx-auto text-[var(--body-text)] leading-relaxed mb-8">Then you do it again for the next SKU.</p>

          <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
            {problemFlow.map((step, i) => (
              <div key={step} className="flex items-center gap-2">
                <span className="text-xs font-medium text-[var(--muted-text)] bg-[var(--secondary-btn-bg)] border border-[var(--card-border)] rounded-full px-3 py-1.5">
                  {step}
                </span>
                {i < problemFlow.length - 1 && (
                  <ArrowRight size={14} className="text-[var(--muted-text)]" aria-hidden="true" />
                )}
              </div>
            ))}
          </div>

          <p className="text-lg font-semibold text-[var(--heading-text)]">
            Tesolute turns that entire workflow into one process.
          </p>
        </section>

        {/* -------------------------------------------------------------
            SOLUTION (spec section 10) */}
        <section className="max-w-6xl mx-auto px-6 py-16">
          <div className="text-center mb-12">
            <span className={eyebrowClass}>From Raw Assets to Ready-to-Upload</span>
            <h2 className={sectionHeadingClass}>You bring the product. Tesolute builds the listing.</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {solutionSteps.map((step) => (
              <div key={step.number}>
                <p className="text-3xl font-extrabold text-[var(--accent-sky-text)] leading-none mb-3">{step.number}</p>
                <h3 className="font-semibold text-[var(--heading-text)] mb-1.5">{step.title}</h3>
                <p className="text-sm text-[var(--body-text)]">{step.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* -------------------------------------------------------------
            KEY DIFFERENTIATION — "ChatGPT vs Tesolute" (spec section 11) */}
        <section className="max-w-6xl mx-auto px-6 py-16">
          <div className="text-center mb-12">
            <span className={eyebrowClass}>Why Tesolute?</span>
            <h2 className={sectionHeadingClass}>
              ChatGPT can write a product description. Tesolute builds the listing.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className={`p-6 ${cardClass}`}>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-text)] mb-4">Generic AI</h3>
              <ul className="flex flex-col gap-3">
                {genericAiPoints.map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-sm text-[var(--body-text)]">
                    <X size={16} className="text-[var(--danger-link-text)] shrink-0 mt-0.5" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <div className={`p-6 border-sky-500/30 ${cardClass}`}>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--accent-sky-text)] mb-4">Tesolute</h3>
              <ul className="flex flex-col gap-3">
                {tesolutePoints.map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-sm text-[var(--body-text)]">
                    <Check size={16} className="text-[var(--accent-sky-text)] shrink-0 mt-0.5" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-center text-lg font-semibold text-[var(--heading-text)] max-w-2xl mx-auto">
            The difference isn't better AI writing. It's understanding the job you're actually trying to get done.
          </p>
        </section>

        {/* -------------------------------------------------------------
            MARKETPLACE INTELLIGENCE (spec section 12) */}
        <section className="max-w-6xl mx-auto px-6 py-16">
          <div className="text-center mb-12">
            <span className={eyebrowClass}>Built for the Channel</span>
            <h2 className={sectionHeadingClass}>One product. Different marketplace. Different listing.</h2>
            <p className="max-w-2xl mx-auto text-[var(--body-text)] leading-relaxed">
              Amazon, Flipkart, Myntra and Etsy don't use the same catalog structure, content requirements or search
              behavior. Tesolute adapts your product listing to the marketplace you're selling on.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
            {marketplaceFields.map((mp) => (
              <div key={mp.name} className={`p-5 ${cardClass}`}>
                <h3 className="font-semibold text-[var(--heading-text)] mb-3">{mp.name}</h3>
                <ul className="flex flex-col gap-1.5">
                  {mp.fields.map((field) => (
                    <li key={field} className="text-sm text-[var(--body-text)]">
                      {field}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-center text-lg font-semibold text-[var(--heading-text)]">Create once. Adapt everywhere.</p>
        </section>

        {/* -------------------------------------------------------------
            COMPUTER VISION / ATTRIBUTE EXTRACTION (spec section 13) */}
        <section className="max-w-5xl mx-auto px-6 py-16">
          <div className="text-center mb-10">
            <span className={eyebrowClass}>Your Photos Already Contain the Data</span>
            <h2 className={sectionHeadingClass}>Stop typing what your product photos already show.</h2>
            <p className="max-w-2xl mx-auto text-[var(--body-text)] leading-relaxed mb-4">
              Upload your product images and Tesolute identifies relevant visual attributes automatically.
            </p>
            <p className="text-sm text-[var(--muted-text)]">Colour · Pattern · Material · Style · Design · Features</p>
          </div>
          <AttributeExtractionDemo />
        </section>

        {/* -------------------------------------------------------------
            BRAND VOICE (spec section 14) */}
        <section className="max-w-5xl mx-auto px-6 py-16 text-center">
          <span className={eyebrowClass}>Your Brand Should Sound Like Your Brand</span>
          <h2 className={sectionHeadingClass}>Teach Tesolute your voice once. Keep it across every SKU.</h2>
          <p className="max-w-2xl mx-auto text-[var(--body-text)] leading-relaxed mb-8">
            Define your brand's tone, vocabulary, style and content rules once. Tesolute applies them consistently
            across your entire catalog.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
            {brandVoiceTones.map((tone) => (
              <span key={tone} className={marketplaceChipClass}>
                {tone}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 text-left">
            {brandVoiceExamples.map((example) => (
              <div key={example.product} className={`p-4 ${cardClass}`}>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-text)] mb-1.5">
                  {example.product}
                </p>
                <p className="text-sm text-[var(--body-text)] italic">&ldquo;{example.copy}&rdquo;</p>
              </div>
            ))}
          </div>

          <p className="text-lg font-semibold text-[var(--heading-text)]">
            Your catalog grows. Your brand voice stays consistent.
          </p>
        </section>

        {/* -------------------------------------------------------------
            BULK CATALOGING (spec section 15) */}
        <section className="max-w-4xl mx-auto px-6 py-16 text-center">
          <span className={eyebrowClass}>Built for Catalogs, Not Just Products</span>
          <h2 className={sectionHeadingClass}>10 SKUs or 10,000. The workflow stays the same.</h2>
          <p className="max-w-2xl mx-auto text-[var(--body-text)] leading-relaxed mb-8">
            Upload your catalog once. Generate listings in bulk. Review everything in one workspace. Make changes
            inline. Export when you're ready.
          </p>
          <ul className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-x-6 gap-y-3 mb-8">
            {bulkChecklist.map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-[var(--body-text)]">
                <CheckCircle2 size={15} className="text-[var(--accent-sky-text)] shrink-0" />
                {item}
              </li>
            ))}
          </ul>
          <p className="text-sm text-[var(--muted-text)] max-w-xl mx-auto">
            No opening hundreds of spreadsheets. No copy-pasting between tabs. No repeating the same work SKU by SKU.
          </p>
        </section>

        {/* -------------------------------------------------------------
            BRANDS + AGENCIES (spec section 16) */}
        <section className="max-w-6xl mx-auto px-6 py-16">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div id="for-brands" className={`p-8 scroll-mt-20 ${cardClass}`}>
              <Building2 size={24} className="text-[var(--accent-sky-text)] mb-4" />
              <span className={eyebrowClass}>For E-Commerce Brands</span>
              <h3 className="text-2xl font-bold text-[var(--heading-text)] mb-3">Launch products faster.</h3>
              <p className="text-[var(--body-text)] mb-6">
                Turn your product assets into marketplace-ready listings without building a larger cataloging team.
              </p>
              <Link href="/workspace" className={secondaryCtaClass}>
                For Brands
                <ArrowRight size={16} />
              </Link>
            </div>

            <div id="for-agencies" className={`p-8 scroll-mt-20 border-sky-500/30 ${cardClass}`}>
              <Users size={24} className="text-[var(--accent-sky-text)] mb-4" />
              <span className={eyebrowClass}>For E-Commerce Agencies</span>
              <h3 className="text-2xl font-bold text-[var(--heading-text)] mb-3">
                Handle more catalogs without adding more people.
              </h3>
              <p className="text-[var(--body-text)] mb-6">
                Process multiple client catalogs while keeping each brand's content, voice and marketplace
                requirements separate.
              </p>
              <Link href="/workspace" className={secondaryCtaClass}>
                For Agencies
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------
            SUPPORTED MARKETPLACES (spec section 17) */}
        <section className="max-w-4xl mx-auto px-6 py-16 text-center">
          <span className={eyebrowClass}>Sell Where Your Customers Shop</span>
          <h2 className={sectionHeadingClass}>One catalog. Multiple marketplaces.</h2>
          <div className="flex flex-wrap items-center justify-center gap-3 mb-4">
            {SUPPORTED_MARKETPLACES.map((m) => (
              <span key={m} className={`${marketplaceChipClass} text-sm px-4 py-2`}>
                {MARKETPLACE_LABELS[m]}
              </span>
            ))}
          </div>
          <p className="text-sm text-[var(--muted-text)]">More marketplaces coming soon.</p>
        </section>

        {/* -------------------------------------------------------------
            HOW IT WORKS (spec section 18) */}
        <section className="py-16 bg-[var(--table-head-bg)]">
          <div className="max-w-5xl mx-auto px-6 text-center">
            <h2 className={sectionHeadingClass}>From product folder to marketplace catalog.</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 my-10">
              {howItWorksSteps.map((step, i) => (
                <div key={step.title}>
                  <div className="w-10 h-10 rounded-full bg-gradient-to-r from-blue-600 to-sky-600 text-white shadow-md shadow-sky-500/20 flex items-center justify-center mx-auto mb-3 font-bold">
                    {i + 1}
                  </div>
                  <h3 className="font-semibold text-[var(--heading-text)] mb-1">{step.title}</h3>
                  <p className="text-sm text-[var(--body-text)]">{step.description}</p>
                </div>
              ))}
            </div>
            <Link href="/workspace" className={primaryCtaClass}>
              Try It With Your Catalog
              <ArrowRight size={16} />
            </Link>
          </div>
        </section>

        {/* -------------------------------------------------------------
            PROOF (spec section 20) — placeholder testimonials removed
            entirely, replaced with the four problem->solution pairs the
            spec calls for instead of fabricated names/quotes/results. */}
        <section className="max-w-5xl mx-auto px-6 py-16 text-center">
          <span className={eyebrowClass}>Built for Real Catalog Operations</span>
          <h2 className={sectionHeadingClass}>Less cataloging. More selling.</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-10 text-left">
            {proofPoints.map((point) => (
              <div key={point.problem} className={`flex items-center gap-4 p-5 ${cardClass}`}>
                <span className="text-sm text-[var(--muted-text)] line-through decoration-[var(--muted-text)]/50 shrink-0">
                  {point.problem}
                </span>
                <ArrowRight size={16} className="text-[var(--accent-sky-text)] shrink-0" />
                <span className="text-sm font-semibold text-[var(--heading-text)]">{point.solution}</span>
              </div>
            ))}
          </div>
        </section>

        {/* -------------------------------------------------------------
            FINAL CTA (spec section 21) */}
        <section className="max-w-3xl mx-auto px-6 py-16 text-center">
          <span className={eyebrowClass}>Ready to Build Your Next Catalog?</span>
          <h2 className={sectionHeadingClass}>Your next 100 listings shouldn't take 100 hours.</h2>
          <p className="text-[var(--body-text)] mb-8">Upload your product data. Let Tesolute do the cataloging.</p>
          <Link href="/workspace" className={primaryCtaClass}>
            Create Your First Listing
            <ArrowRight size={16} />
          </Link>
          <p className="text-xs text-[var(--muted-text)] mt-3">10 free credits · No credit card required</p>
        </section>
      </main>

      {/* -----------------------------------------------------------------
          FOOTER (spec section 22) */}
      <footer className="border-t py-12 border-[var(--card-border)]">
        <div className="max-w-6xl mx-auto px-6 grid grid-cols-2 sm:grid-cols-4 gap-8">
          <div className="col-span-2 sm:col-span-1">
            <p className="font-bold text-[var(--heading-text)] mb-2">Tesolute</p>
            <p className="text-sm text-[var(--muted-text)]">AI cataloging for e-commerce brands and agencies.</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-text)] mb-3">Navigation</p>
            <ul className="flex flex-col gap-2 text-sm">
              <li>
                <Link href="/#product" className="text-[var(--body-text)] hover:text-[var(--heading-text)] transition-colors">
                  Product
                </Link>
              </li>
              <li>
                <Link href="/how-it-works" className="text-[var(--body-text)] hover:text-[var(--heading-text)] transition-colors">
                  How It Works
                </Link>
              </li>
              <li>
                <Link href="/#for-brands" className="text-[var(--body-text)] hover:text-[var(--heading-text)] transition-colors">
                  For Brands
                </Link>
              </li>
              <li>
                <Link href="/#for-agencies" className="text-[var(--body-text)] hover:text-[var(--heading-text)] transition-colors">
                  For Agencies
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-[var(--body-text)] hover:text-[var(--heading-text)] transition-colors">
                  Pricing
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-text)] mb-3">Tools</p>
            <ul className="flex flex-col gap-2 text-sm">
              <li>
                <Link href="/workspace" className="text-[var(--body-text)] hover:text-[var(--heading-text)] transition-colors">
                  Listing Generator
                </Link>
              </li>
              <li>
                <Link href="/audit" className="text-[var(--body-text)] hover:text-[var(--heading-text)] transition-colors">
                  Amazon Account Audit
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-text)] mb-3">Legal</p>
            {/* Plain text, not links — no privacy/terms pages exist yet in
                this app, and linking to a route that 404s is worse than a
                clearly-inert label. */}
            <ul className="flex flex-col gap-2 text-sm text-[var(--muted-text)]">
              <li>Privacy Policy</li>
              <li>Terms of Service</li>
            </ul>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-6 mt-10 pt-6 border-t border-[var(--card-border)] text-sm text-[var(--muted-text)]">
          &copy; {new Date().getFullYear()} Tesolute. All rights reserved.
        </div>
      </footer>
    </div>
  )
}
