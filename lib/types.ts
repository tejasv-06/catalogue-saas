export type DraftProduct = {
  id: string
  brandName: string
  description: string
  category: string
  imageFile: File | null
  imageUrl: string | null
  targetMarketplace: string
  generatedContent: any | null
  status: 'draft' | 'generated' | 'approved'
  generationError: string | null
  skipBrandVoice: boolean
}

export type CsvSummary = {
  fileName: string
  total: number
  added: number
  skipped: number
}

export type PendingCsvUpload = {
  fileName: string
  total: number
  matchingProducts: DraftProduct[]
  mismatchedProducts: DraftProduct[]
}
