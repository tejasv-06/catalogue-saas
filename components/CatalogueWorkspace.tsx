"use client"

import { useEffect, useRef, useState, type DragEvent } from 'react'
import Papa from 'papaparse'
import { pick } from '@/lib/csvMapping'
import { exportColumns, flattenRow } from '@/lib/exportShapers'
import { type Client } from '@/components/ClientSelector'
import StatusBadge from '@/components/StatusBadge'
import ProductThumbnail from '@/components/ProductThumbnail'
import AppHeader from '@/components/AppHeader'
import TopHeader from '@/components/TopHeader'
import LeftPanel from '@/components/workspace/LeftPanel'
import ImageOnlyPanel from '@/components/workspace/ImageOnlyPanel'
import AppSidebar, { type WorkspaceDestination } from '@/components/AppSidebar'
import QueueTable from '@/components/workspace/QueueTable'
import { createClient } from '@/lib/supabase/client'
import CreditsBalance, { notifyCreditsChanged } from '@/components/CreditsBalance'
import { CREDIT_COSTS } from '@/lib/creditCosts'
import { useFocusTrap } from '@/lib/useFocusTrap'
import type { DraftProduct, CsvSummary, PendingCsvUpload } from '@/lib/types'
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonDestructiveClass,
  buttonWarningClass,
  linkButtonClass,
  sectionHeadingClass,
  labelClass,
  cardClass,
  warningBannerClass,
  warningTextClass,
  dangerBannerClass,
  dangerTextClass
} from '@/lib/uiClasses'
import Link from 'next/link'

const SESSION_STORAGE_KEY = 'catalogue-draft-session'
const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000

// Above this, a picked-but-not-yet-submitted form image is simply not persisted
// (falls back to today's behavior: lost on refresh) rather than risking a
// localStorage quota error on write, which could otherwise silently break
// persistence for the whole session, not just the image.
const MAX_PERSISTABLE_IMAGE_BYTES = 2 * 1024 * 1024

const GUEST_PRODUCT_LIMIT = 10

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

  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, onClose)

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={product.generatedContent ? 'View Generated Listing' : 'Generation Error'}
        className="relative w-full max-w-md border-l h-full p-6 overflow-y-auto shadow-xl focus:outline-none bg-[var(--card-bg)] border-[var(--card-border)]"
      >
        <div className="mb-4 flex items-center gap-2">
          <h2 className={sectionHeadingClass}>
            {product.generatedContent ? 'View Generated Listing' : 'Generation Error'}
          </h2>
          <StatusBadge status={product.status} />
        </div>

        <div className="flex items-center gap-3 mb-4">
          <ProductThumbnail imageFile={product.imageFile} imageUrl={product.imageUrl} alt={product.brandName} size={60} />
          <div>
            <p className="font-medium text-[var(--heading-text)]">{product.brandName}</p>
            <p className="text-sm text-[var(--muted-text)]">
              {product.category} · {product.targetMarketplace}
            </p>
          </div>
        </div>

        {product.generationError && (
          <div className={`mb-4 ${dangerBannerClass}`}>
            <p className={dangerTextClass}>{product.generationError}</p>
          </div>
        )}

        <div className="space-y-2">
          {displayFields.map((field) => (
            <div key={field.label}>
              <p className={labelClass}>{field.label}</p>
              <p className="text-sm text-[var(--body-text)]">{field.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-between items-center">
          <div className="flex gap-2">
            {product.status === 'generated' && (
              <button onClick={() => onApprove(product.id)} className={buttonSecondaryClass}>
                Approve
              </button>
            )}
            {product.status === 'approved' && (
              <button onClick={() => onUnapprove(product.id)} className={buttonWarningClass}>
                Unapprove
              </button>
            )}
            {product.generationError && (
              <button onClick={() => onRetry(product.id)} className={buttonDestructiveClass}>
                Retry
              </button>
            )}
          </div>
          <button onClick={onClose} className={buttonSecondaryClass}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function ExportGateModal({ onClose, onSignIn }: { onClose: () => void; onSignIn: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, onClose)

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Sign in required"
        className={`relative p-6 max-w-sm w-full mx-4 focus:outline-none ${cardClass}`}
      >
        <p className="text-sm text-[var(--body-text)] mb-4">Sign in or create a free account to download your listings.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={linkButtonClass}>
            Cancel
          </button>
          <Link href="/login" onClick={onSignIn} className={buttonPrimaryClass}>
            Sign In
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function CatalogueWorkspace() {
  const [targetMarketplace, setTargetMarketplace] = useState('')
  const [draftProducts, setDraftProducts] = useState<DraftProduct[]>([])
  const [activeTab, setActiveTab] = useState<WorkspaceDestination>('manual')
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingRestoreCount, setPendingRestoreCount] = useState<number | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  // Saved session read from localStorage on mount, held here until we also know
  // whether the visitor is authenticated — that decides auto-restore vs. banner.
  const [savedSessionData, setSavedSessionData] = useState<any | null>(null)

  const [brandName, setBrandName] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  // Base64 mirror of imageFile (when small enough), so the form's in-progress,
  // not-yet-submitted image pick can survive a redirect/refresh via localStorage —
  // a raw File object can't be JSON-serialized.
  const [imageFileDataUrl, setImageFileDataUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvSummary, setCsvSummary] = useState<CsvSummary | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const [generating, setGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState<{ current: number; total: number } | null>(null)
  const [currentlyGeneratingId, setCurrentlyGeneratingId] = useState<string | null>(null)
  const [bulkStoppedMessage, setBulkStoppedMessage] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null)
  const marketplaceSelectRef = useRef<HTMLSelectElement>(null)
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null)
  const [marketplaceFlash, setMarketplaceFlash] = useState(false)
  const [brandMismatchPending, setBrandMismatchPending] = useState(false)
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [pendingCsvUpload, setPendingCsvUpload] = useState<PendingCsvUpload | null>(null)
  const [hasSession, setHasSession] = useState(false)
  // Distinguishes "haven't checked auth yet" from "checked, guest" — hasSession
  // alone starts false either way, which isn't enough to gate the restore decision.
  const [hasCheckedSession, setHasCheckedSession] = useState(false)
  const [showExportGateModal, setShowExportGateModal] = useState(false)
  const [autoDownloadPending, setAutoDownloadPending] = useState(false)

  // Client-side only, purely for UI: /workspace is public, so this never gates
  // access — it just decides whether to show the Brand/Clients dropdown at all,
  // and (by not rendering ClientSelector) avoids ever hitting the clients table
  // for a guest, since ClientSelector fetches clients in its own effect on mount.
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setHasSession(!!data.user)
      setHasCheckedSession(true)
    })
  }, [])

  // AppSidebar's csv/manual/image items link here as /workspace?tab=<id>
  // when clicked from outside /workspace (e.g. from /audit) — this is what
  // makes that navigation land on the actual destination clicked, rather
  // than always landing on the default Manual Entry panel. Read directly
  // from window.location instead of useSearchParams() so this component
  // doesn't need a Suspense boundary added upstream just for this.
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab')
    if (tab === 'csv' || tab === 'manual' || tab === 'image') {
      setActiveTab(tab)
    }
  }, [])

  // On mount, read any crash-recovery session but don't yet decide what to do
  // with it — that depends on whether this visitor turns out to be authenticated,
  // which is still resolving asynchronously via the auth-check effect above.
  // Uses localStorage (not sessionStorage) because a magic-link email typically
  // opens in a new browser tab, and sessionStorage doesn't carry across tabs.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        const isExpired = typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > SESSION_MAX_AGE_MS

        if (isExpired) {
          localStorage.removeItem(SESSION_STORAGE_KEY)
        } else if (parsed.pendingDownload || (Array.isArray(parsed.draftProducts) && parsed.draftProducts.length > 0)) {
          setSavedSessionData(parsed)
          return
        }
      }
    } catch {
      // corrupted or unreadable storage — treat as no saved session
    }
    setSessionReady(true)
  }, [])

  // Fires once both the saved session (if any) and the auth check have landed.
  // Authenticated visitors skip the manual banner entirely and get restored
  // straight into state; guests keep seeing the Restore/Discard banner as before.
  useEffect(() => {
    if (!savedSessionData || !hasCheckedSession) return

    if (hasSession) {
      void applyRestoredState(savedSessionData)
      if (savedSessionData.pendingDownload) {
        setAutoDownloadPending(true)
      }
      setSessionReady(true)
    } else {
      setPendingRestoreCount(savedSessionData.draftProducts?.length || 0)
    }
    setSavedSessionData(null)
  }, [savedSessionData, hasCheckedSession, hasSession])

  // Fires once both the restore and the "am I actually logged in now" check
  // have landed. handleDownloadApproved's own hasSession check would otherwise
  // still see the stale initial `false` if called directly above, since that
  // auth check resolves asynchronously.
  useEffect(() => {
    if (autoDownloadPending && hasSession) {
      setAutoDownloadPending(false)
      handleDownloadApproved()
    }
  }, [autoDownloadPending, hasSession])

  // Mirrors the form's in-progress imageFile into a base64 data URL so it can
  // survive a redirect/refresh via localStorage (a raw File can't be
  // JSON-serialized). Skipped above the size cap — see MAX_PERSISTABLE_IMAGE_BYTES.
  useEffect(() => {
    if (!imageFile || imageFile.size > MAX_PERSISTABLE_IMAGE_BYTES) {
      setImageFileDataUrl(null)
      return
    }
    let cancelled = false
    const reader = new FileReader()
    reader.onload = () => {
      if (!cancelled) setImageFileDataUrl(reader.result as string)
    }
    reader.readAsDataURL(imageFile)
    return () => {
      cancelled = true
    }
  }, [imageFile])

  // Persist draftProducts on every change, once the initial restore/discard decision
  // is resolved (so we don't clobber a pending saved session with the initial empty array
  // before the user has seen the restore banner). File objects can't survive
  // JSON.stringify/localStorage — imageFile is always null on a committed product now
  // (manual uploads are converted to a permanent Supabase Storage URL immediately on
  // add), but it's still stripped defensively in case that invariant is ever broken.
  // The marketplace, selected brand, and in-progress manual-entry form (including a
  // small enough in-progress image, as a data URL) are all saved alongside the
  // products so a restore brings back the whole session state, not just the product
  // list. Wrapped in try/catch: an oversized data URL could push this over
  // localStorage's quota, and a thrown QuotaExceededError here shouldn't take out
  // persistence for the rest of the session (products, marketplace, etc).
  useEffect(() => {
    if (!sessionReady) return
    try {
      const serializable = draftProducts.map(({ imageFile, ...rest }) => rest)
      localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          savedAt: Date.now(),
          draftProducts: serializable,
          targetMarketplace,
          selectedClient,
          formDraft: { brandName, category, description, imageDataUrl: imageFileDataUrl }
        })
      )
    } catch {
      // most likely a localStorage quota error from an embedded image — this
      // change just won't survive a refresh, nothing else breaks
    }
  }, [draftProducts, sessionReady, targetMarketplace, selectedClient, brandName, category, description, imageFileDataUrl])

  async function applyRestoredState(parsed: any) {
    const products = Array.isArray(parsed.draftProducts) ? parsed.draftProducts : []
    setDraftProducts(products.map((p: any) => ({ ...p, imageFile: null })))
    if (typeof parsed.targetMarketplace === 'string') {
      setTargetMarketplace(parsed.targetMarketplace)
    }
    if (parsed.selectedClient) {
      setSelectedClient(parsed.selectedClient)
    }
    if (parsed.formDraft) {
      setBrandName(parsed.formDraft.brandName || '')
      setCategory(parsed.formDraft.category || '')
      setDescription(parsed.formDraft.description || '')

      if (parsed.formDraft.imageDataUrl) {
        try {
          const blob = await (await fetch(parsed.formDraft.imageDataUrl)).blob()
          const extension = blob.type.split('/')[1] || 'jpg'
          setImageFile(new File([blob], `restored-image.${extension}`, { type: blob.type }))
        } catch {
          // couldn't reconstruct the image — form just comes back without one
        }
      }
    }
  }

  function handleRestoreSession() {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY)
      if (saved) {
        void applyRestoredState(JSON.parse(saved))
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

  function handleMarketplaceChange(value: string) {
    setTargetMarketplace(value)
    setMarketplaceError(null)
    setMarketplaceFlash(false)
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

  function handleBrandNameChange(value: string) {
    setBrandName(value)
    setFormError(null)
    setBrandMismatchPending(false)
  }

  function handleCategoryChange(value: string) {
    setCategory(value)
    setFormError(null)
  }

  function handleDescriptionChange(value: string) {
    setDescription(value)
    setFormError(null)
  }

  function handleCancelBrandMismatch() {
    setBrandMismatchPending(false)
    setPendingImageUrl(null)
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

  async function uploadProductImage(file: File): Promise<string> {
    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch('/api/upload-image', { method: 'POST', body: formData })
    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error || 'Image upload failed')
    }

    return data.url as string
  }

  async function handleAddProduct() {
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

    let uploadedImageUrl: string | null = null
    if (imageFile) {
      setUploadingImage(true)
      try {
        uploadedImageUrl = await uploadProductImage(imageFile)
      } catch (err: any) {
        setFormError(err.message || 'Image upload failed. Please try again.')
        setUploadingImage(false)
        return
      }
      setUploadingImage(false)
    }

    if (!editingId && selectedClient && !wordLevelMatch(brandName, selectedClient.client_name)) {
      setPendingImageUrl(uploadedImageUrl)
      setBrandMismatchPending(true)
      return
    }

    commitAddProduct(false, uploadedImageUrl)
  }

  // Image-only adds: brand/category are optional here (unlike manual entry),
  // and there's no brand-voice-mismatch gate — that check exists to catch a
  // typed brand name that doesn't match the selected client, and there's
  // nothing to mismatch-check when the field was deliberately left blank.
  async function handleAddImageOnlyProduct() {
    if (!targetMarketplace) {
      flagMissingMarketplace()
      return
    }
    setMarketplaceError(null)

    if (!imageFile && !editingId) {
      setFormError('An image is required.')
      return
    }
    setFormError(null)

    let uploadedImageUrl: string | null = null
    if (imageFile) {
      setUploadingImage(true)
      try {
        uploadedImageUrl = await uploadProductImage(imageFile)
      } catch (err: any) {
        setFormError(err.message || 'Image upload failed. Please try again.')
        setUploadingImage(false)
        return
      }
      setUploadingImage(false)
    }

    // Explicit '' override rather than falling through to the shared
    // `description` state — brandName/category/imageFile are reused across
    // all three destinations, but if a user typed a description while on
    // Manual Entry and then switched to this panel without clearing the
    // form, that leftover text must not silently end up on an "image only"
    // product.
    commitAddProduct(true, uploadedImageUrl, '')
  }

  function commitAddProduct(skipBrandVoice: boolean, uploadedImageUrl: string | null, descriptionOverride?: string) {
    const effectiveDescription = descriptionOverride ?? description

    if (editingId) {
      setDraftProducts((prev) =>
        prev.map((p) =>
          p.id === editingId
            ? {
                ...p,
                brandName,
                category,
                description: effectiveDescription,
                ...(uploadedImageUrl ? { imageFile: null, imageUrl: uploadedImageUrl } : {})
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
      setPendingImageUrl(null)
      return
    }

    const newProduct: DraftProduct = {
      id: crypto.randomUUID(),
      brandName,
      description: effectiveDescription,
      category,
      imageFile: null,
      imageUrl: uploadedImageUrl,
      targetMarketplace,
      generatedContent: null,
      status: 'draft',
      generationError: null,
      skipBrandVoice
    }

    setDraftProducts((prev) => [...prev, newProduct])

    setDescription('')
    setImageFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    setBrandMismatchPending(false)
    setPendingImageUrl(null)
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

  function handleCsvFileChange(file: File | null) {
    setCsvFile(file)
    setPendingCsvUpload(null)
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
    setBulkStoppedMessage(null)

    for (let i = 0; i < pending.length; i++) {
      const product = pending[i]
      setGenerationProgress({ current: i + 1, total: pending.length })
      setCurrentlyGeneratingId(product.id)

      const outcome = await generateForProduct(product)

      // Insufficient credits: every remaining pending item would fail the
      // identical way (the balance doesn't change between attempts), so stop
      // the batch here rather than burning a failed request per remaining
      // item. Any other per-item error (bad image, transient network issue)
      // keeps going — that failure is specific to one item, not the batch.
      if (outcome === 'insufficient_credits') {
        const remaining = pending.length - (i + 1)
        setBulkStoppedMessage(
          `Stopped after ${i + 1} of ${pending.length} — out of credits. ${remaining} item${remaining === 1 ? '' : 's'} still in the queue; retry once you have more credits.`
        )
        break
      }
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

  async function generateForProduct(product: DraftProduct): Promise<'success' | 'insufficient_credits' | 'error'> {
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
        if (hasSession) notifyCreditsChanged()
        return 'success'
      }

      setDraftProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, generationError: data.error || 'Generation failed' } : p))
      )
      return res.status === 403 && typeof data.creditsRemaining === 'number' ? 'insufficient_credits' : 'error'
    } catch {
      setDraftProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, generationError: 'Network error - request failed' } : p))
      )
      return 'error'
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

  function handleSignInFromExportGate() {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY)
      const parsed = saved ? JSON.parse(saved) : {}
      localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({ ...parsed, savedAt: Date.now(), pendingDownload: true })
      )
    } catch {
      // worst case the auto-download just doesn't fire after login — not fatal,
      // the session itself is still safe via the regular persist effect
    }
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
      alert('Download failed - approved products were not cleared. Please try again.')
    }
  }

  const hasApproved = draftProducts.some((p) => p.status === 'approved')
  const pendingCount = draftProducts.filter((p) => p.status === 'draft').length
  const viewingProduct = draftProducts.find((p) => p.id === viewingId) || null
  const editingProduct = editingId ? draftProducts.find((p) => p.id === editingId) || null : null
  const formPreviewUrl = imageFile ? null : editingProduct?.imageUrl ?? null
  const guestLimitReached = !hasSession && draftProducts.length >= GUEST_PRODUCT_LIMIT

  // What TopHeader shows in its usage slot — guests never accrue credits
  // (they're on the separate free-preview counter), signed-in users get the
  // real balance. Computed here rather than inside TopHeader so it stays a
  // plain shared shell with no guest-vs-signed-in branching of its own.
  const usageSlot = hasSession ? (
    <CreditsBalance />
  ) : (
    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border bg-[var(--secondary-btn-bg)] border-[var(--secondary-btn-border)] text-[var(--secondary-btn-text)] whitespace-nowrap">
      {`${draftProducts.length}/${GUEST_PRODUCT_LIMIT} Free Preview`}
    </span>
  )

  return (
    <div className="min-h-screen bg-[var(--page-bg)] text-[var(--body-text)]">
      <TopHeader usageSlot={usageSlot} />

      {/* pt-16 clears the fixed header for everything below, including
          AppSidebar's mobile in-flow bar — its desktop rail is unaffected
          either way since position:fixed ignores parent padding entirely. */}
      <div className="pt-16">
        <AppSidebar activeDestination={activeTab} onDestinationChange={setActiveTab} />

        <div className="lg:pl-14">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <AppHeader
            hasSession={hasSession}
            targetMarketplace={targetMarketplace}
            onMarketplaceChange={handleMarketplaceChange}
            marketplaceError={marketplaceError}
            marketplaceFlash={marketplaceFlash}
            marketplaceSelectRef={marketplaceSelectRef}
            selectedClientId={selectedClient?.id || ''}
            onSelectClient={setSelectedClient}
          />

          {pendingRestoreCount !== null && (
            <div className={`mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${warningBannerClass}`}>
              <p className={warningTextClass}>
                A previous session with {pendingRestoreCount} product{pendingRestoreCount === 1 ? '' : 's'} was found.
              </p>
              <div className="flex gap-2 shrink-0">
                <button onClick={handleRestoreSession} className={buttonSecondaryClass}>
                  Restore
                </button>
                <button onClick={handleDiscardSession} className={buttonSecondaryClass}>
                  Discard
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {activeTab === 'image' ? (
              <ImageOnlyPanel
                brandName={brandName}
                onBrandNameChange={handleBrandNameChange}
                category={category}
                onCategoryChange={handleCategoryChange}
                imageFile={imageFile}
                onImageFileChange={setImageFile}
                formPreviewUrl={formPreviewUrl}
                fileInputRef={fileInputRef}
                formError={formError}
                guestLimitReached={guestLimitReached}
                onSubmit={handleAddImageOnlyProduct}
                uploadingImage={uploadingImage}
                editingId={editingId}
              />
            ) : (
              <LeftPanel
                activeTab={activeTab}
                brandName={brandName}
                onBrandNameChange={handleBrandNameChange}
                category={category}
                onCategoryChange={handleCategoryChange}
                description={description}
                onDescriptionChange={handleDescriptionChange}
                imageFile={imageFile}
                onImageFileChange={setImageFile}
                formPreviewUrl={formPreviewUrl}
                fileInputRef={fileInputRef}
                formError={formError}
                guestLimitReached={guestLimitReached}
                brandMismatchPending={brandMismatchPending}
                selectedClient={selectedClient}
                pendingImageUrl={pendingImageUrl}
                onCommitAddProduct={commitAddProduct}
                onCancelBrandMismatch={handleCancelBrandMismatch}
                onAddProduct={handleAddProduct}
                onClearForm={handleClearForm}
                uploadingImage={uploadingImage}
                editingId={editingId}
                csvFile={csvFile}
                onCsvFileChange={handleCsvFileChange}
                csvSummary={csvSummary}
                isDragging={isDragging}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                pendingCsvUpload={pendingCsvUpload}
                onUploadCsv={handleUploadCsv}
                onCsvAddWithoutBrandVoice={handleCsvAddWithoutBrandVoice}
                onCsvAddOnlyMatching={handleCsvAddOnlyMatching}
                onCsvAddAllWithBrandVoice={handleCsvAddAllWithBrandVoice}
                onCsvCancelMismatch={handleCsvCancelMismatch}
              />
            )}

            <QueueTable
              draftProducts={draftProducts}
              currentlyGeneratingId={currentlyGeneratingId}
              targetMarketplace={targetMarketplace}
              generating={generating}
              hasApproved={hasApproved}
              loading={!sessionReady}
              hasSession={hasSession}
              pendingCount={pendingCount}
              bulkStoppedMessage={bulkStoppedMessage}
              onGenerateAll={handleGenerateAll}
              onBulkApprove={handleBulkApprove}
              onDownloadApproved={handleDownloadApproved}
              onView={setViewingId}
              onEdit={handleEditProduct}
              onDelete={handleDeleteProduct}
              onRetry={handleRetryProduct}
            />
          </div>

          {downloadMessage && <p className="mt-2 text-sm text-[var(--success-text)]">{downloadMessage}</p>}
        </div>
        </div>
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
        <ExportGateModal
          onClose={() => setShowExportGateModal(false)}
          onSignIn={() => {
            handleSignInFromExportGate()
            setShowExportGateModal(false)
          }}
        />
      )}
    </div>
  )
}
