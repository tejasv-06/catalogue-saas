"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  ArrowDown,
  ChevronDown,
  ChevronUp,
  type LucideIcon
} from 'lucide-react'
import { getMarketplacePerformanceHistory, getBrandScopesForMarketplace, type PerformanceHistoryRecord, type BrandScope } from '@/lib/performance'
import { PERFORMANCE_MARKETPLACES, PERFORMANCE_MARKETPLACE_LABELS, type PerformanceMarketplace } from '@/lib/performanceAdapters'
import {
  groupByPeriod,
  aggregatePeriod,
  diagnosePeriodRelative,
  compareAggregates,
  buildProductInsights,
  topOpportunityProducts,
  allProductsRanked,
  buildCatalogOpportunityMap,
  buildSegmentInsights,
  type PeriodGroup,
  type AggregateSnapshot,
  type ProductInsight,
  type IntelligenceBucket
} from '@/lib/performanceIntelligence'
import {
  describeSituation,
  describeFunnelStory,
  describeFunnelStages,
  describeWhatChanged,
  describeMultiPeriodStory,
  describePersistentProblems,
  buildAttentionItems,
  buildTopActions,
  describeWhyPrioritized,
  describeSegmentInsights,
  generateActionPlan,
  describeMeasurementPlan,
  buildActionReportText,
  type SituationSummary,
  type Severity
} from '@/lib/performanceNarrative'
import PerformanceImportPanel from './PerformanceImportPanel'
import { buttonPrimaryClass, buttonSecondaryClass, buttonSecondarySmallClass, cardClass, sectionHeadingClass, labelClass, bodyTextClass } from '@/lib/uiClasses'
import type { PerformanceStatsInput, VerifiedProductSummary } from '@/lib/performanceStatsInput'
import type { PerformanceAIInsights } from '@/lib/performanceAIInsights'

// Milestone C15 — Seller Performance Intelligence & Action Engine. This is
// the presentation layer ONLY. Data -> lib/performanceIntelligence.ts
// (KPI/diagnosis/prioritization) -> lib/performanceNarrative.ts (business
// storytelling/action plan/report) -> this file. No calculation and no
// diagnosis happens here. Professional, restrained visual language:
// Lucide icons (never emoji/colored circles), the existing Tesolute
// design system's cards/typography/spacing, severity communicated via a
// small icon + text color, not decorative badges.

type MarketplaceHistoryState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error' }
  | { status: 'loaded'; history: PerformanceHistoryRecord[]; periods: PeriodGroup[] }

const SEVERITY_META: Record<Severity, { icon: LucideIcon; textClass: string }> = {
  critical: { icon: AlertCircle, textClass: 'text-[var(--danger-text)]' },
  warning: { icon: AlertTriangle, textClass: 'text-[var(--warn-text)]' },
  positive: { icon: CheckCircle2, textClass: 'text-[var(--success-text)]' },
  info: { icon: Info, textClass: 'text-[var(--muted-text)]' }
}

function SeverityIcon({ severity, size = 16 }: { severity: Severity; size?: number }) {
  const { icon: Icon, textClass } = SEVERITY_META[severity]
  return <Icon size={size} className={`shrink-0 ${textClass}`} />
}

// P1/P2/P3 — computed, catalog-relative signals (lib/performanceIntelligence.ts's
// classifyIntelligenceBucket), never a fixed threshold: P1 = clicks/carts
// exist but zero purchases; P2 = meaningful impressions with near-zero CTR
// relative to THIS catalog's own median; P3 = purchases exist but low
// traffic relative to this catalog (under-exposed converter).
const BUCKET_META: Record<Exclude<IntelligenceBucket, null>, { label: string; title: string }> = {
  P1: { label: 'P1', title: 'Clicks or cart activity exist, but zero purchases this period.' },
  P2: { label: 'P2', title: "Meaningful impressions, but click-through rate is near zero relative to this catalog's own median." },
  P3: { label: 'P3', title: 'Purchases exist, but traffic is low relative to this catalog — an under-exposed converter.' }
}

function BucketBadge({ bucket }: { bucket: IntelligenceBucket }) {
  if (!bucket) return <span className="text-[var(--muted-text)]">—</span>
  const meta = BUCKET_META[bucket]
  return (
    <span
      title={meta.title}
      className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-[var(--input-bg)] border border-[var(--card-border)] text-[var(--heading-text)]"
    >
      {meta.label}
    </span>
  )
}

function fmtNum(value: number | null): string {
  if (value === null) return '—'
  return value.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

function fmtPct(value: number | null, decimals = 2): string {
  if (value === null) return '—'
  return `${value.toFixed(decimals)}%`
}

function formatPeriodLabel(periodStart: string, periodEnd: string): string {
  const start = new Date(periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const end = new Date(periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${start} – ${end}`
}

// Distills a ProductInsight down to the pre-formatted, already-verified
// fields the AI-insights API is allowed to see — never the raw
// current/previous PerformanceHistoryRecord rows it also carries.
function toVerifiedProductSummary(p: ProductInsight): VerifiedProductSummary {
  return {
    externalProductId: p.externalProductId,
    bucket: p.bucket,
    evidence: p.evidence,
    topProblemArea: p.topProblem?.area ?? null,
    topProblemMessage: p.topProblem?.message ?? null,
    recommendedAction: p.recommendedAction
  }
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function PerformanceIntelligencePanel() {
  const [brandScopes, setBrandScopes] = useState<Partial<Record<PerformanceMarketplace, BrandScope[]>>>({})
  const [scopesLoaded, setScopesLoaded] = useState(false)
  const [selectedMarketplace, setSelectedMarketplace] = useState<PerformanceMarketplace | null>(null)
  // undefined = not yet chosen; null = the "unspecified" (legacy,
  // pre-brand-scoping) scope; a string = one named brand.
  const [selectedBrand, setSelectedBrand] = useState<string | null | undefined>(undefined)
  const [historyState, setHistoryState] = useState<MarketplaceHistoryState>({ status: 'loading' })
  const [showUpload, setShowUpload] = useState(false)
  // Lets a seller dismiss the dashboard and return to a blank upload view
  // without touching any data — historical performance rows are
  // deliberately append-only (never deleted), so "closing" a report can
  // only ever be a view-state toggle, not data removal. Session-only by
  // design (no localStorage) — consistent with every other piece of UI
  // state in this file; refreshing intentionally shows the dashboard
  // again since the underlying report data still genuinely exists.
  const [dismissed, setDismissed] = useState(false)

  // Step 1: discover which (marketplace, brand) scopes actually have
  // data — cheap (one query per marketplace, brand column only), so this
  // always runs up front regardless of catalog size. Actual report
  // history is fetched lazily, only for the one scope currently selected
  // (see the effect below) — never every brand's full dataset at once.
  const loadScopes = useCallback(async () => {
    const results = await Promise.all(
      PERFORMANCE_MARKETPLACES.map(async (m) => {
        try {
          const scopes = await getBrandScopesForMarketplace(m)
          return [m, scopes] as const
        } catch (err: any) {
          console.error(`PerformanceIntelligencePanel: failed to load brand scopes for ${m}:`, err?.message ?? err)
          return [m, [] as BrandScope[]] as const
        }
      })
    )
    const resolved: Partial<Record<PerformanceMarketplace, BrandScope[]>> = {}
    for (const [m, scopes] of results) resolved[m] = scopes
    setBrandScopes(resolved)
    setScopesLoaded(true)
    return resolved
  }, [])

  useEffect(() => {
    void loadScopes()
  }, [loadScopes])

  // Default to the first (marketplace, brand) scope with real data, but
  // never override a selection the seller already made that's still valid.
  useEffect(() => {
    if (!scopesLoaded) return
    const available = PERFORMANCE_MARKETPLACES.filter((m) => (brandScopes[m]?.length ?? 0) > 0)
    setSelectedMarketplace((prev) => (prev && (brandScopes[prev]?.length ?? 0) > 0 ? prev : (available[0] ?? null)))
  }, [scopesLoaded, brandScopes])

  useEffect(() => {
    if (!selectedMarketplace) return
    const scopes = brandScopes[selectedMarketplace] ?? []
    setSelectedBrand((prev) => (prev !== undefined && scopes.some((s) => s.brand === prev) ? prev : (scopes[0]?.brand ?? undefined)))
  }, [selectedMarketplace, brandScopes])

  useEffect(() => {
    if (!selectedMarketplace || selectedBrand === undefined) return
    let cancelled = false
    setHistoryState({ status: 'loading' })
    getMarketplacePerformanceHistory(selectedMarketplace, selectedBrand)
      .then((history) => {
        if (cancelled) return
        setHistoryState(history.length === 0 ? { status: 'empty' } : { status: 'loaded', history, periods: groupByPeriod(history) })
      })
      .catch((err: any) => {
        if (cancelled) return
        console.error(`PerformanceIntelligencePanel: failed to load history for ${selectedMarketplace}:`, err?.message ?? err)
        setHistoryState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [selectedMarketplace, selectedBrand])

  // brands is every distinct brand the just-completed import actually
  // wrote (derived from the report's own Brand column, not user input) —
  // a single upload can now legitimately span more than one brand.
  async function handleImported(marketplace: PerformanceMarketplace, brands: (string | null)[]) {
    setShowUpload(false)
    setDismissed(false)
    const resolved = await loadScopes()
    // Jump straight to the (marketplace, brand) scope that was just
    // imported — the seller shouldn't have to hunt for what they
    // uploaded. When the import split across multiple brands, land on
    // the first one; the new brand tabs make the rest one click away.
    if ((resolved[marketplace]?.length ?? 0) > 0) {
      setSelectedMarketplace(marketplace)
      setSelectedBrand(brands[0] ?? null)
    }
  }

  const availableMarketplaces = PERFORMANCE_MARKETPLACES.filter((m) => (brandScopes[m]?.length ?? 0) > 0)
  const anyDataAnywhere = availableMarketplaces.length > 0
  const currentScopes = selectedMarketplace ? (brandScopes[selectedMarketplace] ?? []) : []

  if (!scopesLoaded) {
    return (
      <div className={`p-6 flex flex-col gap-2 ${cardClass}`} aria-busy="true" aria-label="Loading performance intelligence">
        <div className="h-6 w-48 rounded bg-[var(--skeleton-bg)] animate-pulse" />
        <div className="h-24 rounded bg-[var(--skeleton-bg)] animate-pulse" />
      </div>
    )
  }

  if (!anyDataAnywhere) {
    return <PerformanceImportPanel onImported={handleImported} />
  }

  if (dismissed) {
    return <PerformanceImportPanel onImported={handleImported} />
  }

  const selectedScopeLabel = currentScopes.find((s) => s.brand === selectedBrand)?.label ?? null

  return (
    <div className="flex flex-col gap-4">
      {availableMarketplaces.length > 1 && (
        <div className="flex gap-1.5">
          {availableMarketplaces.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setSelectedMarketplace(m)}
              className={selectedMarketplace === m ? buttonPrimaryClass : buttonSecondaryClass}
            >
              {PERFORMANCE_MARKETPLACE_LABELS[m]}
            </button>
          ))}
        </div>
      )}

      {/* Brand selector — only shown when this marketplace has more than
          one scope with real data, so it's always unambiguous which
          brand's data is being viewed, without extra clutter for sellers
          managing just one brand. */}
      {currentScopes.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {currentScopes.map((s) => (
            <button
              key={s.brand ?? '__unspecified__'}
              type="button"
              onClick={() => setSelectedBrand(s.brand)}
              className={selectedBrand === s.brand ? buttonPrimaryClass : buttonSecondaryClass}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {historyState.status === 'loading' && (
        <div className={`p-6 flex flex-col gap-2 ${cardClass}`} aria-busy="true" aria-label="Loading performance intelligence">
          <div className="h-6 w-48 rounded bg-[var(--skeleton-bg)] animate-pulse" />
          <div className="h-24 rounded bg-[var(--skeleton-bg)] animate-pulse" />
        </div>
      )}

      {historyState.status === 'error' && (
        <div className={`p-6 ${cardClass}`}>
          <p className={bodyTextClass}>Something went wrong loading this report. Try refreshing the page.</p>
        </div>
      )}

      {historyState.status === 'loaded' && selectedMarketplace && (
        <MarketplaceDashboard
          marketplace={selectedMarketplace}
          brandLabel={currentScopes.length > 1 ? selectedScopeLabel : null}
          periods={historyState.periods}
          showUpload={showUpload}
          onToggleUpload={() => setShowUpload((v) => !v)}
          onImported={handleImported}
          onClose={() => setDismissed(true)}
        />
      )}
    </div>
  )
}

function MarketplaceDashboard({
  marketplace,
  brandLabel,
  periods,
  showUpload,
  onToggleUpload,
  onImported,
  onClose
}: {
  marketplace: PerformanceMarketplace
  brandLabel: string | null
  periods: PeriodGroup[]
  showUpload: boolean
  onToggleUpload: () => void
  onImported: (marketplace: PerformanceMarketplace, brands: (string | null)[]) => void
  onClose: () => void
}) {
  const currentPeriod = periods[0]
  const previousPeriod = periods[1] ?? null
  const currentAggregate = useMemo(() => aggregatePeriod(currentPeriod), [currentPeriod])
  const previousAggregate = useMemo(() => (previousPeriod ? aggregatePeriod(previousPeriod) : null), [previousPeriod])
  const accountDiagnoses = useMemo(() => diagnosePeriodRelative(currentPeriod.records), [currentPeriod])
  const trend = useMemo(() => compareAggregates(currentAggregate, previousAggregate, marketplace), [currentAggregate, previousAggregate, marketplace])
  const multiPeriodStory = useMemo(() => describeMultiPeriodStory(periods), [periods])
  const diagnosesByPeriod = useMemo(() => periods.map((p) => diagnosePeriodRelative(p.records)), [periods])
  const persistentProblems = useMemo(() => describePersistentProblems(diagnosesByPeriod), [diagnosesByPeriod])

  const allHistory = useMemo(() => periods.flatMap((p) => p.records), [periods])
  const productInsights = useMemo(() => buildProductInsights(allHistory), [allHistory])

  const fixNowAll = productInsights.filter((p) => p.priority === 'fix-now')
  const optimizeAll = productInsights.filter((p) => p.priority === 'optimize')
  const scale = productInsights.filter((p) => p.priority === 'scale')
  const dontPrioritize = productInsights.filter((p) => p.priority === 'low-priority')

  const fixNowTop = topOpportunityProducts(productInsights, 'fix-now', 8)
  const cohortMap = useMemo(() => buildCatalogOpportunityMap(productInsights), [productInsights])

  const segmentNarratives = useMemo(() => {
    const currentRecords = currentPeriod.records
    const articleType = buildSegmentInsights(currentRecords, currentAggregate, 'articleType')
    const brand = buildSegmentInsights(currentRecords, currentAggregate, 'brand')
    const gender = buildSegmentInsights(currentRecords, currentAggregate, 'gender')
    return describeSegmentInsights([...articleType, ...brand, ...gender])
  }, [currentPeriod, currentAggregate])

  const topActions = buildTopActions(fixNowAll, optimizeAll, scale)
  const actionPlan = generateActionPlan(productInsights)
  const situation = describeSituation(currentAggregate, accountDiagnoses)
  const funnel = describeFunnelStory(accountDiagnoses)
  const funnelStages = describeFunnelStages(currentAggregate)
  const measurementPlan = describeMeasurementPlan(topActions)

  function handleDownload() {
    const text = buildActionReportText({
      marketplaceLabel: PERFORMANCE_MARKETPLACE_LABELS[marketplace],
      current: currentAggregate,
      previous: previousAggregate,
      periodsAvailable: periods.length,
      accountDiagnoses,
      trend,
      productInsights,
      actionPlan,
      multiPeriodStory,
      segmentNarratives
    })
    downloadTextFile(`tesolute-${marketplace}-performance-intelligence-${currentAggregate.periodEnd}.txt`, text)
  }

  // "Generate AI Insights" — a separate, explicit step from the dashboard
  // above (which is already fully rendered from computed statistics, no
  // AI call). Sends only this distilled, already-verified summary — never
  // the raw per-product history rows.
  const [aiInsights, setAiInsights] = useState<PerformanceAIInsights | null>(null)
  const [aiWarnings, setAiWarnings] = useState<string[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  async function handleGenerateAiInsights() {
    setAiLoading(true)
    setAiError(null)
    try {
      const payload: PerformanceStatsInput = {
        marketplaceLabel: PERFORMANCE_MARKETPLACE_LABELS[marketplace],
        periodStart: currentAggregate.periodStart,
        periodEnd: currentAggregate.periodEnd,
        periodsAvailable: periods.length,
        productsAnalyzed: currentAggregate.productsAnalyzed,
        impressions: currentAggregate.impressions,
        clicks: currentAggregate.clicks,
        ctr: currentAggregate.ctr,
        addToCarts: currentAggregate.addToCarts,
        atcRate: currentAggregate.atcRate,
        purchases: currentAggregate.purchases,
        conversionRate: currentAggregate.conversionRate,
        returnRate: currentAggregate.returnRate,
        rating: currentAggregate.rating,
        productsWithSales: currentAggregate.productsWithSales,
        productsWithNoSales: currentAggregate.productsWithNoSales,
        previous: previousAggregate
          ? {
              impressions: previousAggregate.impressions,
              clicks: previousAggregate.clicks,
              ctr: previousAggregate.ctr,
              addToCarts: previousAggregate.addToCarts,
              purchases: previousAggregate.purchases
            }
          : null,
        problemAreas: accountDiagnoses.map((d) => ({ area: d.area, affectedProductCount: d.affectedProductCount, message: d.message })),
        cohortMap: cohortMap.map((row) => ({ label: row.label, count: row.count, description: row.description })),
        fixNowTop: fixNowTop.map(toVerifiedProductSummary),
        scaleTop: scale.slice(0, 5).map(toVerifiedProductSummary)
      }

      const res = await fetch('/api/generate-performance-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (!res.ok) {
        setAiError(data?.error ?? 'Failed to generate AI insights.')
        return
      }
      setAiInsights(data.insights as PerformanceAIInsights)
      setAiWarnings((data.verificationWarnings ?? []) as string[])
    } catch (err: any) {
      setAiError(err?.message ?? 'Failed to generate AI insights.')
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* A. Report header */}
      <div className={`p-6 flex flex-wrap items-center justify-between gap-3 ${cardClass}`}>
        <div>
          <h2 className={sectionHeadingClass}>
            {PERFORMANCE_MARKETPLACE_LABELS[marketplace]} Performance Intelligence
            {brandLabel && <span className="text-[var(--muted-text)] font-normal"> — {brandLabel}</span>}
          </h2>
          <p className="text-xs text-[var(--muted-text)] mt-0.5">
            Reporting period: {formatPeriodLabel(currentAggregate.periodStart, currentAggregate.periodEnd)} · Reports analyzed: {periods.length}
          </p>
          {periods.length === 1 && (
            <p className="text-xs text-[var(--muted-text)] mt-0.5">This is your first performance snapshot. Historical comparison is not yet available.</p>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onToggleUpload} className={buttonSecondaryClass}>
            {showUpload ? 'Hide Upload' : 'Upload Another Report'}
          </button>
          <button type="button" onClick={handleGenerateAiInsights} disabled={aiLoading} className={buttonSecondaryClass}>
            {aiLoading ? 'Generating…' : 'Generate AI Insights'}
          </button>
          <button type="button" onClick={handleDownload} className={buttonPrimaryClass}>
            Download Action Report
          </button>
          <button type="button" onClick={onClose} className={buttonSecondaryClass} title="Hide this dashboard. Your imported reports are kept — this only changes what's shown right now.">
            Close
          </button>
        </div>
      </div>

      {showUpload && <PerformanceImportPanel onImported={onImported} />}

      {/* Generate AI Insights — a separate, explicit step. The dashboard
          below is already fully rendered from computed statistics with no
          AI call; this section only ever appears once the seller asks for
          it, and only ever shows verified-stats-grounded narrative on top
          of what's already been computed. */}
      {aiError && (
        <div className={`p-6 ${cardClass}`}>
          <p className="text-sm text-[var(--danger-text)]">{aiError}</p>
        </div>
      )}
      {aiInsights && <PerformanceAiInsightsSection insights={aiInsights} warnings={aiWarnings} />}

      {/* B. Executive status */}
      <ExecutiveStatus situation={situation} />

      {/* C. KPI summary */}
      <KpiSummary current={currentAggregate} previous={previousAggregate} trend={trend} />

      {/* D. Performance funnel */}
      <FunnelSection current={currentAggregate} funnel={funnel} />

      {/* E. What this means */}
      <WhatThisMeans stages={funnelStages} implication={situation.implication} />

      {/* F. Where are you losing shoppers */}
      <WhereShoppersLost accountDiagnoses={accountDiagnoses} current={currentAggregate} />

      {/* G. Catalog opportunity map */}
      <CatalogOpportunityMap rows={cohortMap} segmentNarratives={segmentNarratives} />

      {/* H. Top 3 actions */}
      {topActions.length > 0 && <TopActionsSection actions={topActions} />}

      {/* I. Products to work on first */}
      <ProductsToWorkOnFirst top={fixNowTop} allFixNowCount={fixNowAll.length} allInsights={productInsights} />

      {/* J. Positive performers */}
      <PositivePerformers scale={scale} />

      {/* K. Do not prioritize */}
      <DontPrioritize count={dontPrioritize.length} />

      {/* L. Historical intelligence */}
      {periods.length > 1 && (
        <HistoricalIntelligence
          current={currentAggregate}
          previous={previousAggregate}
          trend={trend}
          multiPeriodStory={multiPeriodStory}
          persistentProblems={persistentProblems}
        />
      )}

      {/* M/N. 15/30-day plans */}
      <ActionPlanSection title="Next 15 Days" phases={actionPlan.fifteenDay} />
      <ActionPlanSection title="Next 30 Days" phases={actionPlan.thirtyDay} />

      {/* O. What to measure next */}
      <div className={`p-6 flex flex-col gap-2 ${cardClass}`}>
        <p className={sectionHeadingClass}>What to Measure Next</p>
        <ul className="flex flex-col gap-1">
          {measurementPlan.map((line, i) => (
            <li key={i} className={bodyTextClass}>
              {line}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const PERFORMANCE_ACTION_AREA_LABELS: Record<string, string> = {
  'click-through': 'Click-Through',
  'product-page-engagement': 'Product-Page Engagement',
  'purchase-conversion': 'Purchase Conversion',
  returns: 'Returns',
  rating: 'Rating',
  'stock-recovery': 'Ranking Recovery'
}

function PerformanceAiInsightsSection({ insights, warnings }: { insights: PerformanceAIInsights; warnings: string[] }) {
  return (
    <div className={`p-6 flex flex-col gap-4 ${cardClass}`}>
      <div>
        <p className={sectionHeadingClass}>AI Insights</p>
        <p className="text-xs text-[var(--muted-text)]">
          Written from the verified statistics above — Tesolute&rsquo;s AI does not see raw report rows or perform its own calculations.
        </p>
      </div>

      {warnings.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-[var(--warn-text)]">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <p>
            {warnings.length} number{warnings.length === 1 ? '' : 's'} in this response could not be verified against the computed statistics:{' '}
            {warnings.join(', ')}. Treat these specific figures with caution.
          </p>
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {insights.summary.map((line, i) => (
          <li key={i} className={bodyTextClass}>
            {line}
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[var(--card-border)]">
        <div>
          <p className={labelClass}>Biggest Opportunity</p>
          <p className={`mt-1 ${bodyTextClass}`}>{insights.keyFindings.biggestOpportunity}</p>
        </div>
        <div>
          <p className={labelClass}>Catalog Health</p>
          <p className={`mt-1 ${bodyTextClass}`}>{insights.keyFindings.catalogHealth}</p>
        </div>
        <div>
          <p className={labelClass}>Trend Signal</p>
          <p className={`mt-1 ${bodyTextClass}`}>{insights.keyFindings.trendSignal}</p>
        </div>
      </div>

      {insights.actionPlan.length > 0 && (
        <div className="pt-2 border-t border-[var(--card-border)] flex flex-col gap-3">
          <p className={labelClass}>Action Plan</p>
          {insights.actionPlan
            .slice()
            .sort((a, b) => a.priority - b.priority)
            .map((item, i) => (
              <div key={i}>
                <p className="text-sm font-medium text-[var(--heading-text)]">
                  {item.priority}. {item.title}{' '}
                  <span className="text-xs text-[var(--muted-text)] font-normal">({PERFORMANCE_ACTION_AREA_LABELS[item.area] ?? item.area})</span>
                </p>
                <p className={`mt-0.5 ${bodyTextClass}`}>{item.detail}</p>
              </div>
            ))}
        </div>
      )}

      <p className={`pt-2 border-t border-[var(--card-border)] ${bodyTextClass}`}>{insights.strategicSummary}</p>
    </div>
  )
}

function ExecutiveStatus({ situation }: { situation: SituationSummary }) {
  return (
    <div className={`p-6 flex flex-col gap-3 ${cardClass}`}>
      <p className={labelClass}>Current Performance</p>
      <div className="flex items-start gap-2">
        <SeverityIcon severity={situation.severity} size={20} />
        <p className="text-lg font-semibold text-[var(--heading-text)]">{situation.headline}</p>
      </div>
      <p className="text-sm text-[var(--body-text)] font-mono">{situation.funnelLine}</p>
      <div>
        <p className={labelClass}>Primary Opportunity</p>
        <p className="text-sm font-medium text-[var(--heading-text)] mt-0.5">{situation.primaryOpportunity}</p>
        <p className={`mt-1 ${bodyTextClass}`}>{situation.explanation}</p>
      </div>
    </div>
  )
}

function KpiCard({ label, value, changeLabel, changeDirection }: { label: string; value: string; changeLabel?: string | null; changeDirection?: 'up' | 'down' | 'flat' }) {
  return (
    <div className="px-3 py-2">
      <p className="text-xs text-[var(--muted-text)]">{label}</p>
      <p className="text-lg font-semibold text-[var(--heading-text)]">{value}</p>
      {changeLabel && (
        <p
          className={`text-xs ${
            changeDirection === 'up' ? 'text-[var(--success-text)]' : changeDirection === 'down' ? 'text-[var(--danger-text)]' : 'text-[var(--muted-text)]'
          }`}
        >
          {changeLabel}
        </p>
      )}
    </div>
  )
}

function KpiSummary({ current, previous, trend }: { current: AggregateSnapshot; previous: AggregateSnapshot | null; trend: ReturnType<typeof compareAggregates> }) {
  const changed = previous && trend ? describeWhatChanged(current, previous, trend) : null
  const byLabel = new Map(changed?.map((c) => [c.label, c]) ?? [])

  function dir(label: string): 'up' | 'down' | 'flat' | undefined {
    const c = byLabel.get(label)
    if (!c || !c.changeLabel) return undefined
    return c.changeLabel.startsWith('+') ? 'up' : c.changeLabel.startsWith('-') ? 'down' : 'flat'
  }

  return (
    <div className={`p-6 flex flex-col gap-3 ${cardClass}`}>
      <p className={sectionHeadingClass}>KPI Summary</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-[var(--card-border)] border border-[var(--card-border)] rounded-xl overflow-hidden">
        <KpiCard label="Products Reported" value={fmtNum(current.productsAnalyzed)} />
        <KpiCard label="Impressions" value={fmtNum(current.impressions)} changeLabel={byLabel.get('Impressions')?.changeLabel} changeDirection={dir('Impressions')} />
        <KpiCard label="Clicks" value={fmtNum(current.clicks)} changeLabel={byLabel.get('Clicks')?.changeLabel} changeDirection={dir('Clicks')} />
        <KpiCard label="CTR" value={fmtPct(current.ctr)} changeLabel={byLabel.get('CTR')?.changeLabel} changeDirection={dir('CTR')} />
        <KpiCard label="Add to Carts" value={fmtNum(current.addToCarts)} changeLabel={byLabel.get('Add to Carts')?.changeLabel} changeDirection={dir('Add to Carts')} />
        <KpiCard label="Cart Rate" value={fmtPct(current.atcRate)} />
        <KpiCard label="Purchases" value={fmtNum(current.purchases)} changeLabel={byLabel.get('Purchases')?.changeLabel} changeDirection={dir('Purchases')} />
        <KpiCard label="Purchase Conversion" value={fmtPct(current.conversionRate)} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs text-[var(--muted-text)] pt-2 border-t border-[var(--card-border)]">
        <span>Products with sales: {fmtNum(current.productsWithSales)}</span>
        <span>Products with no sales: {fmtNum(current.productsWithNoSales)}</span>
        <span>Return rate: {fmtPct(current.returnRate)}</span>
        <span>Average rating: {current.rating !== null ? current.rating.toFixed(1) : '—'}</span>
        <span>Consideration rate: {fmtPct(current.considerationRate)}</span>
      </div>
      {changed && (
        <p className={`pt-2 border-t border-[var(--card-border)] ${bodyTextClass}`}>
          {changed.filter((c) => !/stayed about the same/.test(c.explanation)).map((c) => c.explanation).join(' ')}
        </p>
      )}
    </div>
  )
}

function FunnelSection({ current, funnel }: { current: AggregateSnapshot; funnel: ReturnType<typeof describeFunnelStory> }) {
  return (
    <div className={`p-6 flex flex-col gap-3 ${cardClass}`}>
      <p className={sectionHeadingClass}>Performance Funnel</p>
      <div className="flex items-start gap-2">
        <SeverityIcon severity={funnel.severity} />
        <p className="text-sm font-medium text-[var(--heading-text)]">{funnel.gapLine}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <FunnelStage label="Impressions" value={fmtNum(current.impressions)} />
        <ArrowDown size={14} className="text-[var(--muted-text)]" />
        <FunnelStage label="Clicks" value={fmtNum(current.clicks)} rate={fmtPct(current.ctr)} />
        <ArrowDown size={14} className="text-[var(--muted-text)]" />
        <FunnelStage label="Add to Carts" value={fmtNum(current.addToCarts)} rate={fmtPct(current.atcRate)} />
        <ArrowDown size={14} className="text-[var(--muted-text)]" />
        <FunnelStage label="Purchases" value={fmtNum(current.purchases)} rate={fmtPct(current.conversionRate)} />
      </div>
      <p className={bodyTextClass}>{funnel.explanation}</p>
    </div>
  )
}

function FunnelStage({ label, value, rate }: { label: string; value: string; rate?: string }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--card-border)] text-center">
      <p className="text-xs text-[var(--muted-text)]">{label}</p>
      <p className="text-[var(--heading-text)] font-semibold">{value}</p>
      {rate && <p className="text-xs text-[var(--muted-text)]">{rate}</p>}
    </div>
  )
}

function WhatThisMeans({ stages, implication }: { stages: ReturnType<typeof describeFunnelStages>; implication: string }) {
  return (
    <div className={`p-6 flex flex-col gap-3 ${cardClass}`}>
      <p className={sectionHeadingClass}>What This Means</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {stages.map((s) => (
          <div key={s.stage}>
            <p className="text-sm font-medium text-[var(--heading-text)]">{s.stage}</p>
            <p className="text-xs text-[var(--muted-text)]">{s.explanation}</p>
          </div>
        ))}
      </div>
      <div className="pt-2 border-t border-[var(--card-border)]">
        <p className={labelClass}>Overall assessment</p>
        <p className={`mt-1 ${bodyTextClass}`}>{implication}</p>
      </div>
    </div>
  )
}

function WhereShoppersLost({ accountDiagnoses, current }: { accountDiagnoses: ReturnType<typeof diagnosePeriodRelative>; current: AggregateSnapshot }) {
  const items = buildAttentionItems(accountDiagnoses, current)
  if (items.length === 0) return null
  return (
    <div className={`p-6 flex flex-col gap-4 ${cardClass}`}>
      <p className={sectionHeadingClass}>Where Are You Losing Shoppers?</p>
      {items.map((item) => (
        <div key={item.title} className="pb-3 border-b border-[var(--card-border)] last:border-b-0 last:pb-0">
          <div className="flex items-start gap-2">
            <SeverityIcon severity={item.severity} />
            <p className="font-medium text-[var(--heading-text)]">
              {item.rank}. {item.title} <span className="text-xs text-[var(--muted-text)]">(Priority: {item.priority})</span>
            </p>
          </div>
          <p className="text-sm text-[var(--body-text)] mt-1 ml-6">{item.headline}</p>
          <p className="text-xs text-[var(--muted-text)] mt-1 ml-6">
            <span className="font-medium">Investigate:</span> {item.investigate.join(', ')}. Tesolute does not have enough evidence in this report to
            identify the exact cause — these are the first factors to check.
          </p>
        </div>
      ))}
    </div>
  )
}

function CatalogOpportunityMap({
  rows,
  segmentNarratives
}: {
  rows: ReturnType<typeof buildCatalogOpportunityMap>
  segmentNarratives: ReturnType<typeof describeSegmentInsights>
}) {
  return (
    <div className={`p-6 flex flex-col gap-3 ${cardClass}`}>
      <p className={sectionHeadingClass}>Catalog Opportunity Map</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b border-[var(--card-border)]">
              <th className="py-1.5 pr-3 font-medium text-[var(--muted-text)]">Opportunity Group</th>
              <th className="py-1.5 pr-3 font-medium text-[var(--muted-text)] text-right">Products</th>
              <th className="py-1.5 pr-3 font-medium text-[var(--muted-text)]">What It Means</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.cohort} className="border-b border-[var(--card-border)] last:border-b-0">
                <td className="py-2 pr-3 text-[var(--heading-text)] font-medium whitespace-nowrap">{row.label}</td>
                <td className="py-2 pr-3 text-right text-[var(--body-text)]">{fmtNum(row.count)}</td>
                <td className="py-2 pr-3 text-[var(--muted-text)]">{row.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {segmentNarratives.length > 0 && (
        <div className="pt-2 border-t border-[var(--card-border)] flex flex-col gap-1">
          {segmentNarratives.map((s) => (
            <p key={s.dimension} className="text-xs text-[var(--muted-text)]">
              {s.sentence}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function TopActionsSection({ actions }: { actions: ReturnType<typeof buildTopActions> }) {
  return (
    <div className={`p-6 flex flex-col gap-4 ${cardClass}`}>
      <p className={sectionHeadingClass}>Top 3 Actions</p>
      {actions.map((a) => (
        <div key={a.title} className="pb-4 border-b border-[var(--card-border)] last:border-b-0 last:pb-0">
          <div className="flex items-start gap-2">
            <SeverityIcon severity={a.severity} />
            <p className="font-medium text-[var(--heading-text)]">
              {a.rank} — {a.title}
            </p>
          </div>
          <p className="text-xs text-[var(--muted-text)] ml-6">
            {a.affectedProductCount} products · Priority: {a.priority}
          </p>
          <p className="text-sm text-[var(--body-text)] mt-1 ml-6">
            <span className="font-medium">Why:</span> {a.why}
          </p>
          {a.productIds.length > 0 && (
            <p className="text-xs text-[var(--muted-text)] mt-1 ml-6">
              <span className="font-medium">See:</span> {a.productIds.join(', ')}{' '}
              <span className="italic">(full evidence in &ldquo;Products to Work On First,&rdquo; below)</span>.
            </p>
          )}
          {a.investigate.length > 0 && (
            <p className="text-xs text-[var(--muted-text)] mt-1 ml-6">
              <span className="font-medium">Investigate:</span> {a.investigate.join(', ')}.
            </p>
          )}
          <p className="text-xs text-[var(--muted-text)] mt-1 ml-6">
            <span className="font-medium">Measure next:</span> {a.measureNext}
          </p>
        </div>
      ))}
    </div>
  )
}

const PAGE_SIZE = 25

function ProductsToWorkOnFirst({ top, allFixNowCount, allInsights }: { top: ProductInsight[]; allFixNowCount: number; allInsights: ProductInsight[] }) {
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(0)
  const ranked = useMemo(() => (expanded ? allProductsRanked(allInsights) : []), [expanded, allInsights])
  const totalPages = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE))
  const pageRows = ranked.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className={`p-6 flex flex-col gap-3 ${cardClass}`}>
      <div>
        <p className={sectionHeadingClass}>Products to Work On First</p>
        <p className="text-xs text-[var(--muted-text)]">The highest-opportunity products — not your whole catalog.</p>
      </div>
      {top.length === 0 ? (
        <p className="text-xs text-[var(--muted-text)]">No high-priority products identified this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b border-[var(--card-border)]">
                <th className="py-1.5 pr-3 font-medium text-[var(--muted-text)]">Priority</th>
                <th className="py-1.5 pr-3 font-medium text-[var(--muted-text)]">Product</th>
                <th className="py-1.5 pr-3 font-medium text-[var(--muted-text)]">Signal</th>
                <th className="py-1.5 pr-3 font-medium text-[var(--muted-text)]">Evidence</th>
                <th className="py-1.5 pr-3 font-medium text-[var(--muted-text)]">Why</th>
                <th className="py-1.5 pr-3 font-medium text-[var(--muted-text)]">Recommended Action</th>
              </tr>
            </thead>
            <tbody>
              {top.map((p, i) => (
                <tr key={p.externalProductId} className="border-b border-[var(--card-border)] align-top">
                  <td className="py-2 pr-3 text-[var(--body-text)]">{i + 1}</td>
                  <td className="py-2 pr-3 text-[var(--heading-text)] whitespace-nowrap">
                    {p.externalProductId}
                    {!p.productId && <span className="block text-xs text-[var(--muted-text)]">(not linked to a catalog product)</span>}
                  </td>
                  <td className="py-2 pr-3 text-[var(--muted-text)] whitespace-nowrap">
                    <BucketBadge bucket={p.bucket} />
                  </td>
                  <td className="py-2 pr-3 text-[var(--muted-text)] whitespace-nowrap">{p.evidence}</td>
                  <td className="py-2 pr-3 text-[var(--body-text)]">{describeWhyPrioritized(p)}</td>
                  <td className="py-2 pr-3 text-[var(--body-text)]">{p.recommendedAction ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {allFixNowCount > top.length && (
        <p className="text-xs text-[var(--muted-text)]">
          Showing the top {top.length} of {allFixNowCount} highest-priority products, ranked by opportunity.
        </p>
      )}

      <button type="button" onClick={() => setExpanded((v) => !v)} className={`self-start ${buttonSecondarySmallClass} flex items-center gap-1`}>
        View all affected products
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded && (
        <div className="flex flex-col gap-2">
          <div className="overflow-x-auto max-h-[28rem] overflow-y-auto border border-[var(--card-border)] rounded-xl">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-[var(--card-bg)]">
                <tr className="text-left border-b border-[var(--card-border)]">
                  <th className="py-1.5 px-3 font-medium text-[var(--muted-text)]">Priority</th>
                  <th className="py-1.5 px-3 font-medium text-[var(--muted-text)]">Product</th>
                  <th className="py-1.5 px-3 font-medium text-[var(--muted-text)]">Signal</th>
                </tr>
              </thead>
              <tbody>
                {/* No Evidence column here — the full per-product evidence
                    for these same products already appears once, above
                    (for the top opportunities) or is available by
                    re-sorting; this exhaustive list is a reference index by
                    ID/priority/signal only, not a second evidence dump. */}
                {pageRows.map((p) => (
                  <tr key={p.externalProductId} className="border-b border-[var(--card-border)]">
                    <td className="py-1.5 px-3 text-[var(--body-text)] capitalize whitespace-nowrap">{p.priority.replace('-', ' ')}</td>
                    <td className="py-1.5 px-3 text-[var(--heading-text)] whitespace-nowrap">{p.externalProductId}</td>
                    <td className="py-1.5 px-3 text-[var(--muted-text)] whitespace-nowrap">
                      <BucketBadge bucket={p.bucket} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2 text-xs text-[var(--muted-text)]">
              <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className={buttonSecondarySmallClass}>
                Previous
              </button>
              <span>
                Page {page + 1} of {totalPages} ({ranked.length} products)
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className={buttonSecondarySmallClass}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PositivePerformers({ scale }: { scale: ProductInsight[] }) {
  return (
    <div className={`p-6 flex flex-col gap-3 ${cardClass}`}>
      <p className={sectionHeadingClass}>Positive Performers</p>
      {scale.length === 0 ? (
        <p className="text-xs text-[var(--muted-text)]">No consistently strong, non-declining product identified yet.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {scale.map((p) => (
              <li key={p.externalProductId} className="text-sm">
                <p className="font-medium text-[var(--success-text)] flex items-center gap-1.5">
                  <CheckCircle2 size={14} />
                  {p.externalProductId}
                  {!p.productId && <span className="text-[var(--muted-text)] font-normal"> (not linked to a catalog product)</span>}
                </p>
                <p className="text-xs text-[var(--muted-text)] ml-5">{describeWhyPrioritized(p)}</p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-[var(--muted-text)] pt-2 border-t border-[var(--card-border)]">
            These products are showing stronger shopper response. Study what these products have in common before applying changes to weaker products.
          </p>
        </>
      )}
    </div>
  )
}

function DontPrioritize({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <div className={`p-6 flex flex-col gap-2 ${cardClass}`}>
      <p className={sectionHeadingClass}>Products with Insufficient Activity</p>
      <p className={bodyTextClass}>
        {count} product{count === 1 ? '' : 's'} do{count === 1 ? 'es' : ''} not currently provide enough evidence for Tesolute to recommend significant
        optimization. Focus your effort on higher-opportunity products first.
      </p>
    </div>
  )
}

function HistoricalIntelligence({
  current,
  previous,
  trend,
  multiPeriodStory,
  persistentProblems
}: {
  current: AggregateSnapshot
  previous: AggregateSnapshot | null
  trend: ReturnType<typeof compareAggregates>
  multiPeriodStory: string | null
  persistentProblems: ReturnType<typeof describePersistentProblems>
}) {
  const lines = previous && trend ? describeWhatChanged(current, previous, trend) : []
  return (
    <div className={`p-6 flex flex-col gap-3 ${cardClass}`}>
      <p className={sectionHeadingClass}>Historical Intelligence</p>
      <div className="flex flex-col gap-2">
        {lines.map((line) => (
          <div key={line.label}>
            <p className="text-sm font-medium text-[var(--heading-text)]">
              {line.label} — {line.value}
              {line.changeLabel && <span className="text-xs text-[var(--muted-text)]"> ({line.changeLabel})</span>}
            </p>
            <p className="text-xs text-[var(--muted-text)]">{line.explanation}</p>
          </div>
        ))}
      </div>
      {multiPeriodStory && (
        <div className="pt-2 border-t border-[var(--card-border)]">
          <p className={labelClass}>Over time</p>
          <p className={`mt-1 ${bodyTextClass}`}>{multiPeriodStory}</p>
        </div>
      )}
      {persistentProblems.length > 0 && (
        <div className="pt-2 border-t border-[var(--card-border)] flex flex-col gap-1">
          <p className={labelClass}>Persistent problems</p>
          {persistentProblems.map((p) => (
            <p key={p.area} className="text-xs text-[var(--muted-text)]">
              {p.label} has appeared in every one of the last {p.periodsPersistent} reports.
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function ActionPlanSection({ title, phases }: { title: string; phases: { label: string; items: { title: string; detail: string }[] }[] }) {
  return (
    <div className={`p-6 flex flex-col gap-3 ${cardClass}`}>
      <p className={sectionHeadingClass}>{title}</p>
      <div className="flex flex-col gap-3">
        {phases.map((phase) => (
          <div key={phase.label}>
            <p className={labelClass}>{phase.label}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {phase.items.map((item, i) => (
                <li key={i} className="text-sm text-[var(--body-text)]">
                  <span className="font-medium text-[var(--heading-text)]">{item.title}:</span> {item.detail}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
