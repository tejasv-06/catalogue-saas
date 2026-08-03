"use client"

import { useState } from 'react'

const marketplaces = ['amazon', 'flipkart', 'myntra', 'etsy', 'tatacliq']

export default function UploadCsv() {
  const [file, setFile] = useState<File | null>(null)
  const [targetMarketplace, setTargetMarketplace] = useState(marketplaces[0])
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ inserted?: number; error?: string } | null>(null)

  async function handleUpload() {
    if (!file) {
      alert('Choose a CSV file first')
      return
    }

    setUploading(true)
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('target_marketplace', targetMarketplace)

    const res = await fetch('/api/upload', { method: 'POST', body: formData })
    const data = await res.json()
    setResult(data)
    setUploading(false)
  }

  return (
    <div className="flex flex-col gap-2 max-w-sm p-4 border rounded">
      <a
        href="/sample-products.csv"
        download
        className="text-blue-600 underline text-sm"
      >
        Download Sample CSV
      </a>
      <input
        type="file"
        accept=".csv"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="border p-2 rounded"
      />
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
        onClick={handleUpload}
        disabled={uploading}
        className="bg-black text-white p-2 rounded disabled:opacity-50"
      >
        {uploading ? 'Uploading...' : 'Upload CSV'}
      </button>
      {result && (
        <p className="mt-2">
          {result.error ? `Error: ${result.error}` : `Inserted ${result.inserted} products.`}
        </p>
      )}
    </div>
  )
}
