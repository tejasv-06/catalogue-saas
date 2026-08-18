import Link from 'next/link'
import Navbar from '@/components/Navbar'
import { GUEST_GENERATION_LIMIT } from '@/lib/limits'

// Same 5-step workflow as the homepage's "The Tesolute Workflow" section:
// this page is the expanded version, not a differently-worded second
// explanation of the same thing.
const steps = [
  {
    title: '1. Add',
    body: "Start by getting your products into Tesolute: upload a CSV with all your products at once, add them one at a time through the manual entry form, or start from product photos alone if that's all you have. Before you begin, you can also set up a brand voice, a short profile of brand guidelines that Tesolute will follow when writing copy, so every listing sounds consistently on-brand rather than generic."
  },
  {
    title: '2. Generate',
    body: "Once your products are in the queue, Tesolute generates marketplace-ready content for each one: titles, bullet points, descriptions and search keywords tailored to the specific marketplace you're listing on. It doesn't just read your raw description. If you've attached a product photo, Tesolute analyzes the image itself, picking up on color, pattern, material, and other visual details that get folded directly into the generated copy."
  },
  {
    title: '3. Validate',
    body: "Every generated listing is automatically checked against the requirements of the marketplace you're selling on: required fields, character limits, and missing information are flagged before you ever see it, so you know exactly what's ready to publish and what still needs attention."
  },
  {
    title: '4. Review',
    body: "Nothing goes out unchecked. Every listing lands in a review screen where you can read exactly what Tesolute produced, see which marketplace checks passed, approve it as-is, or regenerate just the part that needs work (a title, a set of bullets, the description) without starting over. This keeps a human in the loop before anything reaches a live marketplace listing."
  },
  {
    title: '5. Export',
    body: "Once you've approved a batch of listings, export them as a single marketplace-ready CSV file, formatted to match the exact columns and structure that platform expects, ready to upload directly into your marketplace seller dashboard."
  }
]

export default function HowItWorksPage() {
  return (
    <div className="flex flex-col min-h-screen bg-[var(--page-bg)] text-[var(--body-text)]">
      <Navbar />
      <main className="flex-1 max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-[var(--heading-text)] mb-4">How Tesolute works</h1>
        <p className="text-[var(--body-text)] mb-12">
          A closer look at the five steps that take you from raw product data to a marketplace-ready listing.
        </p>
        <div className="flex flex-col gap-10">
          {steps.map((step) => (
            <div key={step.title}>
              <h2 className="text-xl font-semibold text-[var(--heading-text)] mb-2">{step.title}</h2>
              <p className="text-[var(--body-text)]">{step.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-12">
          <Link
            href="/workspace"
            className="inline-block bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl shadow-lg shadow-blue-500/20 transition-colors"
          >
            Start Generating Listings ({GUEST_GENERATION_LIMIT} Free Credits)
          </Link>
        </div>
      </main>
    </div>
  )
}
