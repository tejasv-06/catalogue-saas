"use client"

import { useRef, useState } from 'react'
import { updateBrand, type MarketplacePreferences } from '@/lib/brands'
import { createClient } from '@/lib/supabase/client'
import { useFocusTrap } from '@/lib/useFocusTrap'
import { SUPPORTED_MARKETPLACES, MARKETPLACE_LABELS } from '@/lib/platformShapers'
import type { Client } from '@/components/ClientSelector'
import {
  cardClass,
  sectionHeadingClass,
  labelClass,
  bodyTextClass,
  inputClass,
  buttonPrimaryClass,
  linkButtonClass,
  dangerBannerClass,
  dangerTextClass
} from '@/lib/uiClasses'

// Milestone C12 — the brand profile editor. Reuses the exact modal shell
// convention already established by ExportGateModal/ExportSummaryModal/
// ExportHistoryModal (fixed inset-0 z-40 overlay + backdrop + useFocusTrap
// + cardClass panel) — no new visual language introduced. Triggered from
// AppHeader next to the existing ClientSelector, never a new route.
//
// Deliberately takes the already-fetched `brand` (Client) as its initial
// state rather than doing its own fetch-on-open: ClientSelector's
// fetchClients() already does select('*'), so every field this form needs
// is already sitting in the parent's selectedClient state by the time this
// button is even clickable (it's only rendered when a brand is selected).
// The only genuine async operation here is the save itself — that's what
// the loading state below is for, honestly, not a fabricated fetch delay.
export default function BrandProfileModal({
  brand,
  onClose,
  onSaved
}: {
  brand: Client
  onClose: () => void
  onSaved: (updated: Client) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, onClose)

  const [brandIdentity, setBrandIdentity] = useState(brand.brand_identity ?? '')
  const [brandVoice, setBrandVoice] = useState(brand.brand_voice ?? '')
  const [targetAudience, setTargetAudience] = useState(brand.target_audience ?? '')
  const [productCategories, setProductCategories] = useState((brand.product_categories ?? []).join(', '))
  const [positioning, setPositioning] = useState(brand.positioning ?? '')
  const [brandGuidelines, setBrandGuidelines] = useState(brand.brand_guidelines ?? '')
  const [marketplacePreferences, setMarketplacePreferences] = useState<MarketplacePreferences>(
    brand.marketplace_preferences ?? {}
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function togglePreferenceEnabled(marketplace: (typeof SUPPORTED_MARKETPLACES)[number]) {
    setSaved(false)
    setMarketplacePreferences((prev) => ({
      ...prev,
      [marketplace]: { enabled: !prev[marketplace]?.enabled, notes: prev[marketplace]?.notes ?? '' }
    }))
  }

  function updatePreferenceNotes(marketplace: (typeof SUPPORTED_MARKETPLACES)[number], notes: string) {
    setSaved(false)
    setMarketplacePreferences((prev) => ({
      ...prev,
      [marketplace]: { enabled: prev[marketplace]?.enabled ?? false, notes }
    }))
  }

  async function handleSave() {
    if (!brand.client_name.trim()) {
      setError('Brand name is missing — this brand record looks corrupted.')
      return
    }

    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const updated = await updateBrand(
        brand.id,
        {
          brand_identity: brandIdentity.trim() || null,
          brand_voice: brandVoice.trim() || null,
          target_audience: targetAudience.trim() || null,
          product_categories: productCategories.trim()
            ? productCategories.split(',').map((c) => c.trim()).filter(Boolean)
            : null,
          positioning: positioning.trim() || null,
          brand_guidelines: brandGuidelines.trim() || null,
          marketplace_preferences: Object.keys(marketplacePreferences).length > 0 ? marketplacePreferences : null
        },
        createClient()
      )
      setSaved(true)
      onSaved(updated as Client)
    } catch (err: any) {
      setError(err?.message || 'Could not save brand profile. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Brand profile"
        className={`relative w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto p-6 focus:outline-none ${cardClass}`}
      >
        <h2 className={`${sectionHeadingClass} mb-1`}>{brand.client_name}</h2>
        <p className={`${bodyTextClass} mb-4 text-[var(--muted-text)]`}>Brand profile</p>

        <div className="flex flex-col gap-4">
          <div>
            <label className={labelClass}>Brand Identity</label>
            <textarea
              value={brandIdentity}
              onChange={(e) => { setBrandIdentity(e.target.value); setSaved(false) }}
              placeholder="Core identity — who this brand is, in a sentence or two."
              className={`${inputClass} w-full mt-1`}
              rows={2}
            />
          </div>

          <div>
            <label className={labelClass}>Brand Voice</label>
            <textarea
              value={brandVoice}
              onChange={(e) => { setBrandVoice(e.target.value); setSaved(false) }}
              placeholder="Tone, vocabulary, communication style."
              className={`${inputClass} w-full mt-1`}
              rows={2}
            />
          </div>

          <div>
            <label className={labelClass}>Target Audience</label>
            <textarea
              value={targetAudience}
              onChange={(e) => { setTargetAudience(e.target.value); setSaved(false) }}
              placeholder="Who this brand's products are made for."
              className={`${inputClass} w-full mt-1`}
              rows={2}
            />
          </div>

          <div>
            <label className={labelClass}>Product Categories</label>
            <input
              type="text"
              value={productCategories}
              onChange={(e) => { setProductCategories(e.target.value); setSaved(false) }}
              placeholder="Home Decor, Furniture, Lighting (comma-separated)"
              className={`${inputClass} w-full mt-1`}
            />
          </div>

          <div>
            <label className={labelClass}>Positioning</label>
            <textarea
              value={positioning}
              onChange={(e) => { setPositioning(e.target.value); setSaved(false) }}
              placeholder="Market positioning / differentiation."
              className={`${inputClass} w-full mt-1`}
              rows={2}
            />
          </div>

          <div>
            <label className={labelClass}>Brand Guidelines</label>
            <textarea
              value={brandGuidelines}
              onChange={(e) => { setBrandGuidelines(e.target.value); setSaved(false) }}
              placeholder="Persistent content/creative rules applied to generation."
              className={`${inputClass} w-full mt-1`}
              rows={2}
            />
          </div>

          <div>
            <label className={labelClass}>Marketplace Preferences</label>
            <div className="mt-1 flex flex-col gap-2">
              {SUPPORTED_MARKETPLACES.map((marketplace) => {
                const pref = marketplacePreferences[marketplace]
                return (
                  <div key={marketplace} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`mp-${marketplace}`}
                      checked={pref?.enabled ?? false}
                      onChange={() => togglePreferenceEnabled(marketplace)}
                      className="shrink-0"
                    />
                    <label htmlFor={`mp-${marketplace}`} className="text-sm text-[var(--body-text)] w-20 shrink-0">
                      {MARKETPLACE_LABELS[marketplace]}
                    </label>
                    <input
                      type="text"
                      value={pref?.notes ?? ''}
                      onChange={(e) => updatePreferenceNotes(marketplace, e.target.value)}
                      placeholder="Notes (optional)"
                      className={`${inputClass} flex-1 text-sm py-1.5`}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {error && (
          <div className={`mt-4 ${dangerBannerClass}`}>
            <p className={dangerTextClass}>{error}</p>
          </div>
        )}

        {saved && !error && <p className="mt-4 text-sm text-[var(--success-text)]">✓ Saved</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className={linkButtonClass}>
            Close
          </button>
          <button onClick={handleSave} disabled={saving} className={buttonPrimaryClass}>
            {saving ? 'Saving…' : 'Save Brand Profile'}
          </button>
        </div>
      </div>
    </div>
  )
}
