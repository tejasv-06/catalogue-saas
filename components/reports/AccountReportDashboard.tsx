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
  type TooltipContentProps
} from 'recharts'
import type { AccountReportStats } from '@/lib/accountReportStats'
import type { AccountInsights, AccountInsightsResponse, ActionPlanCategory, ActionPlanItem } from '@/lib/accountInsights'
import { normalizeActionPlanCategory } from '@/lib/accountInsights'
import { formatCurrency, formatPercent } from '@/lib/formatAccountStats'
import { CREDIT_COSTS } from '@/lib/creditCosts'
import { notifyCreditsChanged } from '@/components/CreditsBalance'
import {
  cardClass,
  labelClass,
  sectionHeadingClass,
  bodyTextClass,
  buttonPrimaryClass,
  inputClass,
  warningBannerClass,
  warningTextClass,
  dangerBannerClass,
  dangerTextClass
} from '@/lib/uiClasses'

// CSS custom properties resolve live as SVG attribute values in modern
// browsers, so these track the app's dark/light toggle (app/globals.css)
// automatically: no theme-change listener needed. Brand blue is the same
// accent color used everywhere else in the app (buttonPrimaryClass), not a
// new chart-specific color. The conversion-tier colors below are literal
// hex, not CSS vars, by explicit spec (red/yellow/green severity, constant
// across themes: a status color, not a surface color).
const CHART_GRID = 'var(--row-border)'
const CHART_AXIS = 'var(--muted-text)'
const BRAND_BLUE = '#2563eb'
const BRAND_BLUE_MUTED = 'rgba(37, 99, 235, 0.28)'

const CONVERSION_COLORS = { zero: '#EF4444', low: '#F59E0B', good: '#10B981' } as const
type ConversionTier = keyof typeof CONVERSION_COLORS

type StatusLevel = 'good' | 'warning' | 'danger'

const STATUS_BADGE_CONFIG: Record<StatusLevel, { label: string; className: string }> = {
  good: { label: 'Healthy', className: 'bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]' },
  warning: { label: 'Warning', className: 'bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]' },
  danger: { label: 'Action Needed', className: 'bg-[var(--danger-bg)] text-[var(--danger-text)] border-[var(--danger-border)]' }
}

const CATEGORY_BADGE_CONFIG: Record<ActionPlanCategory, { label: string; className: string }> = {
  ppc: { label: 'PPC', className: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
  listing: { label: 'Listing', className: 'bg-violet-500/10 text-violet-600 border-violet-500/30' },
  buybox: { label: 'Buy Box', className: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  catalog: { label: 'Catalog', className: 'bg-slate-500/10 text-slate-500 border-slate-500/30' }
}

// Exact thresholds as specified: see the summary sent alongside this diff
// for the flagged caveat on how revenue concentration behaves against these.
function getBuyBoxStatus(value: number | null): StatusLevel | null {
  if (value === null) return null
  if (value < 70) return 'danger'
  if (value < 85) return 'warning'
  return 'good'
}

function getZeroSalesStatus(percent: number): StatusLevel {
  if (percent >= 35) return 'danger'
  if (percent >= 20) return 'warning'
  return 'good'
}

function getConcentrationStatus(percent: number): StatusLevel {
  if (percent >= 85) return 'danger'
  if (percent >= 70) return 'warning'
  return 'good'
}

function displayLabel(title: string | null, asin: string): string {
  return title && title.trim() ? title.trim() : asin
}

function truncateLabel(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function StatusBadge({ status }: { status: StatusLevel }) {
  const config = STATUS_BADGE_CONFIG[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${config.className}`}>
      {config.label}
    </span>
  )
}

function CategoryBadge({ category }: { category: ActionPlanCategory | null }) {
  if (!category) return null
  const config = CATEGORY_BADGE_CONFIG[category]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${config.className}`}>
      {config.label}
    </span>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[var(--muted-text)]">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

function StatCard({
  label,
  value,
  sublabel,
  status
}: {
  label: string
  value: string
  sublabel?: string
  status?: StatusLevel | null
}) {
  return (
    <div className={`p-6 flex flex-col gap-1 ${cardClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={labelClass}>{label}</span>
        {status && <StatusBadge status={status} />}
      </div>
      <span className="text-3xl font-bold tracking-tight tabular-nums text-[var(--heading-text)]">{value}</span>
      {sublabel && <span className={bodyTextClass}>{sublabel}</span>}
    </div>
  )
}

function ChartTooltipShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs shadow-xl max-w-[85vw] sm:max-w-xs break-words">
      {children}
    </div>
  )
}

function RevenueTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload as { asin: string; title: string | null; revenue: number; percentShare: number }
  const label = displayLabel(point.title, point.asin)
  return (
    <ChartTooltipShell>
      <div className="font-medium text-[var(--heading-text)]">{label}</div>
      {point.title && <div className="text-[var(--muted-text)]">{point.asin}</div>}
      <div className="text-[var(--body-text)] mt-1">{formatCurrency(point.revenue)}</div>
      <div className="text-[var(--body-text)]">{formatPercent(point.percentShare)} of total revenue</div>
    </ChartTooltipShell>
  )
}

function LeakageTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload as {
    asin: string
    title: string | null
    label: string
    sessions: number
    unitsOrdered: number
    conversion: number
  }
  return (
    <ChartTooltipShell>
      <div className="font-medium text-[var(--heading-text)]">{point.label}</div>
      {point.title && <div className="text-[var(--muted-text)]">{point.asin}</div>}
      <div className="text-[var(--body-text)] mt-1">Sessions: {point.sessions.toLocaleString()}</div>
      <div className="text-[var(--body-text)]">Units sold: {point.unitsOrdered}</div>
      <div className="text-[var(--body-text)]">Unit Session: {point.conversion.toFixed(1)}%</div>
    </ChartTooltipShell>
  )
}

// Rotated custom tick so full product titles (truncated) render under each
// bar instead of the raw ASIN: recharts' plain `tick` boolean only ever
// shows the literal dataKey value, so this has to be a custom renderer.
function makeRevenueXAxisTick(titleByAsin: Map<string, string>) {
  return function RevenueXAxisTick(props: { x?: number | string; y?: number | string; payload?: { value: string } }) {
    const label = props.payload ? titleByAsin.get(props.payload.value) ?? props.payload.value : ''
    return (
      <g transform={`translate(${props.x},${props.y})`}>
        <text x={0} y={0} dy={10} textAnchor="end" transform="rotate(-40)" fontSize={11} fill={CHART_AXIS}>
          {truncateLabel(label, 18)}
        </text>
      </g>
    )
  }
}

function Callout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 rounded-xl border border-blue-500/25 bg-blue-500/[0.06]">
      <h4 className="text-sm font-semibold text-[var(--heading-text)] mb-1">{title}</h4>
      <p className={bodyTextClass}>{children}</p>
    </div>
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
            {`${verificationWarnings.length} figure${verificationWarnings.length === 1 ? '' : 's'} in this narrative couldn't be matched against the verified stats. Review before sharing:`}
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
        <div className="mt-3 flex flex-col gap-3">
          <Callout title="Revenue Concentration">{insights.keyOperationalFindings.revenueConcentration}</Callout>
          <Callout title="Conversion Bottleneck">{insights.keyOperationalFindings.conversionBottleneck}</Callout>
          <Callout title="Volatility">{insights.keyOperationalFindings.volatility}</Callout>
        </div>
      </div>

      <div className={`p-6 ${cardClass}`}>
        <h3 className={sectionHeadingClass}>30-Day Action Plan (Prioritized by ROI)</h3>
        <ol className="mt-3 flex flex-col gap-3">
          {sortedActionPlan.map((item: ActionPlanItem) => (
            <li key={item.priority} className="flex gap-3">
              <span className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-blue-600 text-white text-xs font-bold">
                {item.priority}
              </span>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold text-[var(--heading-text)]">{item.title}</div>
                  <CategoryBadge category={normalizeActionPlanCategory(item.category)} />
                  <span className="text-xs font-medium text-[var(--muted-text)]">Priority {item.priority}</span>
                </div>
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

  const [accountName, setAccountName] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

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
      notifyCreditsChanged()
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Failed to generate insights')
    } finally {
      setGenerating(false)
    }
  }

  async function handleExport() {
    if (!insights) return
    setExporting(true)
    setExportError(null)

    try {
      const res = await fetch('/api/export-audit-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountName, insights, stats, verificationWarnings })
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to generate report')
      }

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const slug = (accountName.trim() || 'account').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
      a.download = `${slug}-audit-report.docx`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to generate report')
    } finally {
      setExporting(false)
    }
  }

  const revenueSorted = useMemo(
    () => [...stats.asinRows].sort((a, b) => b.orderedProductSales - a.orderedProductSales),
    [stats.asinRows]
  )
  const revenueChartData = useMemo(
    () =>
      revenueSorted.map((row) => ({
        asin: row.asin,
        title: row.title,
        revenue: row.orderedProductSales,
        percentShare: stats.totalRevenue > 0 ? (row.orderedProductSales / stats.totalRevenue) * 100 : 0
      })),
    [revenueSorted, stats.totalRevenue]
  )
  const revenueTitleByAsin = useMemo(
    () => new Map(revenueChartData.map((row) => [row.asin, displayLabel(row.title, row.asin)])),
    [revenueChartData]
  )
  const revenueXAxisTick = useMemo(() => makeRevenueXAxisTick(revenueTitleByAsin), [revenueTitleByAsin])

  const thresholdCount = stats.revenueConcentration.asinCount
  const firstAsin = revenueSorted[0]?.asin
  const thresholdAsin = thresholdCount > 0 ? revenueSorted[thresholdCount - 1]?.asin : undefined

  // Full ranked catalog, not just the pre-filtered "high traffic zero sales"
  // subset: the chart's point is to show the whole conversion spectrum by
  // traffic volume, with color doing the flagging. Capped for readability.
  const leakageData = useMemo(
    () =>
      [...stats.asinRows]
        .map((row) => {
          const conversion = row.unitSessionPercentage ?? 0
          const tier: ConversionTier = conversion === 0 ? 'zero' : conversion < 2 ? 'low' : 'good'
          return {
            asin: row.asin,
            title: row.title,
            label: displayLabel(row.title, row.asin),
            sessions: row.sessions ?? 0,
            unitsOrdered: row.unitsOrdered,
            conversion,
            tier
          }
        })
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 20),
    [stats.asinRows]
  )

  const buyBoxStatus = getBuyBoxStatus(stats.averageBuyBoxPercentage)
  const zeroSalesStatus = getZeroSalesStatus(stats.asinsWithZeroSales.percent)
  const concentrationStatus = getConcentrationStatus(stats.revenueConcentration.cumulativeRevenuePercent)

  return (
    <div className="flex flex-col gap-6">
      <div className={`p-6 flex flex-wrap items-center gap-4 ${cardClass}`}>
        <button onClick={handleGenerate} disabled={generating} className={buttonPrimaryClass}>
          {generating
            ? 'Generating...'
            : `${insights ? 'Regenerate' : 'Generate'} AI Insights (${CREDIT_COSTS.accountAudit} credits)`}
        </button>
        <p className={bodyTextClass}>
          Written by AI from the verified numbers below: every figure it uses is copied from this report, not
          recalculated.
        </p>

        {insights && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto sm:ml-auto">
            <input
              type="text"
              placeholder="Brand Name"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className={`${inputClass} w-full sm:w-48 py-2`}
            />
            <button onClick={handleExport} disabled={exporting} className={buttonPrimaryClass}>
              {exporting ? 'Preparing...' : 'Download Report (.docx)'}
            </button>
          </div>
        )}
      </div>

      {generateError && (
        <div className={dangerBannerClass}>
          <p className={dangerTextClass}>{generateError}</p>
        </div>
      )}

      {exportError && (
        <div className={dangerBannerClass}>
          <p className={dangerTextClass}>{exportError}</p>
        </div>
      )}

      {insights && <AccountNarrative insights={insights} verificationWarnings={verificationWarnings} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
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
          label="Total Active ASINs"
          value={stats.totalActiveAsinCount.toLocaleString()}
          sublabel={`${stats.asinsWithSales.count} with sales`}
        />
        <StatCard
          label="Average Buy Box %"
          value={stats.averageBuyBoxPercentage !== null ? formatPercent(stats.averageBuyBoxPercentage) : 'n/a'}
          status={buyBoxStatus}
        />
        <StatCard
          label="Zero-Sales ASINs"
          value={formatPercent(stats.asinsWithZeroSales.percent)}
          sublabel={`${stats.asinsWithZeroSales.count} of ${stats.totalActiveAsinCount} ASINs`}
          status={zeroSalesStatus}
        />
        <StatCard
          label="Revenue Concentration"
          value={formatPercent(stats.revenueConcentration.cumulativeRevenuePercent)}
          sublabel={`in top ${stats.revenueConcentration.asinCount} ASIN${stats.revenueConcentration.asinCount === 1 ? '' : 's'}`}
          status={concentrationStatus}
        />
      </div>

      <div className={`p-6 ${cardClass}`}>
        <h3 className={sectionHeadingClass}>Where Your Revenue Comes From</h3>
        <p className={`${bodyTextClass} mt-1 mb-4`}>
          {thresholdCount} product{thresholdCount === 1 ? '' : 's'} bring{thresholdCount === 1 ? 's' : ''} in{' '}
          {formatPercent(stats.revenueConcentration.cumulativeRevenuePercent)} of your revenue.
        </p>
        <div className="h-[280px] sm:h-[350px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={revenueChartData} margin={{ top: 24, right: 8, left: 8, bottom: 90 }}>
            <CartesianGrid stroke={CHART_GRID} vertical={false} />
            <XAxis dataKey="asin" tick={revenueXAxisTick} interval={0} axisLine={{ stroke: CHART_GRID }} />
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
      </div>

      <div className={`p-6 ${cardClass}`}>
        <h3 className={sectionHeadingClass}>Traffic &amp; Conversion Leakage</h3>
        <p className={`${bodyTextClass} mt-1 mb-4`}>
          Products ranked by sessions, colored by conversion: red means visits with zero sales.
        </p>
        {/* Height is intentionally dynamic, not the fixed h-[280px] sm:h-[350px]
            pattern used elsewhere: this is a horizontal bar chart where each
            row needs a fixed slice of vertical space, so height must scale
            with the number of ASINs, not the viewport. The 280px floor still
            matches the mobile baseline used by the other chart. */}
        <ResponsiveContainer width="100%" height={Math.max(leakageData.length * 32, 280)} minHeight={280}>
          <BarChart data={leakageData} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
            <CartesianGrid stroke={CHART_GRID} horizontal={false} />
            <XAxis type="number" tick={{ fill: CHART_AXIS, fontSize: 12 }} axisLine={{ stroke: CHART_GRID }} tickLine={{ stroke: CHART_GRID }} />
            <YAxis
              type="category"
              dataKey="label"
              width={160}
              tick={{ fill: CHART_AXIS, fontSize: 11 }}
              tickFormatter={(value: string) => truncateLabel(value, 22)}
              axisLine={{ stroke: CHART_GRID }}
              tickLine={{ stroke: CHART_GRID }}
            />
            <Tooltip content={LeakageTooltip} cursor={{ fill: 'var(--secondary-btn-bg)' }} />
            <Bar dataKey="sessions" radius={[0, 4, 4, 0]}>
              {leakageData.map((point) => (
                <Cell key={point.asin} fill={CONVERSION_COLORS[point.tier]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 mt-3 text-xs">
          <LegendDot color={CONVERSION_COLORS.zero} label="0% conversion" />
          <LegendDot color={CONVERSION_COLORS.low} label="< 2% conversion" />
          <LegendDot color={CONVERSION_COLORS.good} label="≥ 2% conversion" />
        </div>
      </div>

      <div className={`p-6 ${cardClass}`}>
        <h3 className={sectionHeadingClass}>Top Traffic Leaks</h3>
        <p className={`${bodyTextClass} mt-1 mb-4`}>
          High-traffic products with zero sales: the clearest wasted ad spend or listing problems.
        </p>
        {stats.highTrafficZeroSales.length === 0 ? (
          <p className={bodyTextClass}>No high-traffic, zero-sales products found.</p>
        ) : (
          <div className="overflow-x-auto w-full -mx-4 px-4 sm:mx-0 sm:px-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-[var(--row-border)]">
                  <th className={`${labelClass} py-2 pr-4`}>Product</th>
                  <th className={`${labelClass} py-2 pr-4`}>Sessions</th>
                  <th className={`${labelClass} py-2 pr-4`}>Conversion</th>
                  <th className={`${labelClass} py-2`}>Suggested Action</th>
                </tr>
              </thead>
              <tbody>
                {stats.highTrafficZeroSales.map((row) => (
                  <tr key={row.asin} className="border-b border-[var(--row-border)] last:border-0">
                    <td className="py-2 pr-4">
                      <div className="text-[var(--heading-text)] font-medium">{displayLabel(row.title, row.asin)}</div>
                      {row.title && <div className="text-xs text-[var(--muted-text)]">{row.asin}</div>}
                    </td>
                    <td className="py-2 pr-4 text-[var(--body-text)]">{row.sessions.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-[var(--danger-text)] font-medium">0%</td>
                    <td className="py-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border bg-[var(--danger-bg)] text-[var(--danger-text)] border-[var(--danger-border)]">
                        Pause PPC / Audit Price
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
