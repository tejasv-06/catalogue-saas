"use client"

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

export type Client = {
  id: string
  client_name: string
  brand_guidelines: string | null
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
    const { data, error } = await supabase
      .from('clients')
      .insert({ client_name: newClientName.trim(), brand_guidelines: newClientGuidelines.trim() })
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
      <select
        value={showNewClientForm ? NEW_CLIENT_VALUE : selectedClientId}
        onChange={handleSelectChange}
        className="border p-2 rounded"
      >
        <option value="">No brand selected</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.client_name}
          </option>
        ))}
        <option value={NEW_CLIENT_VALUE}>+ New Brand</option>
      </select>

      {showNewClientForm && (
        <div className="flex flex-col gap-2 p-3 border rounded bg-white max-w-sm">
          <input
            type="text"
            placeholder="Brand name"
            value={newClientName}
            onChange={(e) => setNewClientName(e.target.value)}
            className="border p-2 rounded"
          />
          <textarea
            placeholder="Brand guidelines"
            value={newClientGuidelines}
            onChange={(e) => setNewClientGuidelines(e.target.value)}
            className="border p-2 rounded"
          />
          <button
            onClick={handleSaveNewClient}
            disabled={saving}
            className="bg-black text-white p-2 rounded disabled:opacity-50 text-sm"
          >
            {saving ? 'Saving...' : 'Save Brand'}
          </button>
        </div>
      )}
    </div>
  )
}
