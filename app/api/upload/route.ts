import Papa from 'papaparse'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'
import { pick } from '@/lib/csvMapping'

export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get('file')
  const targetMarketplace = formData.get('target_marketplace')

  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  }

  if (!targetMarketplace || typeof targetMarketplace !== 'string') {
    return NextResponse.json({ error: 'Missing target_marketplace' }, { status: 400 })
  }

  const csvText = await file.text()
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true
  })

  if (parsed.errors.length > 0) {
    return NextResponse.json({ error: parsed.errors[0].message }, { status: 400 })
  }

  const rows = parsed.data.map((row) => ({
    brand_name: pick(row, 'Brand', 'brand'),
    description: pick(row, 'Product description', 'description'),
    image_url: pick(row, 'image url', 'image_url'),
    category: pick(row, 'category'),
    target_marketplace: targetMarketplace,
    status: 'pending'
  }))

  const { data, error } = await supabase
    .from('products')
    .insert(rows)
    .select()

  const insertedCount = !error && data ? data.length : 0

  return NextResponse.json({ inserted: insertedCount, error: error?.message })
}
