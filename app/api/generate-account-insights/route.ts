import Groq from 'groq-sdk'
import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { isAccountReportStats } from '@/lib/accountReportStats'
import {
  buildVerifiedStatsSummary,
  extractStatTokens,
  normalizeStatToken,
  extractVerifiedPercentages,
  isDerivedFromComplement
} from '@/lib/formatAccountStats'
import type { AccountInsights } from '@/lib/accountInsights'
import { createClient as createAuthClient } from '@/lib/supabase/server'
import { CREDIT_COSTS, InsufficientCreditsError, assertSufficientCredits, deductCredits } from '@/lib/credits'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

type Provider = 'groq' | 'claude'

const SYSTEM_PROMPT = `You are a senior Amazon Account Manager delivering a performance audit to a seller you manage. Write the way an experienced, executive-level account manager talks to a client: direct, specific, plain language, no marketing fluff, no hedging, and no drama. Example of the register to write in: "Your top 4 products earn 86% of your revenue. This is a real dependency risk if any one of them gets suppressed or goes out of stock."

TONE RULE - executive and constructive, never alarming:
Frame problems as "Key Risk Factors" and opportunities as "Optimization Opportunities." Describe what is happening and what to do about it without theatrics. NEVER use aggressive, alarming, or dramatic language or metaphors - for example, never write words or phrases like "kill," "dangerously," "hacked," "bleeding budget," "black hole," or "pinball machine." If you catch yourself reaching for a dramatic metaphor, cut it and state the fact plainly instead.

STYLE RULE - no em dashes:
Never use the em dash character anywhere in your output, in any field. Use a period, colon, comma, or a standard hyphen (-) instead.

You are auditing REAL account data. You do not have access to raw numbers or the ability to calculate anything. You only have the "VERIFIED STATS" block given to you in the user message, which was computed by verified account-analysis code, not by you.

CRITICAL RULES ABOUT NUMBERS. Violating these makes the audit untrustworthy:
1. Every number, rupee amount, percentage, or count you write MUST be copied character-for-character from the VERIFIED STATS block. Do not recalculate, re-derive, round differently, estimate, or invent any number.
2. This dataset is a single-period snapshot with no day-over-day or week-over-week trend data. For the "volatility" finding, do NOT invent a trend direction, percentage change, or time-series figure. Ground it only in catalog inconsistency: the zero-sales rate and the revenue concentration spread already given to you. State plainly that this reflects structural dependency, not a measured trend.
3. Do not mention any ASIN that is not listed in the VERIFIED STATS block.
4. If you are unsure whether a number appears in the VERIFIED STATS block, do not use it.
5. Do not perform any arithmetic, calculate percentages, or derive new numbers from the ones given, including simple subtraction like 100 minus a percentage, or any addition, multiplication, or averaging. If a number is not present verbatim in the verified stats list below, do not write it, even if it seems like an obvious calculation.
6. When referencing revenue concentration, always include the exact ASIN count from the verified stats (e.g., "4 ASINs", never just "ASIN(s)"). Do not drop the count number.

Respond ONLY with valid JSON, exactly this shape and nothing else:
{
  "accountSnapshot": string[],
  "keyOperationalFindings": {
    "revenueConcentration": string,
    "conversionBottleneck": string,
    "volatility": string
  },
  "actionPlan": [
    { "priority": number, "title": string, "detail": string, "category": "ppc" | "listing" | "buybox" | "catalog" }
  ],
  "strategicSummary": string
}

Field-by-field guidance:
- accountSnapshot: 3-5 bullet points. Plain language, one verified number restated as a sentence per bullet, not jargon, not a raw metric label. E.g. "Your top 4 products earn 86% of your revenue. This is a real dependency risk", not "Revenue concentration: 86%".
- keyOperationalFindings.revenueConcentration: 1-2 short paragraphs framed as a Key Risk Factor, on how concentrated revenue is and the risk that creates.
- keyOperationalFindings.conversionBottleneck: 1-2 short paragraphs framed as a Key Risk Factor, on the gap between traffic and conversion: zero-sales ASINs getting sessions, Buy Box percentage, unit session percentage.
- keyOperationalFindings.volatility: 1-2 short paragraphs framed as a Key Risk Factor, on catalog inconsistency and dependency risk, grounded only in the zero-sales rate and concentration spread (see rule 2 above).
- actionPlan: 3-6 items framed as Optimization Opportunities, "priority" ranked 1 = highest ROI first, forming a 30-day action plan.
  - "title": a short, professional, action-oriented label naming the specific action and (where relevant) the specific ASIN, e.g. "Audit & Restructure B08AAA117", "Improve Buy Box Share", "Rationalize Low-Performing Catalog". Lead with a verb; do not editorialize or dramatize.
  - "category" MUST be exactly one of these four values, picked to match the action's substance, not the wording of its title:
    - "ppc": reallocating ad spend/traffic away from zero-converting ASINs, pausing campaigns on non-converters.
    - "listing": product imagery review, A+ content / enhanced brand content, listing quality or content fixes.
    - "buybox": pricing review, Buy Box win-rate review, competitiveness on price or shipping.
    - "catalog": pruning dead SKUs, catalog cleanup, reviews and trust signals on top performers.
  Only include an item if the verified stats actually support it. Do not list all four categories by default just to cover them.
- strategicSummary: one closing paragraph tying the findings and action plan together and to a business outcome.`

// Claude has no strict json_object response mode like Groq/OpenAI: it's
// prompted into JSON-only output instead, and occasionally still wraps that
// in a ```json fence despite the instruction not to. Strip it defensively.
function extractJsonContent(raw: string): string {
  const trimmed = raw.trim()
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenceMatch ? fenceMatch[1] : trimmed
}

async function callGroq(userMessage: string): Promise<string> {
  const completion = await groq.chat.completions.create({
    model: 'qwen/qwen3.6-27b',
    response_format: { type: 'json_object' },
    // This is a reasoning model: it spends a large, variable number of
    // hidden reasoning tokens before emitting the actual JSON content. The
    // account-audit output (5 narrative sections + an action list) needs far
    // more budget than a short answer; too low a cap truncates the response
    // mid-reasoning and leaves content empty. This account's Groq tier caps
    // requests at 8000 total tokens/minute (prompt + completion combined),
    // so this is set as high as that ceiling allows.
    max_completion_tokens: 6500,
    reasoning_effort: 'none',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage }
    ]
  })
  return completion.choices[0]?.message?.content || '{}'
}

async function callClaude(userMessage: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }]
  })
  const textBlock = message.content.find((block) => block.type === 'text')
  return textBlock ? extractJsonContent(textBlock.text) : '{}'
}

function callProvider(provider: Provider, userMessage: string): Promise<string> {
  return provider === 'claude' ? callClaude(userMessage) : callGroq(userMessage)
}

function collectOutputText(insights: AccountInsights): string {
  return [
    ...(insights.accountSnapshot ?? []),
    insights.keyOperationalFindings?.revenueConcentration,
    insights.keyOperationalFindings?.conversionBottleneck,
    insights.keyOperationalFindings?.volatility,
    ...(insights.actionPlan ?? []).flatMap((item) => [item.title, item.detail]),
    insights.strategicSummary
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n')
}

function computeVerificationWarnings(insights: AccountInsights, allowedTokens: Set<string>): string[] {
  return [
    ...new Set(
      extractStatTokens(collectOutputText(insights)).filter(
        // "100%" is exempted: it's overwhelmingly used as a generic ceiling
        // reference ("not converting 100% of visitors"), not a claimed stat,
        // and flagging it on every run was pure noise.
        (token) => token !== '100%' && !allowedTokens.has(normalizeStatToken(token))
      )
    )
  ]
}

export async function POST(request: Request) {
  // Previously missing entirely: this route was reachable unauthenticated,
  // bypassing the login gate that /audit/page.tsx enforces at the page
  // level. Needs the real user id anyway to check/deduct credits, so this
  // closes that gap as a side effect of wiring credits in.
  const authClient = await createAuthClient()
  const { data: authData } = await authClient.auth.getClaims()
  const userId = authData?.claims?.sub as string | undefined

  if (!userId) {
    return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  }

  try {
    await assertSufficientCredits(userId, CREDIT_COSTS.accountAudit)
  } catch (err: any) {
    if (err instanceof InsufficientCreditsError) {
      return NextResponse.json(
        { error: err.message, creditsRemaining: err.available, creditsRequired: err.required },
        { status: 403 }
      )
    }
    console.error('Credit check failed:', err.message)
    return NextResponse.json({ error: 'Could not verify credit balance. Please try again.' }, { status: 500 })
  }

  const provider: Provider = new URL(request.url).searchParams.get('provider') === 'claude' ? 'claude' : 'groq'

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!isAccountReportStats(body)) {
    return NextResponse.json(
      {
        error:
          'Expected the verified output of computeAccountReportStats (an object with totalActiveAsinCount, revenueConcentration, asinRows, etc.), not raw CSV rows or another shape.'
      },
      { status: 400 }
    )
  }

  const verifiedStatsSummary = buildVerifiedStatsSummary(body)
  const verifiedPercentages = extractVerifiedPercentages(verifiedStatsSummary)
  const allowedTokens = new Set(extractStatTokens(verifiedStatsSummary).map(normalizeStatToken))
  const userMessage = `VERIFIED STATS (the only numbers you may use, copy them exactly as written below):\n\n${verifiedStatsSummary}\n\nWrite the account audit now, following the JSON structure and rules exactly.`

  let raw: string
  try {
    raw = await callProvider(provider, userMessage)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `${provider} request failed: ${message}` }, { status: 502 })
  }

  let insights: AccountInsights
  try {
    insights = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: `${provider} returned invalid JSON`, raw }, { status: 502 })
  }

  let verificationWarnings = computeVerificationWarnings(insights, allowedTokens)

  // The "100 minus a verified percentage" pattern is rule 5's exact forbidden
  // arithmetic: a model output is non-deterministic enough that a second,
  // independent pass often just doesn't repeat the same derivation. Retry
  // once before showing anything, rather than surfacing a warning the user
  // has to notice and act on themselves.
  const hasComplementViolation = verificationWarnings.some((token) => isDerivedFromComplement(token, verifiedPercentages))

  if (hasComplementViolation) {
    try {
      const retryRaw = await callProvider(provider, userMessage)
      const retryInsights: AccountInsights = JSON.parse(retryRaw)
      insights = retryInsights
      verificationWarnings = computeVerificationWarnings(retryInsights, allowedTokens)
    } catch {
      // Retry itself failed (network/parse): fall back to the original,
      // already-flagged result rather than losing the response entirely.
    }
  }

  try {
    await deductCredits(userId, CREDIT_COSTS.accountAudit, 'account_audit')
  } catch (err: any) {
    // Same reasoning as generate-single: the audit already succeeded and
    // shipped to the client: a bookkeeping write failing afterward
    // shouldn't turn that into an error response.
    console.error('Failed to deduct credits:', err.message)
  }

  return NextResponse.json({ provider, insights, verificationWarnings })
}
