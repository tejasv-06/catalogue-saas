import Groq from 'groq-sdk'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js'
import { createClient as createAuthClient } from '@/lib/supabase/server'
import { shapeForPlatform } from '@/lib/platformShapers'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const GUEST_GENERATION_LIMIT = 10

function formatDirectImageUrl(url: string): string {
  const driveFileMatch = url.match(/\/file\/d\/([^/]+)/)
  const driveIdMatch = url.match(/[?&]id=([^&]+)/)
  const driveFileId = driveFileMatch?.[1] || driveIdMatch?.[1]

  if (url.includes('drive.google.com') && driveFileId) {
    return `https://lh3.googleusercontent.com/d/${driveFileId}`
  }

  if (url.includes('dropbox.com')) {
    return url
      .replace('www.dropbox.com', 'dl.dropboxusercontent.com')
      .replace('dl=0', 'raw=1')
  }

  return url
}

class EmptyContentError extends Error {
  constructor() {
    super('Model returned empty content')
  }
}

function isTransientGroqError(err: any): boolean {
  if (err instanceof EmptyContentError) return true

  const status = err?.status
  const code = err?.error?.error?.code || err?.error?.code
  const messageText = String(err?.message || '')

  return status === 400 && (code === 'json_validate_failed' || messageText.includes('json_validate_failed'))
}

function isInvalidImageError(err: any): boolean {
  const status = err?.status
  const messageText = String(err?.error?.error?.message || err?.message || '').toLowerCase()

  return status === 400 && messageText.includes('invalid image data')
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let delay = 500

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      if (!isTransientGroqError(err) || attempt === maxAttempts) {
        throw err
      }
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay *= 2
    }
  }

  throw new Error('Generation failed after retries')
}

function buildUserContent(promptText: string, resolvedImageUrl: string | null) {
  return resolvedImageUrl
    ? [
        { type: 'text' as const, text: promptText },
        { type: 'image_url' as const, image_url: { url: resolvedImageUrl } }
      ]
    : promptText
}

// service_role key is read ONLY here, inside this server-only route file —
// never exported from a shared lib module, never reachable from client code.
function getSupabaseAdminClient() {
  return createSupabaseAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function getOrCreateAnonId(): Promise<string> {
  const cookieStore = await cookies()
  let anonId = cookieStore.get('anon_id')?.value

  if (!anonId) {
    anonId = crypto.randomUUID()
    cookieStore.set('anon_id', anonId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/'
    })
  }

  return anonId
}

async function isUnderGuestLimit(anonId: string): Promise<boolean> {
  const admin = getSupabaseAdminClient()
  const { data } = await admin
    .from('guest_usage')
    .select('generation_count')
    .eq('anon_id', anonId)
    .maybeSingle()

  return !data || data.generation_count < GUEST_GENERATION_LIMIT
}

async function incrementGuestUsage(anonId: string) {
  const admin = getSupabaseAdminClient()
  const { data } = await admin
    .from('guest_usage')
    .select('generation_count')
    .eq('anon_id', anonId)
    .maybeSingle()

  if (data) {
    await admin.from('guest_usage').update({ generation_count: data.generation_count + 1 }).eq('anon_id', anonId)
  } else {
    await admin.from('guest_usage').insert({ anon_id: anonId, generation_count: 1 })
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { brandName, description, category, targetMarketplace, imageBase64, imageUrl, brandGuidelines } = body || {}

  if (!description || !targetMarketplace) {
    return NextResponse.json({ error: 'Missing description or targetMarketplace' }, { status: 400 })
  }

  const authClient = await createAuthClient()
  const { data: authData } = await authClient.auth.getClaims()
  const isGuest = !authData?.claims

  let anonId: string | null = null

  if (isGuest) {
    try {
      anonId = await getOrCreateAnonId()
      const allowed = await isUnderGuestLimit(anonId)
      if (!allowed) {
        return NextResponse.json(
          { error: 'Free preview limit reached. Sign in to continue generating.' },
          { status: 403 }
        )
      }
    } catch (err: any) {
      // If the guest-limit check itself fails (missing service_role key, missing
      // guest_usage table, transient Supabase error), don't take down generation
      // for every guest over an infra/config issue — fail open for this request.
      console.error('Guest usage check failed, allowing generation:', err.message)
    }
  }

  try {
    const promptText = `Brand: ${brandName || 'N/A'}\nCategory: ${category || 'unspecified'}\nRaw description: ${description}`

    const resolvedImageUrl = imageBase64
      ? imageBase64
      : imageUrl
        ? formatDirectImageUrl(imageUrl)
        : null

    const systemPrompt = `You are an expert e-commerce SEO copywriter. Given a brand, category, raw product description, and (when provided) a product image, generate high-ranking marketplace content.
When an image is provided, analyze its visual details — exact color shade, pattern, fabric texture, neckline, sleeve type, embellishments — and weave those specifics directly into the title, bullets, and keywordPool.${
      brandGuidelines ? `\nFollow these brand-specific guidelines when writing: ${brandGuidelines}` : ''
    }
Respond ONLY with valid JSON in exactly this shape:
{
  "title": "string, compelling and keyword-rich",
  "description": "string, 2-4 sentences, benefit-focused",
  "bullets": ["string","string","string","string","string"],
  "keywordPool": ["string", ... 20 to 25 relevant, high-search-volume keywords/phrases, no duplicates]
}
CRITICAL: Output ONLY valid, raw JSON. Do NOT wrap output in markdown fences (no \`\`\`json or \`\`\`), and do NOT include any introductory or trailing commentary.`

    async function runCompletion(includeImage: boolean): Promise<string> {
      return withRetry(async () => {
        const completion = await groq.chat.completions.create({
          model: 'qwen/qwen3.6-27b',
          reasoning_effort: 'none',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: buildUserContent(promptText, includeImage ? resolvedImageUrl : null)
            }
          ]
        })

        const content = completion.choices[0]?.message?.content
        if (!content || !content.trim()) {
          throw new EmptyContentError()
        }
        return content
      })
    }

    let rawContent: string
    try {
      rawContent = await runCompletion(!!resolvedImageUrl)
    } catch (err: any) {
      if (resolvedImageUrl && isInvalidImageError(err)) {
        // the image itself was rejected (unreachable / not real image bytes / unsupported
        // format) — fall back to a text-only generation rather than failing the whole
        // listing over one bad image URL
        rawContent = await runCompletion(false)
      } else {
        throw err
      }
    }

    rawContent = rawContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()

    const aiResult = JSON.parse(rawContent)
    const generatedContent = shapeForPlatform(targetMarketplace, aiResult, { brand_name: brandName })

    if (isGuest && anonId) {
      try {
        await incrementGuestUsage(anonId)
      } catch (err: any) {
        // Don't discard an already-successful generation just because the
        // usage-count bookkeeping failed.
        console.error('Failed to increment guest usage:', err.message)
      }
    }

    return NextResponse.json({ generatedContent })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
