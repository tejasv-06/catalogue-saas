import Link from 'next/link'
import Navbar from '@/components/Navbar'

const steps = [
  {
    title: '1. Upload',
    body: "Start by getting your products into Tesolute — either upload a CSV with all your products at once, or add them one at a time through the manual entry form. Before you begin, you can also set up a brand voice: a short profile of brand guidelines that Tesolute will follow when writing copy, so every listing sounds consistently on-brand rather than generic."
  },
  {
    title: '2. Generate',
    body: "Once your products are in the queue, Tesolute's AI generates marketplace-ready content for each one — titles, bullet points, and search keywords tailored to the specific marketplace you're listing on. It doesn't just read your raw description: if you've attached a product photo, the AI analyzes the image itself, picking up on color, pattern, material, and other visual details that get folded directly into the generated copy."
  },
  {
    title: '3. Review',
    body: "Nothing goes out unchecked. Every generated listing lands in a review queue where you can read exactly what the AI produced, approve it as-is, or send it back for another pass if something's off. This keeps a human in the loop before anything reaches a live marketplace listing."
  },
  {
    title: '4. Export',
    body: "Once you've approved a batch of listings, export them as a single marketplace-ready CSV file, formatted to match the exact columns and structure that platform expects — ready to upload directly into your marketplace seller dashboard."
  }
]

export default function HowItWorksPage() {
  return (
    <div className="flex flex-col min-h-screen bg-[var(--page-bg)] text-[var(--body-text)]">
      <Navbar />
      <main className="flex-1 max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-[var(--heading-text)] mb-4">How Tesolute works</h1>
        <p className="text-[var(--body-text)] mb-12">
          A closer look at the four steps that take you from raw product data to a marketplace-ready listing.
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
            Try Workspace
          </Link>
        </div>
      </main>
    </div>
  )
}
