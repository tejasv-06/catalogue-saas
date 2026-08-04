import Link from 'next/link'
import Navbar from '@/components/Navbar'
import { cardClass } from '@/lib/uiClasses'

const features = [
  {
    title: 'Bulk CSV & Manual Upload',
    description: "Upload hundreds of products at once via CSV, or add them one at a time through a guided form."
  },
  {
    title: 'Marketplace-Specific AI Content',
    description: "Generate titles, bullets, and keywords tailored to each marketplace's own rules — Amazon, Flipkart, Myntra, Etsy, and more."
  },
  {
    title: 'Vision-Based Image Analysis',
    description: "Our AI reads your product photos too, pulling out color, pattern, and material details you'd otherwise have to type by hand."
  },
  {
    title: 'Review & Approve Workflow',
    description: 'Every generated listing is reviewed before it ships — approve, edit, or regenerate with one click.'
  },
  {
    title: 'One-Click Export',
    description: 'Download a marketplace-ready CSV for your approved listings, formatted exactly the way each platform expects.'
  }
]

const steps = [
  { title: 'Upload', description: 'Add products via CSV or one at a time.' },
  { title: 'Generate', description: 'AI writes marketplace-ready copy.' },
  { title: 'Review', description: 'Approve, edit, or regenerate.' },
  { title: 'Export', description: 'Download a ready-to-upload file.' }
]

const testimonials = [
  {
    quote: "Tesolute cut our listing time from a full day to about twenty minutes per batch. It's become part of our onboarding checklist for every new client.",
    name: 'Priya N.',
    role: 'Founder, boutique e-commerce agency'
  },
  {
    quote: 'The marketplace-specific formatting alone was worth switching for — no more manually reformatting the same product for four different platforms.',
    name: 'Marcus T.',
    role: 'Seller operations lead'
  },
  {
    quote: "I was skeptical about AI writing copy from a photo, but it actually picks up on details I'd forget to mention myself.",
    name: 'Dana R.',
    role: 'Independent seller'
  }
]

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-[var(--page-bg)] text-[var(--body-text)]">
      <Navbar />

      <main className="flex-1">
        <section className="max-w-5xl mx-auto px-6 py-20 text-center">
          <h1 className="text-4xl font-bold text-[var(--heading-text)] mb-4">List products everywhere, in minutes, not hours.</h1>
          <p className="text-lg text-[var(--body-text)] max-w-2xl mx-auto mb-8">
            Tesolute is an AI-powered catalogue listing tool for e-commerce sellers and agencies — upload your
            products once, and get marketplace-ready titles, bullets, and keywords for Amazon, Flipkart, Myntra,
            Etsy, and more.
          </p>
          <Link
            href="/workspace"
            className="inline-block bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl text-lg font-medium shadow-lg shadow-blue-500/20 transition-colors"
          >
            Try Workspace
          </Link>
        </section>

        <section className="max-w-5xl mx-auto px-6 py-16">
          <h2 className="text-2xl font-bold text-[var(--heading-text)] text-center mb-10">Everything you need to list faster</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <div
                key={feature.title}
                className={`p-6 hover:opacity-90 transition ${cardClass}`}
              >
                <h3 className="font-semibold text-[var(--heading-text)] mb-2">{feature.title}</h3>
                <p className="text-sm text-[var(--body-text)]">{feature.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-6 pb-16">
          <div className={`p-8 flex flex-col sm:flex-row items-center justify-between gap-6 ${cardClass}`}>
            <div>
              <h2 className="text-xl font-bold text-[var(--heading-text)] mb-2">AI Account Audit &amp; Revenue Insights</h2>
              <p className="text-sm text-[var(--body-text)] max-w-xl">
                Upload your Amazon sales &amp; traffic report and get a verified, AI-written diagnosis of what&apos;s
                working, what isn&apos;t, and what to fix next.
              </p>
            </div>
            <Link
              href="/audit"
              className="shrink-0 inline-block bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl text-sm font-medium shadow-lg shadow-blue-500/20 transition-colors"
            >
              Run an Audit
            </Link>
          </div>
        </section>

        <section className="py-16 bg-[var(--table-head-bg)]">
          <div className="max-w-5xl mx-auto px-6">
            <h2 className="text-2xl font-bold text-[var(--heading-text)] text-center mb-10">How it works</h2>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-8">
              {steps.map((step, i) => (
                <div key={step.title} className="text-center">
                  <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center mx-auto mb-3 font-bold">
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

        <section className="max-w-5xl mx-auto px-6 py-16">
          <h2 className="text-2xl font-bold text-[var(--heading-text)] text-center mb-2">What sellers are saying</h2>
          <p className="text-center text-xs text-[var(--muted-text)] mb-10">
            (Placeholder quotes — will be replaced with real customer testimonials)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
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
        <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-[var(--muted-text)]">
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
