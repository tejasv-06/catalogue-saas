import type { DiagnosisCode } from '@/lib/performanceDiagnosis'

// Milestone C15: §11 Recommendation Engine. Deterministic, diagnosis ->
// recommendation text only (no generative AI, no credit cost: §19). One
// centralized mapping, same discipline as lib/productHistory.ts's
// EVENT_TYPE_LABELS: no other file is allowed to hardcode its own copy of
// this text.
//
// §11's own explicit language rule: never claim a change WILL improve
// sales: only "consider," "Tesolute recommends reviewing," "potential
// issue." Every entry below follows that, and every entry names what to
// INVESTIGATE, not a guaranteed fix.
export const DIAGNOSIS_RECOMMENDATIONS: Partial<Record<DiagnosisCode, string>> = {
  DISCOVERABILITY_WEAK: 'Tesolute recommends reviewing marketplace keyword coverage and listing relevance for this product.',
  CTR_WEAK: 'Consider reviewing the primary product image, title, and search relevance.',
  CONVERSION_WEAK: 'Consider reviewing listing content, pricing, offer, and product-page clarity.',
  ATC_WEAK: 'Potential issue: shoppers may not find enough reason to add this to cart: consider reviewing pricing, images, and key selling points.',
  RETURNS_HIGH: 'Consider reviewing product expectations, images, specifications, and description accuracy.',
  RATING_WEAK: 'Potential issue: recent reviews may point to a product-quality or expectation mismatch worth investigating.',
  PERFORMANCE_DECLINING: 'Consider comparing this period against the previous one to identify what changed: listing edits, pricing, competition, or seasonality.',
  INSUFFICIENT_DATA: 'Not enough traffic yet for a reliable diagnosis: check back after this listing accumulates more impressions or clicks.'
}

// Deliberately no entries for the *_HEALTHY / TRAFFIC_HEALTHY /
// PERFORMANCE_IMPROVING codes: a healthy signal has nothing to
// "investigate," and inventing filler praise text would be exactly the
// kind of generative-sounding, unearned claim §11 warns against.

export function getRecommendation(code: DiagnosisCode): string | null {
  return DIAGNOSIS_RECOMMENDATIONS[code] ?? null
}

// Milestone C15: Seller Performance Intelligence & Action Engine.
// Extends this same recommendation engine (not a second one) with the
// business-language "areas to investigate" lists the seller-facing action
// report/UI need per problem area (lib/performanceIntelligence.ts's
// classifyProblemArea groups diagnosis codes into these same five areas).
// Same §11 discipline as DIAGNOSIS_RECOMMENDATIONS above: every entry
// names what to look at, never a confirmed cause.
export const INVESTIGATE_AREAS: Record<'purchase-conversion' | 'product-page-engagement' | 'click-through' | 'returns' | 'rating' | 'stock-recovery', string[]> = {
  'purchase-conversion': [
    'Selling price',
    'Discount / offer',
    'Delivery promise',
    'Stock availability',
    'Ratings / reviews',
    'Product-page trust',
    'Product expectation vs. actual offering'
  ],
  'product-page-engagement': ['Images', 'Product information', 'Specifications', 'Value proposition', 'Pricing', 'Product presentation'],
  'click-through': ['Primary image', 'Title', 'Price presentation', 'Product positioning', 'Search / category relevance'],
  returns: ['Inaccurate catalog information', 'Product images', 'Sizing / dimensions', 'Product quality', 'Expectation vs. delivered product'],
  rating: ['Recent reviews', 'Product-quality consistency', 'Expectation mismatch'],
  'stock-recovery': ['Recent stock-out / restock timing', 'Marketplace ranking recovery lag', 'Inventory continuity']
}

// Milestone C15: Performance Intelligence relative-diagnosis engine
// (lib/performanceIntelligence.ts's diagnoseRelative/RelativeDiagnosis).
// Same §11 discipline: one sentence naming what to investigate, never a
// guaranteed fix or a confirmed cause.
export const AREA_RECOMMENDATIONS: Record<keyof typeof INVESTIGATE_AREAS, string> = {
  'purchase-conversion': 'Consider reviewing listing content, pricing, offer, and product-page clarity.',
  'product-page-engagement': 'Potential issue: shoppers may not find enough reason to add this to cart: consider reviewing pricing, images, and key selling points.',
  'click-through': 'Consider reviewing the primary product image, title, and search relevance.',
  returns: 'Consider reviewing product expectations, images, specifications, and description accuracy.',
  rating: 'Potential issue: recent reviews may point to a product-quality or expectation mismatch worth investigating.',
  'stock-recovery': 'Consider monitoring visibility over the next reporting period: recently restocked listings can take time for marketplace search ranking to recover.'
}

export function getAreaRecommendation(area: keyof typeof AREA_RECOMMENDATIONS): string {
  return AREA_RECOMMENDATIONS[area]
}
