import Groq from 'groq-sdk'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'
import { shapeForPlatform } from '@/lib/platformShapers'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

async function generateOne(product: any) {
  const completion = await groq.chat.completions.create({
    model: 'qwen/qwen3.6-27b',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are an expert e-commerce SEO copywriter. Given a brand, category, and raw product description, generate high-ranking marketplace content.
Respond ONLY with valid JSON in exactly this shape:
{
  "title": "string, compelling and keyword-rich",
  "description": "string, 2-4 sentences, benefit-focused",
  "bullets": ["string","string","string","string","string"],
  "keywordPool": ["string", ... 20 to 25 relevant, high-search-volume keywords/phrases, no duplicates]
}`
      },
      {
        role: 'user',
        content: `Brand: ${product.brand_name || 'N/A'}\nCategory: ${product.category || 'unspecified'}\nRaw description: ${product.description}`
      }
    ]
  })

  const raw = completion.choices[0].message.content || '{}'
  const aiResult = JSON.parse(raw)
  return shapeForPlatform(product.target_marketplace, aiResult, product)
}

export async function POST() {
  const { data: products, error: fetchError } = await supabase
    .from('products')
    .select('*')
    .eq('status', 'pending')

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  const results = []

  for (const product of products) {
    try {
      const generated = await generateOne(product)

      const { data: updateData, error: updateError } = await supabase
        .from('products')
        .update({
          generated_content: generated,
          status: 'reviewed'
        })
        .eq('id', product.id)
        .select()

      const actuallyUpdated = !updateError && updateData && updateData.length > 0
      results.push({ id: product.id, success: actuallyUpdated, error: updateError?.message })
    } catch (err: any) {
      results.push({ id: product.id, success: false, error: err.message })
    }
  }

  return NextResponse.json({ results })
}