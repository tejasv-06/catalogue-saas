// Milestone C17.3: Multi-image Product Intelligence.
//
// Two kinds of tests:
//   1. Real, executable tests against resolveProductImageUrls: a pure,
//      side-effect-free function (this file has no Groq/Supabase client
//      construction to worry about, unlike importing route.ts directly
//      would), covering dedup, blank-filtering, the 5-image cap, and the
//      pre-C17.1 single-image fallback with real inputs.
//   2. Source-inspection tests for app/api/enrich-product/route.ts's own
//      POST handler / prompt / fallback logic, matching the convention
//      every other CatalogueWorkspace.*.test.ts file in this repo already
//      uses for logic that can't be isolated/imported (that route module
//      instantiates a real Groq client at import time, so it's never
//      imported directly by tests: see the module's own doc comment).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveProductImageUrls, MAX_INTELLIGENCE_IMAGES } from './productIntelligenceImages'

const routeSource = readFileSync(join(__dirname, '..', 'app', 'api', 'enrich-product', 'route.ts'), 'utf8')
const schemaSource = readFileSync(join(__dirname, 'productIntelligence.ts'), 'utf8')

function bodyOf(fnSignature: string, window = 1600): string {
  const start = routeSource.indexOf(fnSignature)
  assert.ok(start !== -1, `expected to find "${fnSignature}" in app/api/enrich-product/route.ts`)
  return routeSource.slice(start, start + window)
}

// --- A/B/C: one, two, and five images -------------------------------------

test('A. one image -> exactly one URL resolved', () => {
  const result = resolveProductImageUrls({ image_url: 'https://x/1.jpg', image_urls: ['https://x/1.jpg'] })
  assert.deepEqual(result, ['https://x/1.jpg'])
})

test('B. two images -> both resolved, in order', () => {
  const result = resolveProductImageUrls({
    image_url: 'https://x/1.jpg',
    image_urls: ['https://x/1.jpg', 'https://x/2.jpg']
  })
  assert.deepEqual(result, ['https://x/1.jpg', 'https://x/2.jpg'])
})

test('C. five images -> all five resolved, in order', () => {
  assert.equal(MAX_INTELLIGENCE_IMAGES, 5)
  const urls = ['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg', 'https://x/4.jpg', 'https://x/5.jpg']
  const result = resolveProductImageUrls({ image_url: urls[0], image_urls: urls })
  assert.deepEqual(result, urls)
})

// --- D: more than five -------------------------------------------------------

test('D. six or more images -> only the first five valid ones are used', () => {
  const urls = ['1', '2', '3', '4', '5', '6', '7'].map((n) => `https://x/${n}.jpg`)
  const result = resolveProductImageUrls({ image_url: urls[0], image_urls: urls })
  assert.equal(result.length, 5)
  assert.deepEqual(result, urls.slice(0, 5))
})

// --- E: blank values ---------------------------------------------------------

test('E. blank/empty/whitespace-only entries are dropped, only valid URLs remain', () => {
  const result = resolveProductImageUrls({
    image_url: 'https://x/1.jpg',
    image_urls: ['https://x/1.jpg', '', 'https://x/3.jpg', '   ', 'https://x/5.jpg']
  })
  assert.deepEqual(result, ['https://x/1.jpg', 'https://x/3.jpg', 'https://x/5.jpg'])
})

// --- F: duplicates -----------------------------------------------------------

test('F. duplicate URLs are removed, keeping the first occurrence (so primary-image ordering is unaffected)', () => {
  const result = resolveProductImageUrls({
    image_url: 'https://x/1.jpg',
    image_urls: ['https://x/1.jpg', 'https://x/2.jpg', 'https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg']
  })
  assert.deepEqual(result, ['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg'])
})

// --- G: no images ------------------------------------------------------------

test('G. no images at all -> empty array (existing text-only path is what the caller falls back to)', () => {
  assert.deepEqual(resolveProductImageUrls({ image_url: null, image_urls: [] }), [])
})

// --- Backward compatibility: pre-C17.1 rows (image_urls empty, only the
// singular image_url populated) ---------------------------------------------

test('a pre-C17.1 product row (empty image_urls, populated image_url) still resolves its one image', () => {
  const result = resolveProductImageUrls({ image_url: 'https://x/legacy.jpg', image_urls: [] })
  assert.deepEqual(result, ['https://x/legacy.jpg'])
})

test('once image_urls is non-empty, image_url is never separately re-added (no duplicate primary)', () => {
  const result = resolveProductImageUrls({ image_url: 'https://x/1.jpg', image_urls: ['https://x/1.jpg', 'https://x/2.jpg'] })
  assert.equal(result.filter((u) => u === 'https://x/1.jpg').length, 1)
})

// --- H: product isolation (this is a pure function of its own single
// argument: there is no module-level state it could leak through) --------

test('H. resolveProductImageUrls is a pure function of its argument alone: two different products never share state', () => {
  const a = resolveProductImageUrls({ image_url: 'https://x/a.jpg', image_urls: ['https://x/a.jpg'] })
  const b = resolveProductImageUrls({ image_url: 'https://x/b.jpg', image_urls: ['https://x/b.jpg'] })
  assert.deepEqual(a, ['https://x/a.jpg'])
  assert.deepEqual(b, ['https://x/b.jpg'])
  // Mutating one result must never affect a result already returned for a
  // different product (would only be possible via shared/cached state).
  a.push('https://x/mutated.jpg')
  assert.deepEqual(b, ['https://x/b.jpg'])
})

// --- Source-inspection: the rest of the route's real behavior --------------

test('runEnrichmentCompletion builds one image_url content block per resolved URL, never hard-coded to exactly one', () => {
  const body = bodyOf("async function runEnrichmentCompletion(promptText: string, imageUrls: string[])")
  assert.match(body, /imageUrls\.map\(\(url\) => \(\{ type: 'image_url' as const, image_url: \{ url \} \}\)\)/)
})

test('the POST handler resolves images once via resolveProductImageUrls and reuses that single result for both the prompt wording and the actual Groq call', () => {
  const body = bodyOf('export async function POST(request: Request) {', 5000)
  assert.match(body, /const resolvedImageUrls = resolveProductImageUrls\(product\)\.map\(formatDirectImageUrl\)/)
  assert.match(body, /runEnrichmentCompletionWithFallback\(promptText, resolvedImageUrls, hasDescription\)/)
})

test('the system prompt gained multi-image guidance without changing the 9-field schema/example contract', () => {
  const body = bodyOf('function buildSystemPrompt(): string {', 3500)
  assert.match(body, /multiple views of the SAME product/)
  assert.match(body, /never a separate interpretation per image/)
  // Schema-shape rules (the exact-9-fields contract) are untouched.
  assert.match(body, /MUST be an object shaped exactly like \{ "value": \.\.\., "confidence": "\.\.\." \}/)
})

test('L. one bad image among several falls back to text-only (never per-image retries, never fabricates what the bad image showed)', () => {
  const body = bodyOf('async function runEnrichmentCompletionWithFallback(')
  assert.match(body, /if \(imageUrls\.length > 0 && hasDescription && isInvalidImageError\(err\)\) \{/)
  assert.match(body, /return await runEnrichmentCompletion\(promptText, \[\]\)/)
  // Never a loop/per-image retry: exactly one fallback attempt, with zero images.
  assert.ok(!/for \(.*imageUrls/.test(body))
})

test('with no description and no valid image, the route fails cleanly instead of calling Groq with an empty task', () => {
  const body = bodyOf('export async function POST(request: Request) {', 4000)
  assert.match(body, /if \(!hasDescription && resolvedImageUrls\.length === 0\) \{/)
  assert.match(body, /Product has neither a description nor an image to analyze/)
})

test('9. Product Intelligence schema itself (lib/productIntelligence.ts) was not touched: this milestone is input-only', () => {
  assert.ok(!/image_urls|imageUrls|images:/.test(schemaSource), 'ProductIntelligenceData must remain purely text-attribute-based')
})

test('K. generate-single/route.ts never performs a second Product Intelligence analysis: buildIntelligenceSummary only reads already-completed text fields', () => {
  const generateSingleSource = readFileSync(join(__dirname, '..', 'app', 'api', 'generate-single', 'route.ts'), 'utf8')
  assert.match(generateSingleSource, /function buildIntelligenceSummary\(intelligence: unknown\): string \{/)
  assert.ok(
    !/enrich-product|runEnrichmentCompletion/.test(generateSingleSource),
    'generate-single must never call into the enrichment route/logic itself'
  )
})

test('M. one enrichment request carries both seller-provided product information (brand/category/description) and the resolved images', () => {
  const body = bodyOf('export async function POST(request: Request) {', 5000)
  // promptText (the text half of the one user message) still carries brand/category/description.
  assert.match(body, /Brand: \$\{product\.brand_name \|\| 'N\/A'\}/)
  assert.match(body, /Category: \$\{product\.category \|\| 'unspecified'\}/)
  assert.match(body, /Raw description: \$\{product\.description\}/)
  // The same call passes both promptText and the resolved images together:
  // one request, not two.
  assert.match(body, /runEnrichmentCompletionWithFallback\(promptText, resolvedImageUrls, hasDescription\)/)
})

test('client-side wiring (CatalogueWorkspace.tsx) needed no change for multi-image support: the route already re-derives images server-side from just { productId }', () => {
  const workspaceSource = readFileSync(join(__dirname, '..', 'components', 'CatalogueWorkspace.tsx'), 'utf8')
  const start = workspaceSource.indexOf('async function runProductIntelligenceAnalysis(')
  assert.ok(start !== -1)
  const body = workspaceSource.slice(start, start + 500)
  assert.match(body, /body: JSON\.stringify\(\{ productId: serverId \}\)/)
})
