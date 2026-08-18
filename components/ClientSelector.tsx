"use client"

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { buttonSecondaryClass, cardClass, inputClass, selectClass } from '@/lib/uiClasses'
import type { MarketplacePreferences } from '@/lib/brands'

// Milestone C12: widened to the brand profile fields added to `clients`
// (supabase/migrations/20260810_07_brand_profile.sql). Purely a type
// change: fetchClients() below already does select('*'), so these fields
// were already arriving over the wire: only their type was previously
// narrower than the real row shape. All new fields are optional so a row
// fetched before this migration was applied (impossible in practice once
// applied, but matches this codebase's existing defensive convention for
// additive columns) still type-checks.
export type Client = {
  id: string
  client_name: string
  brand_guidelines: string | null
  brand_identity?: string | null
  brand_voice?: string | null
  target_audience?: string | null
  product_categories?: string[] | null
  positioning?: string | null
  marketplace_preferences?: MarketplacePreferences | null
  updated_at?: string
}

const NEW_CLIENT_VALUE = '__new__'

export default function ClientSelector({
  selectedClientId,
  onSelectClient
}: {
  selectedClientId: string
  onSelectClient: (client: Client | null) => void
}) {
  const [clients, setClients] = useState<Client[]>([])
  const [showNewClientForm, setShowNewClientForm] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [newClientGuidelines, setNewClientGuidelines] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function fetchClients() {
      // Milestone 18: must be the same @supabase/ssr browser client the login
      // flow uses (see app/login/page.tsx): a plain @supabase/supabase-js
      // client (the old lib/supabaseClient.ts import this replaced) never
      // carries the signed-in session, so every request landed here as
      // effectively anonymous and clients' owner-scoped RLS returned nothing.
      const supabase = createClient()
      const { data, error } = await supabase.from('clients').select('*').order('client_name')
      if (!error && data) {
        setClients(data)
      }
    }
    fetchClients()
  }, [])

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value

    if (value === NEW_CLIENT_VALUE) {
      setShowNewClientForm(true)
      onSelectClient(null)
      return
    }

    setShowNewClientForm(false)

    if (!value) {
      onSelectClient(null)
      return
    }

    onSelectClient(clients.find((c) => c.id === value) || null)
  }

  async function handleSaveNewClient() {
    if (!newClientName.trim()) {
      alert('Brand name is required')
      return
    }

    setSaving(true)
    const supabase = createClient()
    // Milestone 18: clients' INSERT policy requires auth.uid() = user_id: the
    // id must come from the session itself (supabase.auth.getUser(), server-
    // verified), never from anything already sitting in component state, so
    // there's no way for this to be spoofed via client-side input.
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) {
      setSaving(false)
      alert('You must be signed in to save a brand.')
      return
    }

    const { data, error } = await supabase
      .from('clients')
      .insert({
        client_name: newClientName.trim(),
        brand_guidelines: newClientGuidelines.trim(),
        user_id: userData.user.id
      })
      .select()
      .single()
    setSaving(false)

    if (error || !data) {
      alert('Error saving brand: ' + (error?.message || 'Unknown error'))
      return
    }

    setClients((prev) => [...prev, data])
    setShowNewClientForm(false)
    setNewClientName('')
    setNewClientGuidelines('')
    onSelectClient(data)
  }

  return (
    <div className="flex flex-col gap-1">
      <select value={showNewClientForm ? NEW_CLIENT_VALUE : selectedClientId} onChange={handleSelectChange} className={selectClass}>
        <option value="">No brand selected</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.client_name}
          </option>
        ))}
        <option value={NEW_CLIENT_VALUE}>+ New Brand</option>
      </select>

      {showNewClientForm && (
        <div className={`flex flex-col gap-2 p-6 max-w-sm ${cardClass}`}>
          <input
            type="text"
            placeholder="Brand name"
            value={newClientName}
            onChange={(e) => setNewClientName(e.target.value)}
            className={inputClass}
          />
          <textarea
            placeholder="Brand guidelines"
            value={newClientGuidelines}
            onChange={(e) => setNewClientGuidelines(e.target.value)}
            className={inputClass}
          />
          <button onClick={handleSaveNewClient} disabled={saving} className={buttonSecondaryClass}>
            {saving ? 'Saving...' : 'Save Brand'}
          </button>
        </div>
      )}
    </div>
  )
}
