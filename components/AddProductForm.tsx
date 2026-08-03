"use client"

import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

export default function AddProductForm() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase
      .from('products')
      .insert({ title, description, category, target_marketplace: 'amazon' })

    if (error) {
      alert('Error: ' + error.message)
    } else {
      alert('Product added!')
      setTitle('')
      setDescription('')
      setCategory('')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 max-w-sm p-4 border rounded">
      <input
        type="text"
        placeholder="Product title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="border p-2 rounded"
      />
      <textarea
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="border p-2 rounded"
      />
      <input
        type="text"
        placeholder="Category"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="border p-2 rounded"
      />
      <button type="submit" className="bg-black text-white p-2 rounded">
        Add Product
      </button>
    </form>
  )
}

export function TestGenerateButton() {
  const [result, setResult] = useState<any>(null)

  async function handleClick() {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'plain t shirt', description: 'a shirt', target_marketplace: 'myntra' })
    })
    const data = await res.json()
    setResult(data)
  }

  return (
    <div className="mt-4">
      <button onClick={handleClick} className="bg-blue-600 text-white p-2 rounded">
        Test Generate
      </button>
      {result && (
        <div className="mt-2">
          <p><strong>Title:</strong> {result.title}</p>
          <p><strong>Description:</strong> {result.description}</p>
          <ul className="list-disc pl-5">
            {result.bullets?.map((b: string, i: number) => <li key={i}>{b}</li>)}
          </ul>
          <p><strong>Tags:</strong> {result.tags?.join(', ')}</p>
        </div>
      )}
    </div>
  )
}

export function GenerateAllButton() {
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<any>(null)

  async function handleClick() {
    setLoading(true)
    setSummary(null)
    const res = await fetch('/api/generate-all', { method: 'POST' })
    const data = await res.json()
    setSummary(data.results)
    setLoading(false)
  }

  return (
    <div className="mt-4">
      <button
        onClick={handleClick}
        disabled={loading}
        className="bg-green-600 text-white p-2 rounded disabled:opacity-50"
      >
        {loading ? 'Generating...' : 'Generate All Pending Products'}
      </button>
      {summary && (
        <div className="mt-2">
          <p>
            {summary.filter((r: any) => r.success).length} succeeded, {summary.filter((r: any) => !r.success).length} failed.
          </p>
          {summary.filter((r: any) => !r.success).length > 0 && (
            <ul className="list-disc pl-5 text-red-600 text-sm">
              {summary
                .filter((r: any) => !r.success)
                .map((r: any) => (
                  <li key={r.id}>
                    Product {r.id}: {r.error}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}