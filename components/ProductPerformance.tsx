"use client"

import { useEffect, useMemo, useState } from 'react'
import { getProductPerformance } from '@/lib/performance'
import { PERFORMANCE_MARKETPLACES, PERFORMANCE_MARKETPLACE_LABELS, type CanonicalPerformanceRecord, type PerformanceMarketplace } from '@/lib/performanceAdapters'
import { computeNormalizedMetrics } from '@/lib/performanceMetrics'
import { diagnosePerformance, computeTrend, type Diagnosis } from '@/lib/performanceDiagnosis'
import { getRecommendation } from '@/lib/performanceRecommendations'
import { labelClass, buttonSecondarySmallClass, buttonPrimarySmallClass } from '@/lib/uiClasses'

// Milestone C15 — §12/§13 Performance Intelligence UI, mounted inside the
// existing product detail/review drawer (GeneratedListingDrawer in
// CatalogueWorkspace.tsx), same placement convention as
// components/ProductHistory.tsx right above it — no new top-level
// navigation. Self-contained: fetches getProductPerformance itself, so a
// failure here can't break the rest of the drawer.

function formatMetric(value: number | null, opts: { percent?: boolean; currency?: boolean; decimals?: number } = {}): string {
  if (value === null) return '—'
  if (opts.currency) return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
  if (opts.percent) return `${value.toFixed(opts.decimals ?? 1)}%`
  return value.toLocaleString('en-IN', { maximumFractionDigits: opts.decimals ?? 0 })
}

function formatPeriodLabel(record: CanonicalPerformanceRecord): string {
  const start = new Date(record.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const end = new Date(record.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${start} – ${end}`
}

function DiagnosisBadge({ diagnosis }: { diagnosis: Diagnosis }) {
  const isHealthy = diagnosis.code.endsWith('_HEALTHY') || diagnosis.code === 'PERFORMANCE_IMPROVING'
  const isNeutral = diagnosis.code === 'INSUFFICIENT_DATA'
  const icon = isHealthy ? '✓' : isNeutral ? 'ℹ' : '⚠'
  const colorClass = isHealthy
    ? 'text-[var(--success-text)]'
    : isNeutral
      ? 'text-[var(--muted-text)]'
      : 'text-[var(--warn-text)]'
  return (
    <div className="text-sm">
      <p className={`font-medium ${colorClass}`}>
        {icon} {diagnosis.code.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
      </p>
      <p className="text-xs text-[var(--muted-text)] mt-0.5">{diagnosis.message}</p>
    </div>
  )
}

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; byMarketplace: Map<PerformanceMarketplace, CanonicalPerformanceRecord[]> }

export default function ProductPerformance({ productId }: { productId: string | null | undefined }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [selectedMarketplace, setSelectedMarketplace] = useState<PerformanceMarketplace | null>(null)

  useEffect(() => {
    if (!productId) return
    let cancelled = false
    setState({ status: 'loading' })

    getProductPerformance(productId, undefined)
      .then((records) => {
        if (cancelled) return
        const byMarketplace = new Map<PerformanceMarketplace, CanonicalPerformanceRecord[]>()
        for (const record of records) {
          const list = byMarketplace.get(record.marketplace) ?? []
          list.push(record)
          byMarketplace.set(record.marketplace, list)
        }
        setState({ status: 'loaded', byMarketplace })
        setSelectedMarketplace((prev) => prev ?? PERFORMANCE_MARKETPLACES.find((m) => byMarketplace.has(m)) ?? null)
      })
      .catch((err: any) => {
        console.error(`ProductPerformance: failed to load performance for ${productId}:`, err?.message ?? err)
        if (!cancelled) setState({ status: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [productId])

  const records = state.status === 'loaded' && selectedMarketplace ? state.byMarketplace.get(selectedMarketplace) ?? [] : []
  const current = records[0] ?? null
  const previous = records[1] ?? null

  const diagnoses = useMemo(() => (current ? diagnosePerformance(current) : []), [current])
  const trend = useMemo(() => (current ? computeTrend(current, previous ?? null) : null), [current, previous])
  const topDiagnosis = diagnoses[0] ?? null
  const recommendation = topDiagnosis ? getRecommendation(topDiagnosis.code) : null
  const normalized = current ? computeNormalizedMetrics(current) : null

  const availableMarketplaces =
    state.status === 'loaded' ? PERFORMANCE_MARKETPLACES.filter((m) => state.byMarketplace.has(m)) : []

  return (
    <div className="mt-4 pt-4 border-t border-[var(--card-border)]">
      <p className={labelClass}>Performance</p>

      {!productId && (
        <p className="mt-1 text-xs text-[var(--muted-text)]">Performance data is available once this product is saved.</p>
      )}

      {productId && state.status === 'loading' && (
        <div className="mt-2 flex flex-col gap-2" aria-busy="true" aria-label="Loading performance data">
          {[0, 1].map((i) => (
            <div key={i} className="h-8 rounded bg-[var(--skeleton-bg)] animate-pulse" />
          ))}
        </div>
      )}

      {productId && state.status === 'error' && (
        <p className="mt-1 text-xs text-[var(--danger-text)]">Unable to load performance data.</p>
      )}

      {productId && state.status === 'loaded' && availableMarketplaces.length === 0 && (
        <p className="mt-1 text-xs text-[var(--muted-text)]">No performance data yet. Import a report to see insights for this product.</p>
      )}

      {productId && state.status === 'loaded' && availableMarketplaces.length > 0 && (
        <div className="mt-2 flex flex-col gap-3">
          {availableMarketplaces.length > 1 && (
            <div className="flex gap-1.5">
              {availableMarketplaces.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSelectedMarketplace(m)}
                  className={selectedMarketplace === m ? buttonPrimarySmallClass : buttonSecondarySmallClass}
                >
                  {PERFORMANCE_MARKETPLACE_LABELS[m]}
                </button>
              ))}
            </div>
          )}

          {current && (
            <>
              <p className="text-xs text-[var(--muted-text)]">Current period: {formatPeriodLabel(current)}</p>

              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-xs text-[var(--muted-text)]">Impressions</p>
                  <p className="text-[var(--body-text)]">{formatMetric(current.impressions)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted-text)]">Clicks</p>
                  <p className="text-[var(--body-text)]">{formatMetric(current.clicks)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted-text)]">CTR</p>
                  <p className="text-[var(--body-text)]">{formatMetric(normalized?.ctr ?? null, { percent: true })}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted-text)]">Add to Cart</p>
                  <p className="text-[var(--body-text)]">{formatMetric(current.addToCarts)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted-text)]">Purchases</p>
                  <p className="text-[var(--body-text)]">{formatMetric(current.purchases)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted-text)]">Conversion</p>
                  <p className="text-[var(--body-text)]">{formatMetric(normalized?.conversionRate ?? null, { percent: true })}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted-text)]">Returns</p>
                  <p className="text-[var(--body-text)]">{formatMetric(current.returnRate, { percent: true })}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted-text)]">Rating</p>
                  <p className="text-[var(--body-text)]">{current.rating !== null ? current.rating.toFixed(1) : '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted-text)]">Revenue</p>
                  <p className="text-[var(--body-text)]">{formatMetric(current.revenue, { currency: true })}</p>
                </div>
              </div>

              {topDiagnosis && (
                <div className="pt-2 border-t border-[var(--card-border)]">
                  <p className={labelClass}>Performance diagnosis</p>
                  <div className="mt-1">
                    <DiagnosisBadge diagnosis={topDiagnosis} />
                  </div>
                </div>
              )}

              {trend?.diagnosis && (
                <div className="mt-1">
                  <DiagnosisBadge diagnosis={trend.diagnosis} />
                </div>
              )}

              {recommendation && (
                <div className="pt-2 border-t border-[var(--card-border)]">
                  <p className={labelClass}>Recommendation</p>
                  <p className="mt-1 text-sm text-[var(--body-text)]">{recommendation}</p>
                </div>
              )}

              {records.length > 1 && (
                <div className="pt-2 border-t border-[var(--card-border)]">
                  <p className={labelClass}>History</p>
                  <ul className="mt-1 flex flex-col gap-2">
                    {records.map((record, i) => (
                      <li key={`${record.periodStart}-${record.periodEnd}`} className="text-xs">
                        <p className="font-medium text-[var(--body-text)]">
                          {i === 0 ? 'Current period' : `${records.length - i} period${records.length - i === 1 ? '' : 's'} ago`} — {formatPeriodLabel(record)}
                        </p>
                        <p className="text-[var(--muted-text)]">
                          Impressions: {formatMetric(record.impressions)} · Clicks: {formatMetric(record.clicks)} · Purchases: {formatMetric(record.purchases)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
