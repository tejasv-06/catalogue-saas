"use client"

import { useState } from 'react'

const marketplaces = ['amazon', 'flipkart', 'myntra', 'etsy', 'tatacliq']

export default function ExportCsv() {
  const [targetMarketplace, setTargetMarketplace] = useState(marketplaces[0])
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleExport() {
    setExporting(true)
    setError(null)

    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_marketplace: targetMarketplace })
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Export failed')
      setExporting(false)
      return
    }

    const blob = await res.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${targetMarketplace}-export.csv`
    a.click()
    window.URL.revokeObjectURL(url)

    setExporting(false)
  }

  return (
    <div className="flex flex-col gap-2 max-w-sm p-4 border rounded">
      <select
        value={targetMarketplace}
        onChange={(e) => setTargetMarketplace(e.target.value)}
        className="border p-2 rounded"
      >
        {marketplaces.map((marketplace) => (
          <option key={marketplace} value={marketplace}>
            {marketplace}
          </option>
        ))}
      </select>
      <button
        onClick={handleExport}
        disabled={exporting}
        className="bg-black text-white p-2 rounded disabled:opacity-50"
      >
        {exporting ? 'Exporting...' : 'Export CSV'}
      </button>
      {error && <p className="mt-2 text-red-500">Error: {error}</p>}
    </div>
  )
}
