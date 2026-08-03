import Groq from 'groq-sdk'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

const marketplaceRules: Record<string, string> = {
  amazon: 'Title must be under 150 characters, keyword-rich, no promotional words like "best" or "free". Bullets should be feature-focused, starting with a capitalized keyword phrase.',
  flipkart: 'Title must be under 100 characters, include brand and key attribute (e.g. material, size). Bullets should be short and specification-focused.',
  myntra: 'Title should follow fashion conventions: Brand + Product Type + Key Attribute (e.g. color/fit). Description should be brief and style-focused, not technical.',
  etsy: 'Title should be descriptive and SEO-friendly, can include relevant emotional/style keywords. Description should tell a short story about the product, warmer and more personal in tone. Tags should be SEO search terms buyers might use.',
  tatacliq: 'Title must be concise and attribute-driven similar to Flipkart style. Bullets should be short and specification-focused.'
}

async function generateOne(product: any) {
  const platformRules = marketplaceRules[product.target_marketplace] || 'Use general e-commerce best practices.'

  const completion = await groq.chat.completions.create({
    model: 'qwen/qwen3.6-27b',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are an e-commerce copywriter for ${product.target_marketplace || 'a general marketplace'}.
Platform-specific rules: ${platformRules}
Respond ONLY with valid JSON in exactly this shape, no extra text:
{ "title": "string", "description": "string, 2-3 sentences", "bullets": ["string","string","string"], "tags": ["string","string","string"] }`
      },
      {
        role: 'user',
        content: `Raw title: ${product.title}\nRaw description: ${product.description}`
      }
    ]
  })

  const raw = completion.choices[0].message.content || '{}'
  return JSON.parse(raw)
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

      const { error: updateError } = await supabase
        .from('products')
        .update({
          ai_title: generated.title,
          ai_description: generated.description,
          ai_bullets: generated.bullets?.join(' | '),
          ai_tags: generated.tags?.join(', '),
          status: 'reviewed'
        })
        .eq('id', product.id)

      results.push({ id: product.id, success: !updateError })
    } catch (err: any) {
      results.push({ id: product.id, success: false, error: err.message })
    }
  }

  return NextResponse.json({ results })
}