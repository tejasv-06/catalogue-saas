import type { ListingHealth } from '@/lib/listingHealth'
import type { MarketplaceReadiness } from '@/lib/marketplaceAdapters'

// Milestone C17 — pure presentation-only translation from the existing
// C10/C15 status vocabulary (ready/needs-review/missing-data/error,
// READY/NOT_READY, critical/high/medium/low) into seller-facing plain
// language. Deliberately NOT a new source of truth: every function here
// takes an already-computed ListingHealth/MarketplaceReadiness/priority
// value and only reformats it — no new judgment about readiness, health,
// or priority is made anywhere in this file. lib/listingHealth.ts and
// lib/marketplaceAdapters.ts remain the only places that decide THESE
// facts; this file only decides how to SAY them.

export type MarketplaceChipTone = 'complete' | 'attention' | 'blocked' | 'not-started'

// Shared by every place a marketplace chip renders (product cards, the
// drawer's quick-switch strip) so the same tone always maps to the same
// color, never redefined per call site.
export const CHIP_TONE_CLASS: Record<MarketplaceChipTone, string> = {
  complete: 'bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]',
  attention: 'bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]',
  blocked: 'bg-[var(--danger-bg)] text-[var(--danger-text)] border-[var(--danger-border)]',
  'not-started': 'bg-[var(--secondary-btn-bg)] text-[var(--secondary-btn-text)] border-[var(--secondary-btn-border)]'
}

export type MarketplaceChip = {
  tone: MarketplaceChipTone
  label: string
}

// One glanceable word/phrase per marketplace chip — never the raw
// 'ready'/'needs-review'/'missing-data'/'error' vocabulary itself.
export function marketplaceChipFor(attempted: boolean, health: ListingHealth | null): MarketplaceChip {
  if (!attempted || !health) return { tone: 'not-started', label: 'Not started' }
  switch (health.status) {
    case 'ready':
      return { tone: 'complete', label: 'Complete' }
    case 'needs-review':
      return { tone: 'attention', label: 'Needs a look' }
    case 'missing-data': {
      const missing = health.checks.find((c) => c.label === 'Required fields' && !c.passed)
      const count = missing?.detail?.startsWith('Missing: ') ? missing.detail.replace('Missing: ', '').split(', ').length : null
      return { tone: 'blocked', label: count ? `${count} detail${count === 1 ? '' : 's'} needed` : 'Details needed' }
    }
    case 'error':
      return { tone: 'blocked', label: "Couldn't generate" }
  }
}

// A single human sentence explaining what's still missing for one
// marketplace's content — built from the SAME health checks the badge
// already reflects, never a second judgment.
export function explainMissing(marketplaceLabel: string, health: ListingHealth): string | null {
  if (health.status === 'ready') return null
  if (health.status === 'error') return `Tesolute couldn't generate the ${marketplaceLabel} version yet — worth trying again.`
  const failing = health.checks.filter((c) => c.applicable && !c.passed)
  if (failing.length === 0) return null
  const names = failing.map((c) => c.label.toLowerCase())
  return `${marketplaceLabel} needs ${names.join(', ')} before it's complete.`
}

// Same READY/NOT_READY vocabulary from lib/marketplaceAdapters.ts's own
// MarketplaceReadiness, translated to a short seller-facing line — used in
// the Product Studio drawer's per-marketplace summary.
export function readinessSentence(marketplaceLabel: string, readiness: MarketplaceReadiness): string {
  if (readiness.status === 'READY') return `Your ${marketplaceLabel} content is complete.`
  const firstIssue = readiness.issues[0]
  return firstIssue ? `${marketplaceLabel}: ${firstIssue.message}` : `${marketplaceLabel} content isn't complete yet.`
}

export const PRIORITY_ATTENTION_WORDS: Record<'critical' | 'high' | 'medium' | 'low', string> = {
  critical: 'needs attention now',
  high: 'is worth doing next',
  medium: 'could use a look',
  low: 'is a nice-to-have'
}
