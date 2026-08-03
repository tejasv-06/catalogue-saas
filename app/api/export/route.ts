import Papa from 'papaparse'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'
import { exportColumns, flattenRow } from '@/lib/exportShapers'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const targetMarketplace = body?.target_marketplace

  if (!targetMarketplace || typeof targetMarketplace !== 'string') {
    return NextResponse.json({ error: 'Missing target_marketplace' }, { status: 400 })
  }

  const columns = exportColumns[targetMarketplace]
  if (!columns) {
    return NextResponse.json(
      { error: `No export column mapping defined for marketplace "${targetMarketplace}"` },
      { status: 400 }
    )
  }

  const { data: products, error } = await supabase
    .from('products')
    .select('*')
    .eq('status', 'reviewed')
    .eq('target_marketplace', targetMarketplace)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!products || products.length === 0) {
    return NextResponse.json(
      { error: `No reviewed products found for ${targetMarketplace}` },
      { status: 404 }
    )
  }

  const rows = products.map((product) => flattenRow(targetMarketplace, product.generated_content))
  const csv = Papa.unparse(rows, { columns })

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${targetMarketplace}-export.csv"`
    }
  })
}
