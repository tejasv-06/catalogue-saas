"use client"

import { useEffect, useRef, useState, type DragEvent } from 'react'
import Papa from 'papaparse'
import { pick } from '@/lib/csvMapping'
import { exportColumns, flattenRow } from '@/lib/exportShapers'
import ClientSelector, { type Client } from '@/components/ClientSelector'
import LogoutButton from '@/components/LogoutButton'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type DraftProduct = {
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
  imageMissingAfterRestore: boolean
  skipBrandVoice: boolean
}

type CsvSummary = {
  fileName: string
  total: number
  added: number
  skipped: number
}

type PendingCsvUpload = {
  fileName: string
  total: number
  matchingProducts: DraftProduct[]
  mismatchedProducts: DraftProduct[]
}

const marketplaces = ['amazon', 'flipkart', 'myntra', 'etsy', 'tatacliq']

const SESSION_STORAGE_KEY = 'catalogue-draft-session'
const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000

const GUEST_PRODUCT_LIMIT = 10

function truncate(text: string, length: number) {
  return text.length > length ? text.slice(0, length) + '…' : text
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function getDisplayFields(marketplace: string, gc: any): { label: string; value: string }[] {
  switch (marketplace) {
    case 'amazon':
      return [
        { label: 'Title', value: gc.title || '' },
        { label: 'Description', value: gc.description || '' },
        ...(gc.bullets || []).map((b: string, i: number) => ({ label: `Bullet ${i + 1}`, value: b })),
        { label: 'Generic Keywords', value: gc.genericKeywords || '' }
      ]
    case 'flipkart':
      return [
        { label: 'Title', value: gc.title || '' },
        { label: 'Description', value: gc.description || '' },
        ...(gc.keyFeatures || []).map((f: string, i: number) => ({ label: `Key Feature ${i + 1}`, value: f })),
        ...(gc.searchKeywords || []).map((k: string, i: number) => ({ label: `Search Keyword ${i + 1}`, value: k }))
      ]
    case 'myntra':
      return [
        { label: 'Vendor Article Name', value: gc.vendorArticleName || '' },
        { label: 'List View Name', value: gc.listViewName || '' },
        { label: 'Product Details', value: gc.productDetails || '' },
        { label: 'Style Note', value: gc.styleNote || '' },
        { label: 'Product Display Name', value: gc.productDisplayName || '' },
        { label: 'Tags', value: gc.tags || '' }
      ]
    case 'etsy':
      return [
        { label: 'Title', value: gc.title || '' },
        { label: 'Description', value: gc.description || '' },
        { label: 'Tags', value: (gc.tags || []).join(', ') }
      ]
    default:
      return [
        { label: 'Title', value: gc.title || '' },
        { label: 'Description', value: gc.description || '' },
        { label: 'Bullets', value: (gc.bullets || []).join(' | ') },
        { label: 'Tags', value: Array.isArray(gc.tags) ? gc.tags.join(', ') : gc.tags || '' }
      ]
  }
}

function ProductThumbnail({
  imageFile,
  imageUrl,
  alt,
  size = 80
}: {
  imageFile: File | null
  imageUrl: string | null
  alt: string
  size?: number
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!imageFile) {
      setObjectUrl(null)
      return
    }
    const url = URL.createObjectURL(imageFile)
    setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  const src = objectUrl || imageUrl

  if (!src) {
    return (
      <div
        style={{ width: size, height: size }}
        className="bg-gray-100 rounded flex items-center justify-center text-xs text-gray-400 shrink-0"
      >
        No image
      </div>
    )
  }

  return (
    // next/image can't load blob: URLs, so a plain <img> is required for uploaded-file previews
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} style={{ width: size, height: size }} className="object-cover rounded shrink-0" />
  )
}

function QueueRow({
  product,
  isGenerating,
  onView,
  onEdit,
  onDelete,
  onRetry
}: {
  product: DraftProduct
  isGenerating: boolean
  onView: (id: string) => void
  onEdit: (product: DraftProduct) => void
  onDelete: (id: string) => void
  onRetry: (id: string) => void
}) {
  const statusStyles: Record<DraftProduct['status'], string> = {
    draft: 'bg-gray-200 text-gray-700',
    generated: 'bg-blue-100 text-blue-700',
    approved: 'bg-green-100 text-green-700'
  }

  return (
    <tr className="border-b">
      <td className="p-2">
        <ProductThumbnail imageFile={product.imageFile} imageUrl={product.imageUrl} alt={product.brandName} size={80} />
        {product.imageMissingAfterRestore && (
          <p className="text-xs text-amber-600 mt-1">Image lost — re-upload</p>
        )}
      </td>
      <td className="p-2">
        <p className="font-medium text-sm">{product.brandName || '—'}</p>
        <p className="text-xs text-gray-500">{product.category || '—'}</p>
      </td>
      <td className="p-2 text-sm text-gray-600 max-w-xs">{truncate(product.description, 80)}</td>
      <td className="p-2">
        {isGenerating ? (
          <span className="text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-700 animate-pulse">
            Generating…
          </span>
        ) : (
          <span className={`text-xs px-2 py-1 rounded-full ${statusStyles[product.status]}`}>{product.status}</span>
        )}
        {product.generationError && <p className="text-xs text-red-600 mt-1">{product.generationError}</p>}
      </td>
      <td className="p-2 whitespace-nowrap space-x-2">
        {(product.generatedContent || product.generationError) && (
          <button onClick={() => onView(product.id)} className="text-sm text-blue-600 underline">
            {product.generatedContent ? 'View Generated Listing' : 'View Error'}
          </button>
        )}
        {product.generationError && (
          <button
            onClick={() => onRetry(product.id)}
            disabled={isGenerating}
            className="text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 px-2 py-1 rounded"
          >
            Retry
          </button>
        )}
        <button onClick={() => onEdit(product)} className="text-sm text-gray-600 underline">
          Edit
        </button>
        <button onClick={() => onDelete(product.id)} className="text-sm text-red-600 underline">
          Delete
        </button>
      </td>
    </tr>
  )
}

function GeneratedListingDrawer({
  product,
  onClose,
  onApprove,
  onUnapprove,
  onRetry
}: {
  product: DraftProduct
  onClose: () => void
  onApprove: (id: string) => void
  onUnapprove: (id: string) => void
  onRetry: (id: string) => void
}) {
  const displayFields = product.generatedContent
    ? getDisplayFields(product.targetMarketplace, product.generatedContent)
    : []

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full p-6 overflow-y-auto shadow-xl">
        <div className="mb-4">
          <h2 className="text-lg font-bold">
            {product.generatedContent ? 'View Generated Listing' : 'Generation Error'}
          </h2>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <ProductThumbnail imageFile={product.imageFile} imageUrl={product.imageUrl} alt={product.brandName} size={60} />
          <div>
            <p className="font-medium">{product.brandName}</p>
            <p className="text-sm text-gray-500">
              {product.category} · {product.targetMarketplace}
            </p>
            {product.imageMissingAfterRestore && (
              <p className="text-xs text-amber-600 mt-1">Image lost after session restore — re-upload via Edit</p>
            )}
          </div>
        </div>

        {product.generationError && (
          <div className="mb-4 p-3 rounded bg-red-50 border border-red-200">
            <p className="text-sm text-red-600">{product.generationError}</p>
          </div>
        )}

        <div className="space-y-2">
          {displayFields.map((field) => (
            <div key={field.label}>
              <p className="text-xs font-medium text-gray-500 uppercase">{field.label}</p>
              <p className="text-sm">{field.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-between items-center">
          <div className="flex gap-2">
            {product.status === 'generated' && (
              <button onClick={() => onApprove(product.id)} className="bg-green-600 text-white p-2 rounded text-sm">
                Approve
              </button>
            )}
            {product.status === 'approved' && (
              <button onClick={() => onUnapprove(product.id)} className="bg-yellow-600 text-white p-2 rounded text-sm">
                Unapprove
              </button>
            )}
            {product.generationError && (
              <button
                onClick={() => onRetry(product.id)}
                className="bg-red-600 text-white p-2 rounded text-sm font-medium"
              >
                Retry
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-md font-medium border border-gray-300 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CatalogueWorkspace() {
  const [targetMarketplace, setTargetMarketplace] = useState('')
  const [draftProducts, setDraftProducts] = useState<DraftProduct[]>([])
  const [activeTab, setActiveTab] = useState<'manual' | 'csv'>('manual')
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingRestoreCount, setPendingRestoreCount] = useState<number | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)

  const [brandName, setBrandName] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvSummary, setCsvSummary] = useState<CsvSummary | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const [generating, setGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState<{ current: number; total: number } | null>(null)
  const [currentlyGeneratingId, setCurrentlyGeneratingId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null)
  const marketplaceSelectRef = useRef<HTMLSelectElement>(null)
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null)
  const [marketplaceFlash, setMarketplaceFlash] = useState(false)
  const [brandMismatchPending, setBrandMismatchPending] = useState(false)
  const [pendingCsvUpload, setPendingCsvUpload] = useState<PendingCsvUpload | null>(null)
  const [hasSession, setHasSession] = useState(false)
  const [showExportGateModal, setShowExportGateModal] = useState(false)

  // Client-side only, purely for UI: /workspace is public, so this never gates
  // access — it just decides whether to show the Brand/Clients dropdown at all,
  // and (by not rendering ClientSelector) avoids ever hitting the clients table
  // for a guest, since ClientSelector fetches clients in its own effect on mount.
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setHasSession(!!data.user)
    })
  }, [])

  // On mount, check for a crash-recovery session without silently restoring it —
  // the user must explicitly choose Restore or Discard via the banner. Uses
  // localStorage (not sessionStorage) because a magic-link email typically opens
  // in a new browser tab, and sessionStorage doesn't carry across tabs — the
  // whole point of this recovery flow is to survive that guest-mode login round trip.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        const isExpired = typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > SESSION_MAX_AGE_MS

        if (isExpired) {
          localStorage.removeItem(SESSION_STORAGE_KEY)
        } else if (Array.isArray(parsed.draftProducts) && parsed.draftProducts.length > 0) {
          setPendingRestoreCount(parsed.draftProducts.length)
          return
        }
      }
    } catch {
      // corrupted or unreadable storage — treat as no saved session
    }
    setSessionReady(true)
  }, [])

  // Persist draftProducts on every change, once the initial restore/discard decision
  // is resolved (so we don't clobber a pending saved session with the initial empty array
  // before the user has seen the restore banner). File objects can't survive
  // JSON.stringify/localStorage, so imageFile is stripped — a `hadImageFile` marker is
  // kept instead so a restored session can tell the user their image was lost, rather than
  // silently looking like the product never had one. CSV-sourced imageUrl links, being
  // plain strings, survive a restore intact.
  useEffect(() => {
    if (!sessionReady) return
    const serializable = draftProducts.map((p) => {
      const { imageFile, ...rest } = p
      return { ...rest, hadImageFile: !!imageFile }
    })
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), draftProducts: serializable }))
  }, [draftProducts, sessionReady])

  function handleRestoreSession() {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        const products = Array.isArray(parsed.draftProducts) ? parsed.draftProducts : []
        setDraftProducts(
          products.map((p: any) => ({
            ...p,
            imageFile: null,
            imageMissingAfterRestore: !!p.hadImageFile && !p.imageUrl
          }))
        )
      }
    } catch {
      // corrupted storage — nothing to restore
    }
    setPendingRestoreCount(null)
    setSessionReady(true)
  }

  function handleDiscardSession() {
    localStorage.removeItem(SESSION_STORAGE_KEY)
    setPendingRestoreCount(null)
    setSessionReady(true)
  }

  function requireMarketplace(): boolean {
    if (!targetMarketplace) {
      alert('Please select a target marketplace first.')
      return false
    }
    return true
  }

  function flagMissingMarketplace() {
    setMarketplaceError('Please select a target marketplace before proceeding.')
    setMarketplaceFlash(true)
    marketplaceSelectRef.current?.focus()
    marketplaceSelectRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => setMarketplaceFlash(false), 1200)
  }

  function wordLevelMatch(a: string, b: string): boolean {
    const normA = a.trim().toLowerCase()
    const normB = b.trim().toLowerCase()

    if (!normA || !normB) return true
    if (normA === normB) return true

    const wordsA = new Set(normA.split(/\s+/).filter(Boolean))
    const wordsB = normB.split(/\s+/).filter(Boolean)

    return wordsB.some((word) => wordsA.has(word))
  }

  function handleClearForm() {
    setBrandName('')
    setCategory('')
    setDescription('')
    setImageFile(null)
    setEditingId(null)
    setFormError(null)
    setBrandMismatchPending(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function handleAddProduct() {
    if (!targetMarketplace) {
      flagMissingMarketplace()
      return
    }
    setMarketplaceError(null)

    if (!brandName.trim() || !category.trim() || !description.trim()) {
      setFormError('Brand Name, Category, and Description are required.')
      return
    }
    setFormError(null)

    if (!editingId && selectedClient && !wordLevelMatch(brandName, selectedClient.client_name)) {
      setBrandMismatchPending(true)
      return
    }

    commitAddProduct(false)
  }

  function commitAddProduct(skipBrandVoice: boolean) {
    if (editingId) {
      setDraftProducts((prev) =>
        prev.map((p) =>
          p.id === editingId
            ? {
                ...p,
                brandName,
                category,
                description,
                ...(imageFile ? { imageFile, imageUrl: null, imageMissingAfterRestore: false } : {})
              }
            : p
        )
      )
      setEditingId(null)
      setDescription('')
      setImageFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      setBrandMismatchPending(false)
      return
    }

    const newProduct: DraftProduct = {
      id: crypto.randomUUID(),
      brandName,
      description,
      category,
      imageFile,
      imageUrl: null,
      targetMarketplace,
      generatedContent: null,
      status: 'draft',
      generationError: null,
      imageMissingAfterRestore: false,
      skipBrandVoice
    }

    setDraftProducts((prev) => [...prev, newProduct])

    setDescription('')
    setImageFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    setBrandMismatchPending(false)
  }

  function handleEditProduct(product: DraftProduct) {
    setBrandName(product.brandName)
    setCategory(product.category)
    setDescription(product.description)
    setImageFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    setEditingId(product.id)
    setActiveTab('manual')
  }

  function handleDeleteProduct(id: string) {
    setDraftProducts((prev) => prev.filter((p) => p.id !== id))
    if (viewingId === id) setViewingId(null)
    if (editingId === id) handleClearForm()
  }

  async function handleUploadCsv() {
    if (!targetMarketplace) {
      flagMissingMarketplace()
      return
    }
    setMarketplaceError(null)

    if (!csvFile) {
      alert('Choose a CSV file first')
      return
    }

    const csvText = await csvFile.text()
    const parsed = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true
    })

    if (parsed.errors.length > 0) {
      alert('Error parsing CSV: ' + parsed.errors[0].message)
      return
    }

    const newProducts: DraftProduct[] = []
    let skippedCount = 0

    for (const row of parsed.data) {
      const brand = pick(row, 'Brand', 'brand')
      const rowDescription = pick(row, 'Product description', 'description')

      if (!brand || !rowDescription) {
        skippedCount++
        continue
      }

      newProducts.push({
        id: crypto.randomUUID(),
        brandName: brand,
        description: rowDescription,
        category: pick(row, 'category') || '',
        imageFile: null,
        imageUrl: pick(row, 'image url', 'image_url'),
        targetMarketplace,
        generatedContent: null,
        status: 'draft',
        generationError: null,
        imageMissingAfterRestore: false,
        skipBrandVoice: false
      })
    }

    if (selectedClient) {
      const mismatchedProducts = newProducts.filter((p) => !wordLevelMatch(p.brandName, selectedClient.client_name))

      if (mismatchedProducts.length > 0) {
        const matchingProducts = newProducts.filter((p) => wordLevelMatch(p.brandName, selectedClient.client_name))
        setPendingCsvUpload({
          fileName: csvFile.name,
          total: parsed.data.length,
          matchingProducts,
          mismatchedProducts
        })
        return
      }
    }

    commitCsvUpload(newProducts, csvFile.name, parsed.data.length)
  }

  function commitCsvUpload(products: DraftProduct[], fileName: string, total: number) {
    setDraftProducts((prev) => [...prev, ...products])
    setCsvSummary({
      fileName,
      total,
      added: products.length,
      skipped: total - products.length
    })
    setCsvFile(null)
    setPendingCsvUpload(null)
  }

  function handleCsvAddWithoutBrandVoice() {
    if (!pendingCsvUpload) return
    const all = [...pendingCsvUpload.matchingProducts, ...pendingCsvUpload.mismatchedProducts].map((p) => ({
      ...p,
      skipBrandVoice: true
    }))
    commitCsvUpload(all, pendingCsvUpload.fileName, pendingCsvUpload.total)
  }

  function handleCsvAddOnlyMatching() {
    if (!pendingCsvUpload) return
    commitCsvUpload(pendingCsvUpload.matchingProducts, pendingCsvUpload.fileName, pendingCsvUpload.total)
  }

  function handleCsvAddAllWithBrandVoice() {
    if (!pendingCsvUpload) return
    const all = [...pendingCsvUpload.matchingProducts, ...pendingCsvUpload.mismatchedProducts]
    commitCsvUpload(all, pendingCsvUpload.fileName, pendingCsvUpload.total)
  }

  function handleCsvCancelMismatch() {
    setPendingCsvUpload(null)
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave() {
    setIsDragging(false)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) {
      setCsvFile(file)
      setPendingCsvUpload(null)
      if (!targetMarketplace) {
        flagMissingMarketplace()
      }
    }
  }

  async function handleGenerateAll() {
    if (!requireMarketplace()) return
    const pending = draftProducts.filter((p) => p.status === 'draft')
    if (pending.length === 0) return

    setGenerating(true)

    for (let i = 0; i < pending.length; i++) {
      const product = pending[i]
      setGenerationProgress({ current: i + 1, total: pending.length })
      setCurrentlyGeneratingId(product.id)

      await generateForProduct(product)
    }

    setCurrentlyGeneratingId(null)
    setGenerationProgress(null)
    setGenerating(false)
  }

  async function handleRetryProduct(id: string) {
    const product = draftProducts.find((p) => p.id === id)
    if (!product) return

    setCurrentlyGeneratingId(id)
    await generateForProduct(product)
    setCurrentlyGeneratingId(null)
  }

  async function generateForProduct(product: DraftProduct) {
    try {
      const imageBase64 = product.imageFile ? await fileToBase64(product.imageFile) : null

      const res = await fetch('/api/generate-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName: product.brandName,
          description: product.description,
          category: product.category,
          targetMarketplace: product.targetMarketplace,
          imageBase64,
          imageUrl: product.imageFile ? null : product.imageUrl,
          brandGuidelines: product.skipBrandVoice ? null : selectedClient?.brand_guidelines || null
        })
      })
      const data = await res.json()

      if (res.ok) {
        setDraftProducts((prev) =>
          prev.map((p) =>
            p.id === product.id
              ? { ...p, generatedContent: data.generatedContent, status: 'generated', generationError: null }
              : p
          )
        )
      } else {
        setDraftProducts((prev) =>
          prev.map((p) => (p.id === product.id ? { ...p, generationError: data.error || 'Generation failed' } : p))
        )
      }
    } catch {
      setDraftProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, generationError: 'Network error — request failed' } : p))
      )
    }
  }

  function handleApprove(id: string) {
    setDraftProducts((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'approved' } : p)))
  }

  function handleUnapprove(id: string) {
    setDraftProducts((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'generated' } : p)))
  }

  function handleBulkApprove() {
    if (!requireMarketplace()) return
    setDraftProducts((prev) => prev.map((p) => (p.status === 'generated' ? { ...p, status: 'approved' } : p)))
  }

  function handleDownloadApproved() {
    if (!hasSession) {
      setShowExportGateModal(true)
      return
    }
    if (!requireMarketplace()) return
    const approved = draftProducts.filter((p) => p.status === 'approved')

    const flattenedRows = approved
      .map((p) => ({ id: p.id, marketplace: p.targetMarketplace, row: flattenRow(p.targetMarketplace, p.generatedContent) }))
      .filter((r): r is { id: string; marketplace: string; row: Record<string, string> } => r.row !== null)

    if (flattenedRows.length === 0) {
      alert('No approved products have a supported export shape for their marketplace.')
      return
    }

    try {
      const columns = Array.from(new Set(flattenedRows.flatMap((r) => exportColumns[r.marketplace])))
      const csv = Papa.unparse(
        flattenedRows.map((r) => r.row),
        { columns }
      )

      const blob = new Blob([csv], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'approved-products-export.csv'
      a.click()
      window.URL.revokeObjectURL(url)

      const includedIds = new Set(flattenedRows.map((r) => r.id))
      setDraftProducts((prev) => prev.filter((p) => !includedIds.has(p.id)))
      setDownloadMessage(`Downloaded and cleared ${flattenedRows.length} approved products`)
    } catch {
      alert('Download failed — approved products were not cleared. Please try again.')
    }
  }

  const hasApproved = draftProducts.some((p) => p.status === 'approved')
  const viewingProduct = draftProducts.find((p) => p.id === viewingId) || null
  const editingProduct = editingId ? draftProducts.find((p) => p.id === editingId) || null : null
  const formPreviewUrl = imageFile ? null : editingProduct?.imageUrl ?? null
  const guestLimitReached = !hasSession && draftProducts.length >= GUEST_PRODUCT_LIMIT

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Catalogue Workspace</h1>
          <LogoutButton />
        </div>

        {pendingRestoreCount !== null && (
          <div className="mb-4 p-3 border border-yellow-300 bg-yellow-50 rounded flex items-center justify-between gap-4">
            <p className="text-sm text-yellow-800">
              A previous session with {pendingRestoreCount} product{pendingRestoreCount === 1 ? '' : 's'} was found.
            </p>
            <div className="flex gap-2 shrink-0">
              <button onClick={handleRestoreSession} className="bg-black text-white px-3 py-1 rounded text-sm">
                Restore
              </button>
              <button onClick={handleDiscardSession} className="border px-3 py-1 rounded text-sm">
                Discard
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-4 mb-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-4">
              <select
                ref={marketplaceSelectRef}
                value={targetMarketplace}
                onChange={(e) => {
                  setTargetMarketplace(e.target.value)
                  setMarketplaceError(null)
                  setMarketplaceFlash(false)
                }}
                className={`border p-2 rounded ${
                  marketplaceError
                    ? `border-red-500 ring-2 ring-red-500 ${marketplaceFlash ? 'animate-pulse' : ''}`
                    : ''
                }`}
              >
                <option value="" disabled>
                  Select a marketplace
                </option>
                {marketplaces.map((marketplace) => (
                  <option key={marketplace} value={marketplace}>
                    {marketplace}
                  </option>
                ))}
              </select>
              <span className="text-sm font-medium">
                {hasSession
                  ? `Products in Session (${draftProducts.length})`
                  : `${draftProducts.length}/${GUEST_PRODUCT_LIMIT} (free preview)`}
              </span>
            </div>
            {marketplaceError && <p className="text-sm font-medium text-red-500">{marketplaceError}</p>}
          </div>
          {hasSession && (
            <ClientSelector selectedClientId={selectedClient?.id || ''} onSelectClient={setSelectedClient} />
          )}
        </div>

        <div className="flex gap-4 border-b mb-6">
          <button
            onClick={() => setActiveTab('manual')}
            className={`p-2 text-sm font-medium border-b-2 ${
              activeTab === 'manual' ? 'border-black text-black' : 'border-transparent text-gray-500'
            }`}
          >
            Manual Entry
          </button>
          <button
            onClick={() => setActiveTab('csv')}
            className={`p-2 text-sm font-medium border-b-2 ${
              activeTab === 'csv' ? 'border-black text-black' : 'border-transparent text-gray-500'
            }`}
          >
            Bulk CSV Upload
          </button>
        </div>

        <div className="flex gap-6">
          <div className="w-[35%] flex flex-col gap-2 p-4 border rounded bg-white h-fit">
            {activeTab === 'manual' ? (
              <>
                <input
                  type="text"
                  placeholder="Brand name"
                  value={brandName}
                  onChange={(e) => {
                    setBrandName(e.target.value)
                    setFormError(null)
                    setBrandMismatchPending(false)
                  }}
                  className="border p-2 rounded"
                />
                <input
                  type="text"
                  placeholder="Category"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value)
                    setFormError(null)
                  }}
                  className="border p-2 rounded"
                />
                <textarea
                  placeholder="Description"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value)
                    setFormError(null)
                  }}
                  className="border p-2 rounded"
                />
                <div className="flex items-center gap-2 min-w-0">
                  <label className="flex-1 min-w-0 truncate border p-2 rounded text-center cursor-pointer text-sm text-gray-500">
                    Upload Product Image
                    <input
                      type="file"
                      accept="image/*"
                      ref={fileInputRef}
                      onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                      className="hidden"
                    />
                  </label>
                  <ProductThumbnail imageFile={imageFile} imageUrl={formPreviewUrl} alt="Preview" size={48} />
                </div>
                {formError && <p className="text-sm text-red-600">{formError}</p>}
                {guestLimitReached && (
                  <p className="text-sm text-red-600">Free preview limit reached (10/10) — sign in to continue.</p>
                )}
                {brandMismatchPending && selectedClient ? (
                  <div className="p-3 border border-amber-300 bg-amber-50 rounded flex flex-col gap-2">
                    <p className="text-sm text-amber-800">
                      This product's brand doesn't match your selected brand voice ({selectedClient.client_name}).
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => commitAddProduct(true)}
                        className="text-sm bg-white border border-amber-400 text-amber-800 px-3 py-1 rounded"
                      >
                        Add without brand voice
                      </button>
                      <button
                        onClick={() => commitAddProduct(false)}
                        className="text-sm bg-amber-600 text-white px-3 py-1 rounded"
                      >
                        Add anyway with {selectedClient.client_name} voice
                      </button>
                      <button
                        onClick={() => setBrandMismatchPending(false)}
                        className="text-sm text-gray-600 underline"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddProduct}
                      disabled={guestLimitReached}
                      className="flex-1 bg-black text-white p-2 rounded disabled:opacity-50"
                    >
                      {editingId ? 'Save Changes' : 'Add Product'}
                    </button>
                    <button onClick={handleClearForm} className="border p-2 rounded text-sm">
                      Clear Form
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <a href="/sample-products.csv" download className="text-blue-600 underline text-sm">
                  Download Sample CSV
                </a>

                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded p-8 text-center ${
                    isDragging ? 'border-black bg-gray-50' : 'border-gray-300'
                  }`}
                >
                  {csvFile ? (
                    <span className="inline-block text-sm bg-green-50 text-green-700 border border-green-200 px-3 py-1 rounded-md mb-2">
                      Selected: {csvFile.name}
                    </span>
                  ) : (
                    <p className="text-sm text-gray-500 mb-2">Drag and drop a CSV file here</p>
                  )}
                  <label className="inline-block border p-2 rounded cursor-pointer text-sm text-gray-500">
                    Choose file
                    <input
                      type="file"
                      accept=".csv"
                      onChange={(e) => {
                        setCsvFile(e.target.files?.[0] ?? null)
                        setPendingCsvUpload(null)
                      }}
                      className="hidden"
                    />
                  </label>
                </div>

                {guestLimitReached && (
                  <p className="text-sm text-red-600">Free preview limit reached (10/10) — sign in to continue.</p>
                )}
                {pendingCsvUpload && selectedClient ? (
                  <div className="p-3 border border-amber-300 bg-amber-50 rounded flex flex-col gap-2">
                    <p className="text-sm text-amber-800">
                      {pendingCsvUpload.mismatchedProducts.length} of{' '}
                      {pendingCsvUpload.matchingProducts.length + pendingCsvUpload.mismatchedProducts.length} rows
                      don't match your selected brand voice ({selectedClient.client_name}).
                    </p>
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={handleCsvAddWithoutBrandVoice}
                        className="text-sm bg-white border border-amber-400 text-amber-800 px-3 py-1 rounded"
                      >
                        Add all without brand voice
                      </button>
                      <button
                        onClick={handleCsvAddOnlyMatching}
                        className="text-sm bg-white border border-amber-400 text-amber-800 px-3 py-1 rounded"
                      >
                        Add only matching rows with brand voice, skip mismatches
                      </button>
                      <button
                        onClick={handleCsvAddAllWithBrandVoice}
                        className="text-sm bg-amber-600 text-white px-3 py-1 rounded"
                      >
                        Add all anyway with {selectedClient.client_name} voice
                      </button>
                      <button onClick={handleCsvCancelMismatch} className="text-sm text-gray-600 underline">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleUploadCsv}
                    disabled={guestLimitReached}
                    className="bg-black text-white p-2 rounded disabled:opacity-50"
                  >
                    Upload CSV
                  </button>
                )}

                {csvSummary && (
                  <div className="overflow-x-auto border rounded bg-white">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50 text-left text-xs text-gray-500">
                          <th className="p-2">File</th>
                          <th className="p-2">Total</th>
                          <th className="p-2">Added</th>
                          <th className="p-2">Skipped</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="p-2">{csvSummary.fileName}</td>
                          <td className="p-2">{csvSummary.total}</td>
                          <td className="p-2">{csvSummary.added}</td>
                          <td className="p-2">{csvSummary.skipped}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="w-[65%] min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleGenerateAll}
                  disabled={!targetMarketplace || !draftProducts.some((p) => p.status === 'draft') || generating}
                  className="bg-black text-white p-2 rounded disabled:opacity-50 text-sm"
                >
                  {generating ? 'Generating...' : 'Generate Content for All'}
                </button>
                {generationProgress && (
                  <span className="text-sm text-gray-500">
                    Generating {generationProgress.current} of {generationProgress.total}...
                  </span>
                )}
                <button
                  onClick={handleBulkApprove}
                  disabled={!targetMarketplace || !draftProducts.some((p) => p.status === 'generated')}
                  className="bg-green-600 text-white p-2 rounded disabled:opacity-50 text-sm"
                >
                  Bulk Approve All Generated
                </button>
              </div>
              <button
                onClick={handleDownloadApproved}
                disabled={!targetMarketplace || !hasApproved}
                className="bg-black text-white p-2 rounded disabled:opacity-50 text-sm"
              >
                Download Approved CSV
              </button>
            </div>
            <div className="overflow-x-auto border rounded bg-white">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs text-gray-500">
                    <th className="p-2">Thumbnail</th>
                    <th className="p-2">Brand / Category</th>
                    <th className="p-2">Raw Input</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {draftProducts.map((product) => (
                    <QueueRow
                      key={product.id}
                      product={product}
                      isGenerating={product.id === currentlyGeneratingId}
                      onView={setViewingId}
                      onEdit={handleEditProduct}
                      onDelete={handleDeleteProduct}
                      onRetry={handleRetryProduct}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {downloadMessage && <p className="mt-2 text-sm text-green-700">{downloadMessage}</p>}
      </div>

      {viewingProduct && (
        <GeneratedListingDrawer
          product={viewingProduct}
          onClose={() => setViewingId(null)}
          onApprove={handleApprove}
          onUnapprove={handleUnapprove}
          onRetry={handleRetryProduct}
        />
      )}

      {showExportGateModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowExportGateModal(false)} />
          <div className="relative bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <p className="text-gray-800 mb-4">Sign in or create a free account to download your listings.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowExportGateModal(false)} className="text-sm text-gray-600 underline">
                Cancel
              </button>
              <Link href="/login" className="bg-black text-white px-4 py-2 rounded text-sm">
                Sign In
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
