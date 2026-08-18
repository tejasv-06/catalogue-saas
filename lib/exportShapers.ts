export const exportColumns: Record<string, string[]> = {
  amazon: ['title', 'description', 'bullet_1', 'bullet_2', 'bullet_3', 'bullet_4', 'bullet_5', 'generic_keywords'],
  flipkart: [
    'title', 'description',
    'key_feature_1', 'key_feature_2', 'key_feature_3', 'key_feature_4', 'key_feature_5',
    'search_keyword_1', 'search_keyword_2', 'search_keyword_3', 'search_keyword_4', 'search_keyword_5'
  ],
  myntra: ['vendor_article_name', 'list_view_name', 'product_details', 'style_note', 'product_display_name', 'tags'],
  etsy: [
    'title', 'description',
    'tag_1', 'tag_2', 'tag_3', 'tag_4', 'tag_5', 'tag_6', 'tag_7',
    'tag_8', 'tag_9', 'tag_10', 'tag_11', 'tag_12', 'tag_13'
  ]
}

// snake_case export key -> "Title Case" words, e.g. 'generic_keywords' ->
// 'Generic Keywords', 'bullet_1' -> 'Bullet 1'. Derived straight from
// exportColumns' own keys (never a hand-authored parallel list) so a header
// label can never drift out of sync with the actual column key it labels.
function humanizeColumnKey(key: string): string {
  return key
    .split('_')
    .map((word) => (word[0] ?? '').toUpperCase() + word.slice(1))
    .join(' ')
}

// Human-readable CSV header for every generated column, per marketplace:
// same keys as exportColumns, "Generated " + Title Case instead of the raw
// snake_case key. Exists so a raw-vs-AI-output column can be told apart at a
// glance in a spreadsheet (see performExport in CatalogueWorkspace.tsx,
// which prepends its own "Original *" raw-input columns ahead of these).
export const generatedColumnLabels: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(exportColumns).map(([marketplace, columns]) => [
    marketplace,
    Object.fromEntries(columns.map((key) => [key, `Generated ${humanizeColumnKey(key)}`]))
  ])
)

// The seller's own raw input, never touched by generation (see
// lib/types.ts's DraftProduct: brandName/category/description/imageUrl are
// written once at add-time, whether from Manual Entry, Photos Only, or a
// Bulk Upload CSV row, and generation only ever writes into
// generatedContent, a separate field). Positioned before a marketplace's
// generated columns in every export so a spreadsheet reader sees input
// before output, left to right.
export const RAW_COLUMNS = ['Original Brand', 'Original Category', 'Original Description', 'Original Image'] as const

export function buildRawColumnsRow(product: {
  brandName: string
  category: string
  description: string
  imageUrl: string | null
}): Record<string, string> {
  return {
    'Original Brand': product.brandName || '',
    'Original Category': product.category || '',
    'Original Description': product.description || '',
    // product.imageUrl already holds whichever real reference applies: the
    // Supabase Storage URL for an uploaded image (Manual Entry/Photos Only)
    // or the raw URL string from a Bulk Upload CSV's own image column:
    // never a placeholder; null only when no image was ever provided.
    'Original Image': product.imageUrl || 'No image provided'
  }
}

export function flattenRow(marketplace: string, generatedContent: any): Record<string, string> | null {
  const gc = generatedContent || {}

  switch (marketplace) {
    case 'amazon': {
      const bullets = gc.bullets || []
      return {
        title: gc.title || '',
        description: gc.description || '',
        bullet_1: bullets[0] || '',
        bullet_2: bullets[1] || '',
        bullet_3: bullets[2] || '',
        bullet_4: bullets[3] || '',
        bullet_5: bullets[4] || '',
        generic_keywords: gc.genericKeywords || ''
      }
    }
    case 'flipkart': {
      const keyFeatures = gc.keyFeatures || []
      const searchKeywords = gc.searchKeywords || []
      return {
        title: gc.title || '',
        description: gc.description || '',
        key_feature_1: keyFeatures[0] || '',
        key_feature_2: keyFeatures[1] || '',
        key_feature_3: keyFeatures[2] || '',
        key_feature_4: keyFeatures[3] || '',
        key_feature_5: keyFeatures[4] || '',
        search_keyword_1: searchKeywords[0] || '',
        search_keyword_2: searchKeywords[1] || '',
        search_keyword_3: searchKeywords[2] || '',
        search_keyword_4: searchKeywords[3] || '',
        search_keyword_5: searchKeywords[4] || ''
      }
    }
    case 'myntra': {
      return {
        vendor_article_name: gc.vendorArticleName || '',
        list_view_name: gc.listViewName || '',
        product_details: gc.productDetails || '',
        style_note: gc.styleNote || '',
        product_display_name: gc.productDisplayName || '',
        tags: gc.tags || ''
      }
    }
    case 'etsy': {
      const tags = gc.tags || []
      const row: Record<string, string> = {
        title: gc.title || '',
        description: gc.description || ''
      }
      for (let i = 0; i < 13; i++) {
        row[`tag_${i + 1}`] = tags[i] || ''
      }
      return row
    }
    default:
      return null
  }
}
