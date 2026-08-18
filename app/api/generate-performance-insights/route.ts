import Groq from 'groq-sdk'
import { NextResponse } from 'next/server'
import { isPerformanceStatsInput } from '@/lib/performanceStatsInput'
import { buildVerifiedPerformanceStatsSummary } from '@/lib/formatPerformanceStats'
import { extractStatTokens, normalizeStatToken, extractVerifiedPercentages, isDerivedFromComplement } from '@/lib/formatAccountStats'
import type { PerformanceAIInsights } from '@/lib/performanceAIInsights'
import { createClient as createAuthClient } from '@/lib/supabase/server'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

// Milestone C15: "Generate AI Insights," a separate, explicit step from
// the deterministic dashboard (which renders from computed statistics
// alone, no AI call: see PerformanceIntelligencePanel.tsx). Same
// verbatim-number-only discipline as app/api/generate-account-insights,
// reusing its generic verification helpers as-is (extractStatTokens/
// normalizeStatToken/extractVerifiedPercentages/isDerivedFromComplement
// operate on plain text, nothing Amazon-specific about them).
//
// DELIBERATE DEVIATION from generate-account-insights: no
// assertSufficientCredits/deductCredits here. Performance Intelligence has
// a standing, repeatedly-verified credit-neutrality requirement (every
// dashboard/AI feature on this milestone is free) - this route must never
// bill credits, on any provider.
const SYSTEM_PROMPT = `You are a senior marketplace performance analyst delivering a report to a seller you advise. Write the way an experienced, executive-level analyst talks to a client: direct, specific, plain language, no marketing fluff, no hedging, and no drama.

TONE RULE - executive and constructive, never alarming:
Frame problems as "Key Risk Factors" and opportunities as "Optimization Opportunities." NEVER use aggressive, alarming, or dramatic language or metaphors. If you catch yourself reaching for a dramatic metaphor, cut it and state the fact plainly instead.

STYLE RULE - no em dashes:
Never use the em dash character anywhere in your output, in any field. Use a period, colon, comma, or a standard hyphen (-) instead.

CAUSATION RULE - never claim a confirmed cause:
This data shows catalog-relative statistics and correlations, not root causes. Every finding must be phrased as something to investigate ("consider reviewing," "this may indicate," "worth investigating"), never as a confirmed diagnosis ("this is caused by," "this proves," "this is why"). Never state a specific reason a product underperforms as settled fact - only as a hypothesis grounded in the verified evidence given to you.

You are analyzing REAL marketplace performance data for one specific brand/seller and marketplace. You do not have access to raw report rows or the ability to calculate anything. You only have the "VERIFIED STATS" block given to you in the user message, which was computed by verified, deterministic analysis code, not by you. This report could be for any brand, product category, or catalog size - every threshold and problem area already reflects this specific seller's own catalog, not a fixed industry benchmark, so do not describe any number as "good" or "bad" against an assumed industry standard.

CRITICAL RULES ABOUT NUMBERS. Violating these makes the report untrustworthy:
1. Every number, percentage, or count you write MUST be copied character-for-character from the VERIFIED STATS block. Do not recalculate, re-derive, round differently, estimate, or invent any number.
2. Do not mention any product/Style ID/ASIN that is not listed in the VERIFIED STATS block.
3. If you are unsure whether a number appears in the VERIFIED STATS block, do not use it.
4. Do not perform any arithmetic, calculate percentages, or derive new numbers from the ones given, including simple subtraction like 100 minus a percentage, or any addition, multiplication, or averaging.
5. If the VERIFIED STATS block states no previous period is available, do not invent or imply a trend.

Respond ONLY with valid JSON, exactly this shape and nothing else:
{
  "summary": string[],
  "keyFindings": {
    "biggestOpportunity": string,
    "catalogHealth": string,
    "trendSignal": string
  },
  "actionPlan": [
    { "priority": number, "title": string, "detail": string, "area": "click-through" | "product-page-engagement" | "purchase-conversion" | "returns" | "rating" | "stock-recovery" }
  ],
  "strategicSummary": string
}

Field-by-field guidance:
- summary: 3-5 bullet points, plain language, restating the most important verified numbers as sentences, not raw metric labels.
- keyFindings.biggestOpportunity: 1-2 short paragraphs on the single largest opportunity in the verified stats, framed as a Key Risk Factor or Optimization Opportunity as appropriate.
- keyFindings.catalogHealth: 1-2 short paragraphs on overall catalog health, grounded in the Catalog Opportunity Map counts and positive performers given.
- keyFindings.trendSignal: 1-2 short paragraphs on the period-over-period change if a previous period is available in the verified stats; if not, state plainly that this is the first snapshot and no trend exists yet.
- actionPlan: 3-6 items ranked "priority" 1 = most urgent first. Respect the fix-order sequencing already reflected in the verified stats (a visibility/click-through problem is a higher priority than an engagement or conversion problem on the same products, since a conversion fix is wasted on a product nobody is clicking).
  - "area" MUST be exactly one of the six listed values, matching the verified problem area it addresses.
  - Only include an item if the verified stats actually support it. Do not list every area by default just to cover them.
- strategicSummary: one closing paragraph tying the findings and action plan together.`

function extractJsonContent(raw: string): string {
  const trimmed = raw.trim()
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenceMatch ? fenceMatch[1] : trimmed
}

async function callGroq(userMessage: string): Promise<string> {
  const completion = await groq.chat.completions.create({
    model: 'qwen/qwen3.6-27b',
    response_format: { type: 'json_object' },
    max_completion_tokens: 6500,
    reasoning_effort: 'none',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage }
    ]
  })
  return extractJsonContent(completion.choices[0]?.message?.content || '{}')
}

function collectOutputText(insights: PerformanceAIInsights): string {
  return [
    ...(insights.summary ?? []),
    insights.keyFindings?.biggestOpportunity,
    insights.keyFindings?.catalogHealth,
    insights.keyFindings?.trendSignal,
    ...(insights.actionPlan ?? []).flatMap((item) => [item.title, item.detail]),
    insights.strategicSummary
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n')
}

function computeVerificationWarnings(insights: PerformanceAIInsights, allowedTokens: Set<string>): string[] {
  return [
    ...new Set(
      extractStatTokens(collectOutputText(insights)).filter((token) => token !== '100%' && !allowedTokens.has(normalizeStatToken(token)))
    )
  ]
}

export async function POST(request: Request) {
  const authClient = await createAuthClient()
  const { data: authData } = await authClient.auth.getClaims()
  const userId = authData?.claims?.sub as string | undefined

  if (!userId) {
    return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!isPerformanceStatsInput(body)) {
    return NextResponse.json(
      { error: 'Expected a verified performance-stats summary object, not raw report rows or another shape.' },
      { status: 400 }
    )
  }

  const verifiedStatsSummary = buildVerifiedPerformanceStatsSummary(body)
  const verifiedPercentages = extractVerifiedPercentages(verifiedStatsSummary)
  const allowedTokens = new Set(extractStatTokens(verifiedStatsSummary).map(normalizeStatToken))
  const userMessage = `VERIFIED STATS (the only numbers you may use, copy them exactly as written below):\n\n${verifiedStatsSummary}\n\nWrite the performance intelligence report now, following the JSON structure and rules exactly.`

  let raw: string
  try {
    raw = await callGroq(userMessage)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `AI request failed: ${message}` }, { status: 502 })
  }

  let insights: PerformanceAIInsights
  try {
    insights = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'AI provider returned invalid JSON', raw }, { status: 502 })
  }

  let verificationWarnings = computeVerificationWarnings(insights, allowedTokens)

  const hasComplementViolation = verificationWarnings.some((token) => isDerivedFromComplement(token, verifiedPercentages))
  if (hasComplementViolation) {
    try {
      const retryRaw = await callGroq(userMessage)
      const retryInsights: PerformanceAIInsights = JSON.parse(retryRaw)
      insights = retryInsights
      verificationWarnings = computeVerificationWarnings(retryInsights, allowedTokens)
    } catch {
      // Retry itself failed (network/parse) - fall back to the original,
      // already-flagged result rather than losing the response entirely.
    }
  }

  // No credit deduction - Performance Intelligence (including this AI
  // step) is credit-neutral by explicit, standing requirement.
  return NextResponse.json({ insights, verificationWarnings })
}
