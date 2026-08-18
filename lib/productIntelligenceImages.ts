// Milestone C17.3: Multi-image Product Intelligence input resolution.
//
// Pure and side-effect-free, deliberately kept out of
// app/api/enrich-product/route.ts's own module scope (which instantiates a
// real Groq client at import time): same reasoning lib/productIntelligence.ts
// and lib/catalogReconciliation.ts already document for their own
// highest-risk logic: this is unit-testable for real with plain node:test,
// not only via source-inspection or live verification.

// Up to this many images go into ONE enrichment request: never one request
// per image (that would be a second, per-image "analysis," not the single
// canonical understanding this milestone's own architecture requires).
// Matches MAX_MANUAL_IMAGES (lib/types.ts), the seller-facing cap on how
// many images a product can even have.
export const MAX_INTELLIGENCE_IMAGES = 5

// image_urls (C17.1) is the canonical ordered list; a product row written
// before C17.1 shipped has image_urls as an empty array with only the
// singular image_url populated, so that's the one fallback case: never
// merged with image_urls, since image_urls is always the complete,
// already-including-the-primary list once any C17.1-era write path has
// touched this product (image_url is always image_urls[0] by construction:
// see CatalogueWorkspace.tsx's commitAddProduct/ensureServerProduct/
// handleUploadCsv). Blank entries are dropped and exact duplicates are
// removed (keeping the first occurrence, so ordering: and therefore which
// image stays primary: is unaffected), then capped at
// MAX_INTELLIGENCE_IMAGES.
export function resolveProductImageUrls(product: { image_url: string | null; image_urls: string[] }): string[] {
  const raw = product.image_urls.length > 0 ? product.image_urls : product.image_url ? [product.image_url] : []
  const seen = new Set<string>()
  const resolved: string[] = []
  for (const url of raw) {
    const trimmed = (url ?? '').trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    resolved.push(trimmed)
    if (resolved.length === MAX_INTELLIGENCE_IMAGES) break
  }
  return resolved
}
