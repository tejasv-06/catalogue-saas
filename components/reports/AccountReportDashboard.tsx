"use client"

import { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  ScatterChart,
  Scatter,
  Legend,
  type TooltipContentProps
} from 'recharts'
import type { AccountReportStats } from '@/lib/accountReportStats'
import type { AccountInsights, AccountInsightsResponse } from '@/lib/accountInsights'
import { formatCurrency, formatPercent } from '@/lib/formatAccountStats'
import {
  cardClass,
  labelClass,
  sectionHeadingClass,
  bodyTextClass,
  buttonPrimaryClass,
  warningBannerClass,
  warningTextClass,
  dangerBannerClass,
  dangerTextClass
} from '@/lib/uiClasses'

// CSS custom properties resolve live as SVG attribute values in modern
// browsers, so these track the app's dark/light toggle (app/globals.css)
// automatically — no theme-change listener needed. Brand blue and the
// danger/red token are the same accent colors used everywhere else in the
// app (buttonPrimaryClass, dangerTextClass), not new chart-specific colors.
const CHART_GRID = 'var(--row-border)'
const CHART_AXIS = 'var(--muted-text)'
const BRAND_BLUE = '#2563eb'
const BRAND_BLUE_MUTED = 'rgba(37, 99, 235, 0.28)'
const DANGER = 'var(--danger-text)'

function StatCard({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className={`p-6 flex flex-col gap-1 ${cardClass}`}>
      <span className={labelClass}>{label}</span>
      <span className="text-3xl font-bold text-[var(--heading-text)]">{value}</span>
      {sublabel && <span className={bodyTextClass}>{sublabel}</span>}
    </div>
  )
}

function ChartTooltipShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs shadow-xl">
      {children}
    </div>
  )
}

function RevenueTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload as { asin: string; revenue: number }
  return (
    <ChartTooltipShell>
      <div className="font-medium text-[var(--heading-text)]">{point.asin}</div>
      <div className="text-[var(--body-text)]">{formatCurrency(point.revenue)}</div>
    </ChartTooltipShell>
  )
}

function ScatterTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload as { asin: string; sessions: number; unitSessionPercentage: number }
  return (
    <ChartTooltipShell>
      <div className="font-medium text-[var(--heading-text)]">{point.asin}</div>
      <div className="text-[var(--body-text)]">Sessions: {point.sessions.toLocaleString()}</div>
      <div className="text-[var(--body-text)]">Unit Session %: {point.unitSessionPercentage.toFixed(1)}%</div>
    </ChartTooltipShell>
  )
}

function AccountNarrative({ insights, verificationWarnings }: { insights: AccountInsights; verificationWarnings: string[] }) {
  const sortedActionPlan = useMemo(
    () => [...insights.actionPlan].sort((a, b) => a.priority - b.priority),
    [insights.actionPlan]
  )

  return (
    <div className="flex flex-col gap-6">
      {verificationWarnings.length > 0 && (
        <div className={warningBannerClass}>
          <p className={`${warningTextClass} font-medium`}>
            {`${verificationWarnings.length} figure${verificationWarnings.length === 1 ? '' : 's'} in this narrative couldn't be matched against the verified stats — review before sharing:`}
          </p>
          <p className={`${warningTextClass} mt-1`}>{verificationWarnings.join(', ')}</p>
        </div>
      )}

      <div className={`p-6 ${cardClass}`}>
        <h3 className={sectionHeadingClass}>Account Snapshot</h3>
        <ul className="mt-3 flex flex-col gap-2">
          {insights.accountSnapshot.map((point, index) => (
            <li key={index} className={`${bodyTextClass} flex gap-2`}>
              <span className="text-blue-600">•</span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={`p-6 ${cardClass}`}>
        <h3 className={sectionHeadingClass}>Key Operational Findings</h3>
        <div className="mt-3 flex flex-col gap-4">
          <div>
            <h4 className="text-sm font-semibold text-[var(--heading-text)]">Revenue Concentration</h4>
            <p className={`${bodyTextClass} mt-1`}>{insights.keyOperationalFindings.revenueConcentration}</p>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[var(--heading-text)]">Conversion Bottleneck</h4>
            <p className={`${bodyTextClass} mt-1`}>{insights.keyOperationalFindings.conversionBottleneck}</p>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[var(--heading-text)]">Volatility</h4>
            <p className={`${bodyTextClass} mt-1`}>{insights.keyOperationalFindings.volatility}</p>
          </div>
        </div>
      </div>

      <div className={`p-6 ${cardClass}`}>
        <h3 className={sectionHeadingClass}>30-Day Action Plan (Prioritized by ROI)</h3>
        <ol className="mt-3 flex flex-col gap-3">
          {sortedActionPlan.map((item) => (
            <li key={item.priority} className="flex gap-3">
              <span className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-blue-600 text-white text-xs font-bold">
                {item.priority}
              </span>
              <div>
                <div className="text-sm font-semibold text-[var(--heading-text)]">{item.title}</div>
                <p className={`${bodyTextClass} mt-0.5`}>{item.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className={`p-6 ${cardClass}`}>
        <h3 className={sectionHeadingClass}>Strategic Summary</h3>
        <p className={`${bodyTextClass} mt-3`}>{insights.strategicSummary}</p>
      </div>
    </div>
  )
}

export default function AccountReportDashboard({ stats }: { stats: AccountReportStats }) {
  const [insights, setInsights] = useState<AccountInsights | null>(null)
  const [verificationWarnings, setVerificationWarnings] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)

  async function handleGenerate() {
    setGenerating(true)
    setGenerateError(null)

    try {
      const res = await fetch('/api/generate-account-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stats)
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate insights')
      }

      const { insights: nextInsights, verificationWarnings: warnings } = data as AccountInsightsResponse
      setInsights(nextInsights)
      setVerificationWarnings(warnings)
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Failed to generate insights')
    } finally {
      setGenerating(false)
    }
  }

  const revenueSorted = useMemo(
    () => [...stats.asinRows].sort((a, b) => b.orderedProductSales - a.orderedProductSales),
    [stats.asinRows]
  )
  const revenueChartData = useMemo(
    () => revenueSorted.map((row) => ({ asin: row.asin, revenue: row.orderedProductSales })),
    [revenueSorted]
  )

  const thresholdCount = stats.revenueConcentration.asinCount
  const firstAsin = revenueSorted[0]?.asin
  const thresholdAsin = thresholdCount > 0 ? revenueSorted[thresholdCount - 1]?.asin : undefined

  const scatterData = useMemo(
    () =>
      stats.asinRows.map((row) => ({
        asin: row.asin,
        sessions: row.sessions ?? 0,
        unitSessionPercentage: row.unitSessionPercentage ?? 0,
        hasSales: row.unitsOrdered > 0
      })),
    [stats.asinRows]
  )
  const scatterConverting = scatterData.filter((point) => point.hasSales)
  const scatterZeroSales = scatterData.filter((point) => !point.hasSales)

  return (
    <div className="flex flex-col gap-6">
      <div className={`p-6 flex items-center gap-4 ${cardClass}`}>
        <button onClick={handleGenerate} disabled={generating} className={buttonPrimaryClass}>
          {generating ? 'Generating...' : insights ? 'Regenerate AI Insights' : 'Generate AI Insights'}
        </button>
        <p className={bodyTextClass}>
          Written by AI from the verified numbers below — every figure it uses is copied from this report, not
          recalculated.
        </p>
      </div>

      {generateError && (
        <div className={dangerBannerClass}>
          <p className={dangerTextClass}>{generateError}</p>
        </div>
      )}

      {insights && <AccountNarrative insights={insights} verificationWarnings={verificationWarnings} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Revenue"
          value={formatCurrency(stats.totalRevenue)}
          sublabel={`${stats.totalUnitsOrdered.toLocaleString()} units ordered`}
        />
        <StatCard
          label="Average Order Value"
          value={stats.averageOrderValue !== null ? formatCurrency(stats.averageOrderValue) : 'n/a'}
        />
        <StatCard
          label="Average Buy Box %"
          value={stats.averageBuyBoxPercentage !== null ? formatPercent(stats.averageBuyBoxPercentage) : 'n/a'}
        />
        <StatCard
          label="ASINs With Sales"
          value={formatPercent(stats.asinsWithSales.percent)}
          sublabel={`${stats.asinsWithSales.count} of ${stats.totalActiveAsinCount} ASINs`}
        />
      </div>

      <div className={`p-6 ${cardClass}`}>
        <h3 className={sectionHeadingClass}>Where Your Revenue Comes From</h3>
        <p className={`${bodyTextClass} mt-1 mb-4`}>
          {thresholdCount} product{thresholdCount === 1 ? '' : 's'} bring{thresholdCount === 1 ? 's' : ''} in{' '}
          {formatPercent(stats.revenueConcentration.cumulativeRevenuePercent)} of your revenue.
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={revenueChartData} margin={{ top: 24, right: 8, left: 8, bottom: 24 }}>
            <CartesianGrid stroke={CHART_GRID} vertical={false} />
            <XAxis
              dataKey="asin"
              tick={false}
              axisLine={{ stroke: CHART_GRID }}
              label={{
                value: 'Products, sorted by revenue (highest first)',
                position: 'insideBottom',
                offset: -8,
                fill: CHART_AXIS,
                fontSize: 12
              }}
            />
            <YAxis
              tickFormatter={(value) => formatCurrency(Number(value))}
              tick={{ fill: CHART_AXIS, fontSize: 12 }}
              axisLine={{ stroke: CHART_GRID }}
              tickLine={{ stroke: CHART_GRID }}
              width={80}
            />
            <Tooltip content={RevenueTooltip} cursor={{ fill: 'var(--secondary-btn-bg)' }} />
            {thresholdCount > 0 && firstAsin && thresholdAsin && (
              <ReferenceArea x1={firstAsin} x2={thresholdAsin} fill={BRAND_BLUE} fillOpacity={0.08} strokeOpacity={0} />
            )}
            {thresholdCount > 0 && thresholdAsin && (
              <ReferenceLine
                x={thresholdAsin}
                stroke={BRAND_BLUE}
                strokeDasharray="4 4"
                label={{ value: '80% of revenue', position: 'top', fill: BRAND_BLUE, fontSize: 12 }}
              />
            )}
            <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
              {revenueChartData.map((point, index) => (
                <Cell key={point.asin} fill={index < thresholdCount ? BRAND_BLUE : BRAND_BLUE_MUTED} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className={`p-6 ${cardClass}`}>
        <h3 className={sectionHeadingClass}>Traffic That Isn&apos;t Converting</h3>
        <p className={`${bodyTextClass} mt-1 mb-4`}>
          Red dots are products getting visits but zero sales — the ones farthest right are wasting the most traffic.
        </p>
        <ResponsiveContainer width="100%" height={340}>
          <ScatterChart margin={{ top: 24, right: 16, left: 8, bottom: 24 }}>
            <CartesianGrid stroke={CHART_GRID} />
            <XAxis
              type="number"
              dataKey="sessions"
              name="Sessions"
              tick={{ fill: CHART_AXIS, fontSize: 12 }}
              axisLine={{ stroke: CHART_GRID }}
              tickLine={{ stroke: CHART_GRID }}
              label={{ value: 'Sessions', position: 'insideBottom', offset: -8, fill: CHART_AXIS, fontSize: 12 }}
            />
            <YAxis
              type="number"
              dataKey="unitSessionPercentage"
              name="Unit Session %"
              unit="%"
              tick={{ fill: CHART_AXIS, fontSize: 12 }}
              axisLine={{ stroke: CHART_GRID }}
              tickLine={{ stroke: CHART_GRID }}
              width={60}
              label={{ value: 'Unit Session %', angle: -90, position: 'insideLeft', fill: CHART_AXIS, fontSize: 12 }}
            />
            <Tooltip content={ScatterTooltip} cursor={{ strokeDasharray: '3 3', stroke: CHART_GRID }} />
            <ReferenceLine
              x={stats.sessionsMedian}
              stroke={CHART_AXIS}
              strokeDasharray="4 4"
              label={{ value: 'Median sessions', position: 'top', fill: CHART_AXIS, fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: CHART_AXIS }} />
            <Scatter name="Converting" data={scatterConverting} fill={BRAND_BLUE} />
            <Scatter name="Zero sales" data={scatterZeroSales} fill={DANGER} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
