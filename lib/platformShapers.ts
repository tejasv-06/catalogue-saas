type AiResult = {
  title: string
  description: string
  bullets: string[]
  keywordPool: string[]
}

// Marketplaces with real shaping (below) and export-column mapping
// (lib/exportShapers.ts) — the single source of truth for what the app
// actually supports end-to-end. tatacliq was previously offered in the
// dropdown but has no case in either file (falls through to the generic
// `default` below, and to `flattenRow`'s `default: return null` on export,
// which silently drops approved tatacliq products from the CSV) — dropped
// here until real support is built. shopify was never added.
export const SUPPORTED_MARKETPLACES = ['amazon', 'flipkart', 'myntra', 'etsy'] as const

export function shapeForPlatform(marketplace: string, ai: AiResult, product: any) {
  const pool = ai.keywordPool || []

  switch (marketplace) {
    case 'amazon':
      return {
        title: ai.title.slice(0, 75),
        description: ai.description,
        bullets: (ai.bullets || []).slice(0, 5).map(b => b.slice(0, 200)),
        genericKeywords: pool.slice(0, 25).join(' ').slice(0, 200)
      }
    case 'flipkart':
      return {
        title: ai.title.slice(0, 100),
        description: (ai.description || '').slice(0, 2000),
        keyFeatures: (ai.bullets || []).slice(0, 5).map(b => b.slice(0, 100)),
        searchKeywords: pool.slice(0, 5).map(k => k.split(' ').slice(0, 3).join(' '))
      }
    case 'myntra':
      return {
        vendorArticleName: ai.title.slice(0, 50),
        listViewName: ai.title.slice(0, 30),
        productDetails: ai.description,
        styleNote: (ai.bullets && ai.bullets[0]) || '',
        productDisplayName: `${product.brand_name || ''} ${ai.title}`.trim(),
        tags: pool.join(', ')
      }
    case 'etsy':
      return {
        title: ai.title.slice(0, 140),
        description: ai.description,
        tags: pool.slice(0, 13)
      }
    default:
      return { title: ai.title, description: ai.description, bullets: ai.bullets, tags: pool }
  }
}