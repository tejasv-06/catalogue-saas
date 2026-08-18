import type { TrendResult } from '@/lib/performanceDiagnosis'
import { INVESTIGATE_AREAS } from '@/lib/performanceRecommendations'
import {
  aggregatePeriod,
  classifyMetricTrend,
  topOpportunityProducts,
  buildCatalogOpportunityMap,
  type AggregateSnapshot,
  type PeriodGroup,
  type ProblemArea,
  type ProductInsight,
  type AreaDiagnosisSummary,
  type SegmentInsight,
  type SegmentDimension
} from '@/lib/performanceIntelligence'

// Milestone C15: Seller Performance Intelligence & Action Engine, the
// storytelling layer. This is where "Data -> KPI -> Interpretation ->
// Diagnosis -> Priority" (lib/performanceIntelligence.ts,
// lib/performanceDiagnosis.ts, lib/performanceMetrics.ts) becomes
// "Action -> Measurement" (this file). Nothing here recomputes a metric
// or re-derives a diagnosis: every function takes already-computed
// AggregateSnapshot / Diagnosis[] / ProductInsight[] and turns it into the
// sentences a seller actually reads. Depends on
// lib/performanceIntelligence.ts (never the reverse) to avoid a circular
// import.
//
// PRESENTATION-NEUTRAL: this file returns a `severity` classification
// (never an emoji or a color), so the UI layer decides how severity is
// rendered (a professional icon, per the design requirement: no
// emoji/colored circles). Word choice throughout: never "healthy"
// without a disclosed basis: only "increased / declined / strong signal
// / weak signal / opportunity / concern / insufficient activity": and
// never a claimed CAUSE, only what to INVESTIGATE (§2/§19).

export type Severity = 'critical' | 'warning' | 'positive' | 'info'

function fmtNum(value: number | null): string {
  if (value === null) return 'N/A'
  return value.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

function fmtPct(value: number | null, decimals = 2): string {
  if (value === null) return 'N/A'
  return `${value.toFixed(decimals)}%`
}

function pluralize(n: number | null, singular: string, plural = `${singular}s`): string {
  return n === 1 ? singular : plural
}

function areaSeverity(area: ProblemArea): Severity {
  if (area === 'purchase-conversion' || area === 'returns') return 'critical'
  if (area === 'product-page-engagement' || area === 'click-through' || area === 'rating' || area === 'stock-recovery') return 'warning'
  return 'info'
}

// --- B. Executive Status ----------------------------------------------

export type SituationSummary = {
  severity: Severity
  headline: string
  funnelLine: string
  primaryOpportunity: string
  explanation: string
  implication: string
}

// The single biggest, most actionable opportunity: reuses whichever
// diagnosis summarizeAreaDiagnoses already ranked highest (its own
// fix-order priority, not a second "biggest gap" heuristic), so the
// executive status and the funnel story (D/F, below) can never contradict
// each other.
export function describeSituation(current: AggregateSnapshot, accountDiagnoses: AreaDiagnosisSummary[]): SituationSummary {
  const funnelLine = `${fmtNum(current.impressions)} impressions → ${fmtNum(current.clicks)} clicks → ${fmtNum(current.addToCarts)} add-to-carts → ${fmtNum(current.purchases)} purchases`
  const topWeak = accountDiagnoses[0] ?? null

  if (!topWeak) {
    if ((current.purchases ?? 0) > 0) {
      return {
        severity: 'positive',
        headline: 'Your catalog is converting shopper activity into purchases',
        funnelLine,
        primaryOpportunity: 'Sustaining current performance',
        explanation: `Your products generated ${fmtNum(current.purchases)} ${pluralize(current.purchases, 'purchase')} from ${fmtNum(current.clicks)} clicks this period, with no major funnel opportunity detected in the available data.`,
        implication: 'Focus on studying what is working and applying it to your other products.'
      }
    }
    return {
      severity: 'info',
      headline: 'Not enough activity yet for a reliable read on your catalog',
      funnelLine,
      primaryOpportunity: 'Building a reliable baseline',
      explanation: 'This period does not have enough impressions or clicks for Tesolute to confidently diagnose an opportunity.',
      implication: 'Keep uploading reports as they become available: the picture becomes more reliable with more data.'
    }
  }

  const area = topWeak.area
  if (area === 'purchase-conversion') {
    return {
      severity: 'critical',
      headline: 'Your catalog is receiving visibility, but the biggest measurable opportunity is converting shopper activity into purchases',
      funnelLine,
      primaryOpportunity: 'Add to Cart → Purchase',
      explanation: `${fmtNum(current.addToCarts)} shoppers showed purchase interest by adding a product to cart, but ${current.purchases === 0 ? 'no order was completed' : 'comparatively few orders were completed'} during this period.`,
      implication: 'The immediate priority is converting existing shopper interest into purchases: not simply generating more impressions.'
    }
  }
  if (area === 'product-page-engagement') {
    return {
      severity: 'critical',
      headline: 'Shoppers are reaching your product pages, but a relatively small portion are adding items to cart',
      funnelLine,
      primaryOpportunity: 'Click → Add to Cart',
      explanation: `${fmtNum(current.clicks)} shoppers clicked into your products, but only ${fmtNum(current.addToCarts)} added anything to cart.`,
      implication: 'The immediate priority is improving what shoppers see once they reach the product page.'
    }
  }
  if (area === 'click-through') {
    return {
      severity: 'warning',
      headline: 'Your products are being shown, but a relatively small portion of shoppers are opening them',
      funnelLine,
      primaryOpportunity: 'Impression → Click',
      explanation: `${fmtNum(current.impressions)} shoppers saw your products, but only ${fmtNum(current.clicks)} clicked through.`,
      implication: 'The immediate priority is making listings more clickable before investing further in visibility.'
    }
  }
  if (area === 'returns') {
    return {
      severity: 'critical',
      headline: 'Returns are elevated for this period',
      funnelLine,
      primaryOpportunity: 'Return rate',
      explanation: `Return rate is running at ${fmtPct(current.returnRate)} this period.`,
      implication: 'Investigate whether catalog information, images, or product quality match what shoppers expect.'
    }
  }
  if (area === 'rating') {
    return {
      severity: 'warning',
      headline: 'Product ratings need attention',
      funnelLine,
      primaryOpportunity: 'Rating',
      explanation: `Average rating is ${current.rating !== null ? current.rating.toFixed(1) : 'N/A'} this period.`,
      implication: 'Investigate recent reviews for recurring product-quality or expectation issues.'
    }
  }
  // stock-recovery: inventory-age data suggests a recent stock-out; the
  // remaining possibility once none of the funnel/returns/rating branches
  // above matched.
  return {
    severity: 'warning',
    headline: 'Some products may still be recovering visibility after a recent stock-out',
    funnelLine,
    primaryOpportunity: 'Ranking recovery',
    explanation: 'Inventory-age data suggests at least one recently-restocked product has not yet regained its prior visibility.',
    implication: 'Monitor these products over the next reporting period rather than treating low visibility as a listing-quality problem.'
  }
}

// --- D/F. Funnel story + where shoppers are lost ---------------------------

export type FunnelStory = { severity: Severity; gapLine: string; explanation: string }

export function describeFunnelStory(accountDiagnoses: AreaDiagnosisSummary[]): FunnelStory {
  const topWeak = accountDiagnoses[0] ?? null
  const area = topWeak?.area ?? null

  if (area === 'purchase-conversion') {
    return {
      severity: 'critical',
      gapLine: 'Your largest measurable opportunity is Add to Cart → Purchase.',
      explanation: 'Shoppers are reaching your products and some are showing buying intent. The immediate opportunity is converting that intent into completed orders.'
    }
  }
  if (area === 'product-page-engagement') {
    return {
      severity: 'critical',
      gapLine: 'Your largest measurable opportunity is Click → Add to Cart.',
      explanation: 'Shoppers are opening your product pages, but a relatively small portion are adding anything to cart.'
    }
  }
  if (area === 'click-through') {
    return {
      severity: 'warning',
      gapLine: 'Your largest measurable opportunity is Impression → Click.',
      explanation: 'Shoppers are seeing your products, but a relatively small portion are choosing to open them.'
    }
  }
  return {
    severity: 'info',
    gapLine: 'No single funnel stage stands out as the primary opportunity this period.',
    explanation: 'Impressions, clicks, add-to-carts, and purchases are broadly proportionate to each other given the available data.'
  }
}

// --- E. What this means -----------------------------------------------

export type FunnelStageExplainer = { stage: string; explanation: string }

export function describeFunnelStages(current: AggregateSnapshot): FunnelStageExplainer[] {
  return [
    { stage: 'Visibility', explanation: 'Your products are being shown to shoppers.' },
    { stage: 'Engagement', explanation: 'Some of that visibility is turning into product visits.' },
    { stage: 'Purchase intent', explanation: 'Some visitors are showing buying intent by adding products to cart.' },
    {
      stage: 'Conversion',
      explanation:
        (current.purchases ?? 0) > 0
          ? 'Some of that intent is converting into completed purchases.'
          : 'The final purchase stage is where additional opportunity may exist.'
    }
  ]
}

// --- C. KPI change narrative (never a bare arrow) ---------------------

export type MetricNarrative = { label: string; value: string; changeLabel: string | null; explanation: string }

function direction(changePercent: number | null): 'up' | 'down' | 'flat' {
  if (changePercent === null || Math.abs(changePercent) < 1) return 'flat'
  return changePercent > 0 ? 'up' : 'down'
}

function pp(current: number | null, previous: number | null): string | null {
  if (current === null || previous === null) return null
  const delta = current - previous
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(2)} pp`
}

function pctChangeLabel(current: number | null, previous: number | null): string | null {
  if (current === null || previous === null || previous === 0) return null
  const changePercent = ((current - previous) / previous) * 100
  const sign = changePercent > 0 ? '+' : ''
  return `${sign}${changePercent.toFixed(1)}%`
}

export function describeWhatChanged(current: AggregateSnapshot, previous: AggregateSnapshot, trend: TrendResult): MetricNarrative[] {
  const impDir = direction(trend.impressions.changePercent)
  const clickDir = direction(trend.clicks.changePercent)
  const ctrDir = direction(trend.ctr.changePercent)
  const atcDir = direction(trend.addToCarts.changePercent)
  const purchDir = direction(trend.purchases.changePercent)
  const purchasesFollowedCtr = (current.purchases ?? 0) > (previous.purchases ?? 0)

  return [
    {
      label: 'Impressions',
      value: `${fmtNum(previous.impressions)} → ${fmtNum(current.impressions)}`,
      changeLabel: pctChangeLabel(current.impressions, previous.impressions),
      explanation:
        impDir === 'up'
          ? 'More shoppers saw your products than in the previous period.'
          : impDir === 'down'
            ? 'Fewer shoppers saw your products than in the previous period.'
            : 'Visibility was about the same as the previous period.'
    },
    {
      label: 'Clicks',
      value: `${fmtNum(previous.clicks)} → ${fmtNum(current.clicks)}`,
      changeLabel: pctChangeLabel(current.clicks, previous.clicks),
      explanation:
        clickDir === 'up'
          ? 'More shoppers reached your products than in the previous period.'
          : clickDir === 'down'
            ? 'Fewer shoppers reached your products than in the previous period.'
            : 'The number of shoppers reaching your products stayed about the same.'
    },
    {
      label: 'CTR',
      value: `${fmtPct(previous.ctr)} → ${fmtPct(current.ctr)}`,
      changeLabel: pp(current.ctr, previous.ctr),
      explanation:
        ctrDir === 'up'
          ? `Click-through rate increased.${purchasesFollowedCtr ? '' : ' This is a positive movement, but it has not yet translated into more purchases.'}`
          : ctrDir === 'down'
            ? 'Click-through rate declined relative to the previous period.'
            : 'Click-through rate stayed about the same.'
    },
    {
      label: 'Add to Carts',
      value: `${fmtNum(previous.addToCarts)} → ${fmtNum(current.addToCarts)}`,
      changeLabel: pctChangeLabel(current.addToCarts, previous.addToCarts),
      explanation:
        atcDir === 'up'
          ? 'More shoppers showed buying intent by adding your products to cart.'
          : atcDir === 'down'
            ? 'Fewer shoppers added your products to cart than the previous period.'
            : 'Add-to-cart activity stayed about the same.'
    },
    {
      label: 'Purchases',
      value: `${fmtNum(previous.purchases)} → ${fmtNum(current.purchases)}`,
      changeLabel: pctChangeLabel(current.purchases, previous.purchases),
      explanation:
        (current.purchases ?? 0) === 0 && (previous.purchases ?? 0) === 0
          ? 'No change in final conversion: purchases remained at zero.'
          : purchDir === 'up'
            ? 'More shoppers completed a purchase than in the previous period.'
            : purchDir === 'down'
              ? 'Fewer shoppers completed a purchase than in the previous period.'
              : 'Purchases stayed about the same.'
  }
  ]
}

// --- L. Historical intelligence (3+ reports) --------------------------

// Only fires with real evidence across 3+ real periods (§3: never
// pretend historical confidence that doesn't exist). Each branch is a
// genuine, data-checked combination of classified trends, not a single
// hardcoded string.
export function describeMultiPeriodStory(periods: PeriodGroup[]): string | null {
  if (periods.length < 3) return null
  const aggregates = periods.map((p) => aggregatePeriod(p))
  const ctrSeries = aggregates.map((a) => a.ctr)
  const purchasesSeries = aggregates.map((a) => a.purchases)
  const clicksSeries = aggregates.map((a) => a.clicks)
  const atcSeries = aggregates.map((a) => a.addToCarts)
  const impressionsSeries = aggregates.map((a) => a.impressions)

  const ctrTrend = classifyMetricTrend(ctrSeries)
  const purchasesTrend = classifyMetricTrend(purchasesSeries)
  const clicksTrend = classifyMetricTrend(clicksSeries)
  const atcTrend = classifyMetricTrend(atcSeries)
  const impressionsTrend = classifyMetricTrend(impressionsSeries)
  const purchasesAllZero = purchasesSeries.every((v) => (v ?? 0) === 0)

  if (impressionsTrend === 'improving' && purchasesAllZero && impressionsSeries.filter((v) => v !== null).length >= 3) {
    return `Visibility increased for ${periods.length} consecutive reports, but purchases remained broadly flat. This suggests the next priority should be improving conversion rather than simply increasing visibility.`
  }
  if (ctrTrend === 'improving' && purchasesAllZero) {
    return `Click-through rate improved across the last ${periods.length} reports, but purchases remained at zero. This suggests increasing clicks alone has not resolved the conversion opportunity.`
  }
  if (clicksTrend === 'improving' && atcTrend === 'improving' && purchasesAllZero) {
    return `Clicks and add-to-carts both increased over the last ${periods.length} reports, but purchases remained at zero. Shopper interest is improving, but the final purchase step remains the opportunity.`
  }
  if (impressionsTrend === 'declining' && ctrTrend === 'improving') {
    return 'You are receiving less traffic, but the traffic you do receive is engaging more. Before trying to increase traffic, focus on converting this higher-quality interest.'
  }
  if (purchasesTrend === 'improving') {
    return `Purchases improved across the last ${periods.length} reports: whatever changed recently appears to be working. Keep monitoring to confirm the trend holds.`
  }
  if (purchasesTrend === 'declining') {
    return `Purchases declined across the last ${periods.length} reports despite ${ctrTrend === 'improving' || clicksTrend === 'improving' ? 'improving traffic engagement' : 'stable traffic'}. This points to a growing purchase-conversion opportunity.`
  }
  return null
}

export type PersistentProblemNote = { area: Exclude<ProblemArea, null>; label: string; periodsPersistent: number }

// Surfaces problem areas present in the CURRENT period AND every prior
// available period: "persistent" per §3/§L, never claimed with fewer
// than 2 periods of actual evidence.
export function describePersistentProblems(diagnosesByPeriod: AreaDiagnosisSummary[][]): PersistentProblemNote[] {
  if (diagnosesByPeriod.length < 2) return []
  const currentAreas = new Set(diagnosesByPeriod[0].map((d) => d.area))
  const notes: PersistentProblemNote[] = []
  for (const area of currentAreas) {
    const presentEveryPeriod = diagnosesByPeriod.every((diagnoses) => diagnoses.some((d) => d.area === area))
    if (presentEveryPeriod) {
      notes.push({ area, label: AREA_META[area].title, periodsPersistent: diagnosesByPeriod.length })
    }
  }
  return notes
}

// --- F/E. "Where are you losing shoppers": numbered opportunity list ------

export type AttentionItem = {
  severity: Severity
  rank: number
  title: string
  headline: string
  priority: 'HIGH' | 'MEDIUM'
  investigate: string[]
}

const AREA_META: Record<Exclude<ProblemArea, null>, { title: string; priority: 'HIGH' | 'MEDIUM' }> = {
  'purchase-conversion': { title: 'Purchase conversion', priority: 'HIGH' },
  'product-page-engagement': { title: 'Product-page engagement', priority: 'MEDIUM' },
  'click-through': { title: 'Click-through', priority: 'MEDIUM' },
  returns: { title: 'Returns', priority: 'MEDIUM' },
  rating: { title: 'Product ratings', priority: 'MEDIUM' },
  'stock-recovery': { title: 'Ranking recovery', priority: 'MEDIUM' }
}

export function buildAttentionItems(accountDiagnoses: AreaDiagnosisSummary[], current: AggregateSnapshot): AttentionItem[] {
  const items: AttentionItem[] = []
  let rank = 1
  for (const d of accountDiagnoses) {
    const area = d.area
    const meta = AREA_META[area]
    let headline: string
    if (area === 'purchase-conversion') headline = `${fmtNum(current.addToCarts)} shoppers added products to cart, but ${fmtNum(current.purchases)} purchased.`
    else if (area === 'product-page-engagement') headline = `${fmtNum(current.clicks)} shoppers reached product pages, but only ${fmtNum(current.addToCarts)} added items to cart.`
    else if (area === 'click-through') headline = `${fmtNum(current.impressions)} shoppers saw these products, but only ${fmtNum(current.clicks)} clicked through.`
    else if (area === 'returns') headline = `Return rate is running at ${fmtPct(current.returnRate)} this period.`
    else if (area === 'rating') headline = `Average rating is ${current.rating !== null ? current.rating.toFixed(1) : 'N/A'} this period.`
    else headline = `Inventory-age data suggests at least ${d.affectedProductCount} recently-restocked ${pluralize(d.affectedProductCount, 'product')} may still be recovering visibility.`

    items.push({ severity: areaSeverity(area), rank, title: meta.title, headline, priority: meta.priority, investigate: INVESTIGATE_AREAS[area] })
    rank++
  }
  return items
}

// --- H. Top 3 Actions -------------------------------------------------

// Deliberately no `evidence` field here: full per-product evidence
// (impressions/clicks/carts/purchases) appears exactly once, in the
// Products to Work On First list. This section references the same
// products by ID only (§ no cross-section repetition).
export type TopAction = {
  severity: Severity
  rank: number
  title: string
  priority: 'HIGH' | 'MEDIUM'
  affectedProductCount: number
  productIds: string[]
  why: string
  investigate: string[]
  measureNext: string
}

export function buildTopActions(fixNow: ProductInsight[], optimize: ProductInsight[], scale: ProductInsight[]): TopAction[] {
  const actionable = [...fixNow, ...optimize]
  const byArea = new Map<Exclude<ProblemArea, null>, ProductInsight[]>()
  for (const p of actionable) {
    const area = p.topProblem?.area ?? null
    if (!area) continue
    const list = byArea.get(area) ?? []
    list.push(p)
    byArea.set(area, list)
  }

  const actions: TopAction[] = []

  const purchaseGroup = (byArea.get('purchase-conversion') ?? []).sort((a, b) => (b.current.impressions ?? 0) - (a.current.impressions ?? 0))
  if (purchaseGroup.length > 0) {
    actions.push({
      severity: 'critical',
      rank: actions.length + 1,
      title: 'Improve Purchase Conversion',
      priority: 'HIGH',
      affectedProductCount: purchaseGroup.length,
      productIds: purchaseGroup.slice(0, 5).map((p) => p.externalProductId),
      why: 'These products generated cart activity but comparatively few purchases.',
      investigate: INVESTIGATE_AREAS['purchase-conversion'],
      measureNext: 'Purchases and cart-to-purchase conversion.'
    })
  }

  const engagementGroup = (byArea.get('product-page-engagement') ?? []).sort((a, b) => (b.current.impressions ?? 0) - (a.current.impressions ?? 0))
  if (engagementGroup.length > 0 && actions.length < 3) {
    actions.push({
      severity: 'warning',
      rank: actions.length + 1,
      title: 'Improve Product-Page Engagement',
      priority: 'MEDIUM',
      affectedProductCount: engagementGroup.length,
      productIds: engagementGroup.slice(0, 5).map((p) => p.externalProductId),
      why: 'These products receive clicks but a relatively small portion result in cart activity.',
      investigate: INVESTIGATE_AREAS['product-page-engagement'],
      measureNext: 'Add-to-cart rate.'
    })
  }

  const visibilityGroup = (byArea.get('click-through') ?? []).sort((a, b) => (b.current.impressions ?? 0) - (a.current.impressions ?? 0))
  if (visibilityGroup.length > 0 && actions.length < 3) {
    actions.push({
      severity: 'warning',
      rank: actions.length + 1,
      title: 'Improve Click-Through',
      priority: 'MEDIUM',
      affectedProductCount: visibilityGroup.length,
      productIds: visibilityGroup.slice(0, 5).map((p) => p.externalProductId),
      why: 'These products have meaningful visibility but a relatively small portion of shoppers click through.',
      investigate: INVESTIGATE_AREAS['click-through'],
      measureNext: 'Clicks and click-through rate.'
    })
  }

  if (scale.length > 0 && actions.length < 3) {
    actions.push({
      severity: 'positive',
      rank: actions.length + 1,
      title: 'Study Your Strongest Products',
      priority: 'MEDIUM',
      affectedProductCount: scale.length,
      productIds: scale.slice(0, 5).map((p) => p.externalProductId),
      why: 'These products show the strongest purchase/engagement signals in this report.',
      investigate: [],
      measureNext: 'Whether the same pattern holds as you apply it to weaker products.'
    })
  }

  return actions
}

// --- Per-product "why we're prioritizing it" --------------------------------

export function describeWhyPrioritized(insight: ProductInsight): string {
  const c = insight.current
  const area = insight.topProblem?.area ?? null

  if (area === 'purchase-conversion') {
    return `This product already receives meaningful visibility and has generated ${fmtNum(c.addToCarts)} ${pluralize(c.addToCarts, 'add-to-cart')} from ${fmtNum(c.clicks)} clicks, but ${c.purchases === 0 ? 'no purchases' : 'very few purchases'}: one of the strongest existing purchase opportunities in this report.`
  }
  if (area === 'product-page-engagement') {
    return `This product is attracting ${fmtNum(c.clicks)} clicks, but only ${fmtNum(c.addToCarts)} ${pluralize(c.addToCarts, 'shopper is', 'shoppers are')} adding it to cart.`
  }
  if (area === 'click-through') {
    return `This product is being shown ${fmtNum(c.impressions)} times, but only ${fmtNum(c.clicks)} ${pluralize(c.clicks, 'shopper is', 'shoppers are')} clicking through.`
  }
  if (area === 'returns') {
    return `Return rate for this product is running at ${fmtPct(c.returnRate)} this period.`
  }
  if (area === 'rating') {
    return `Average rating for this product is ${c.rating !== null ? c.rating.toFixed(1) : 'N/A'} this period.`
  }
  if (area === 'stock-recovery') {
    return "This product's inventory-age data suggests a recent stock-out, and visibility remains low: marketplace ranking may not have fully recovered yet."
  }
  if (insight.priority === 'scale') {
    return `This product converted ${fmtNum(c.purchases)} ${pluralize(c.purchases, 'purchase')} from ${fmtNum(c.clicks)} clicks: one of the stronger signals in this report.`
  }
  // No area/topProblem at all (low-priority/insufficient activity): never
  // fall back to the raw diagnosis message, which may use language
  // ("healthy") this layer deliberately avoids everywhere else.
  return 'Not enough activity yet for a specific recommendation.'
}

function investigateFor(insight: ProductInsight): string[] {
  const area = insight.topProblem?.area ?? null
  return area ? INVESTIGATE_AREAS[area] : []
}

// --- Category / segment intelligence narrative --------------------------

export type SegmentNarrative = { dimension: SegmentDimension; sentence: string }

const DIMENSION_LABEL: Record<SegmentDimension, string> = { articleType: 'Article Type', brand: 'Brand', gender: 'Gender' }

// Surfaces at most the single most-deviating segment per dimension, and
// only when the deviation is large enough to matter (reuses the same
// significant-change threshold everywhere else in this codebase already
// applies, no new arbitrary number). Never claims causality: a
// descriptive comparison against this seller's own catalog average only.
export function describeSegmentInsights(insights: SegmentInsight[]): SegmentNarrative[] {
  const byDimension = new Map<SegmentDimension, SegmentInsight[]>()
  for (const insight of insights) {
    const list = byDimension.get(insight.dimension) ?? []
    list.push(insight)
    byDimension.set(insight.dimension, list)
  }

  const narratives: SegmentNarrative[] = []
  for (const [dimension, group] of byDimension) {
    const mostDeviating = [...group].sort((a, b) => Math.abs(b.ctrDeltaVsCatalog ?? 0) - Math.abs(a.ctrDeltaVsCatalog ?? 0))[0]
    if (!mostDeviating || mostDeviating.ctrDeltaVsCatalog === null) continue
    if (Math.abs(mostDeviating.ctrDeltaVsCatalog) < 0.2) continue // < 0.2pp CTR difference isn't material
    const direction = mostDeviating.ctrDeltaVsCatalog > 0 ? 'stronger' : 'weaker'
    const catalogCtr = mostDeviating.ctr !== null ? mostDeviating.ctr - mostDeviating.ctrDeltaVsCatalog : null
    narratives.push({
      dimension,
      sentence: `${mostDeviating.value} (${DIMENSION_LABEL[dimension]}, ${mostDeviating.productCount} products) shows ${direction} click engagement than the catalog average for this report (${fmtPct(mostDeviating.ctr)} vs ${fmtPct(catalogCtr)} catalog average).`
    })
  }
  return narratives
}

// --- M/N. Action plan (day/week phase, by problem area) ----------------

export type ActionPlanItem = { title: string; detail: string }
export type ActionPlanPhase = { label: string; items: ActionPlanItem[] }
export type ActionPlan = { fifteenDay: ActionPlanPhase[]; thirtyDay: ActionPlanPhase[] }

function productItem(p: ProductInsight): ActionPlanItem {
  return { title: `Style/ASIN ${p.externalProductId}`, detail: `${describeWhyPrioritized(p)} Investigate: ${investigateFor(p).join(', ')}.` }
}

// Organized by PROBLEM AREA (purchase-conversion, click-through,
// product-page-engagement), not by priority tier: a seller thinks "what
// kind of opportunity am I working this week," not "here's my fix-now
// list again." Every item still traces to a specific product; the
// measurement phases are process steps that genuinely have no single
// product to name yet.
export function generateActionPlan(productInsights: ProductInsight[]): ActionPlan {
  const actionable = productInsights.filter((p) => p.priority === 'fix-now' || p.priority === 'optimize')
  const byArea = (area: Exclude<ProblemArea, null>) =>
    actionable.filter((p) => p.topProblem?.area === area).sort((a, b) => (b.current.impressions ?? 0) - (a.current.impressions ?? 0))

  const purchaseGroup = byArea('purchase-conversion')
  const clickGroup = byArea('click-through')
  const pageGroup = byArea('product-page-engagement')
  const scaleGroup = productInsights.filter((p) => p.priority === 'scale')

  const emptyItem = (detail: string): ActionPlanItem[] => [{ title: 'No products currently match this focus', detail }]

  const fifteenDay: ActionPlanPhase[] = [
    {
      label: 'Days 1-3: Focus on high-intent products with cart activity but weak purchases',
      items: purchaseGroup.length > 0 ? purchaseGroup.slice(0, 5).map(productItem) : emptyItem('No products currently show add-to-carts or clicks without purchases.')
    },
    {
      label: 'Days 4-7: Improve high-click, low-cart products',
      items: pageGroup.length > 0 ? pageGroup.slice(0, 5).map(productItem) : emptyItem('No products currently show clicks without add-to-carts.')
    },
    {
      label: 'Days 8-10: Review high-impression, low-click products',
      items: clickGroup.length > 0 ? clickGroup.slice(0, 5).map(productItem) : emptyItem('No products currently show meaningful impressions without clicks.')
    },
    {
      label: 'Days 11-15: Measure the next report and reassess',
      items: [
        { title: 'Do not keep changing everything', detail: 'Upload and compare your next report before making further changes.' },
        { title: 'Which products improved?', detail: 'Check each product you changed against this baseline.' },
        { title: 'Did CTR improve?', detail: 'Compare against this period\'s click-through rate.' },
        { title: 'Did add-to-cart rate improve?', detail: 'Compare against this period\'s add-to-cart activity.' },
        { title: 'Did purchases improve?', detail: 'Compare against this period\'s purchase count.' },
        { title: 'Which action appears to have helped?', detail: 'Note which change preceded which improvement.' },
        { title: 'Which products should be deprioritized?', detail: 'Products with no response to changes may need a different approach or lower priority.' }
      ]
    }
  ]

  const thirtyDay: ActionPlanPhase[] = [
    {
      label: 'Week 1: Fix highest-intent products',
      items: purchaseGroup.length > 0 ? purchaseGroup.slice(0, 5).map(productItem) : emptyItem('No high-opportunity purchase-conversion problems identified.')
    },
    {
      label: 'Week 2: Improve engagement opportunities',
      items: [...pageGroup, ...clickGroup].length > 0 ? [...pageGroup, ...clickGroup].slice(0, 8).map(productItem) : emptyItem('No high-opportunity engagement/click problems identified.')
    },
    {
      label: 'Week 3: Apply learnings to similar products',
      items: [
        {
          title: 'Compare what changed',
          detail: 'Review which Week 1/2 changes preceded an improvement, and apply the same change to similar products that share the issue.'
        }
      ]
    },
    {
      label: 'Week 4: Measure and reprioritize',
      items:
        scaleGroup.length > 0
          ? scaleGroup.slice(0, 5).map((p) => ({ title: `Study Style/ASIN ${p.externalProductId}`, detail: describeWhyPrioritized(p) }))
          : emptyItem('No consistently strong, non-declining product identified yet.')
    }
  ]

  return { fifteenDay, thirtyDay }
}

// --- O. What to measure next --------------------------------------------

export function describeMeasurementPlan(topActions: TopAction[]): string[] {
  if (topActions.length === 0) {
    return ['Continue monitoring CTR, add-to-cart rate, and purchase conversion in your next report.']
  }
  return topActions.map((a) => `If "${a.title}" is working, we should see improvement in ${a.measureNext.toLowerCase()}`)
}

// --- Downloadable action report (14 sections, §11) --------------------------

export type ActionReportInput = {
  marketplaceLabel: string
  current: AggregateSnapshot
  previous: AggregateSnapshot | null
  periodsAvailable: number
  accountDiagnoses: AreaDiagnosisSummary[]
  trend: TrendResult | null
  productInsights: ProductInsight[]
  actionPlan: ActionPlan
  multiPeriodStory: string | null
  segmentNarratives: SegmentNarrative[]
}

// Assembles the 14-section seller-facing document: something that can
// actually be sent to a team, a cataloging agency, or a pricing team, not
// a raw export of database rows. Every sentence reuses the narrative
// functions above; no new calculation happens here.
export function buildActionReportText(input: ActionReportInput): string {
  const lines: string[] = []
  const push = (s = '') => lines.push(s)
  const rule = () => push('─'.repeat(60))
  const situation = describeSituation(input.current, input.accountDiagnoses)
  const funnel = describeFunnelStory(input.accountDiagnoses)
  const fixNow = topOpportunityProducts(input.productInsights, 'fix-now', 5)
  const optimize = topOpportunityProducts(input.productInsights, 'optimize', 10)
  const scale = input.productInsights.filter((p) => p.priority === 'scale')
  const dontPrioritize = input.productInsights.filter((p) => p.priority === 'low-priority')
  const cohortMap = buildCatalogOpportunityMap(input.productInsights)
  const topActions = buildTopActions(
    input.productInsights.filter((p) => p.priority === 'fix-now'),
    input.productInsights.filter((p) => p.priority === 'optimize'),
    scale
  )

  push('TESOLUTE')
  push(`${input.marketplaceLabel.toUpperCase()} PERFORMANCE INTELLIGENCE`)
  push(`Reporting period: ${input.current.periodStart} to ${input.current.periodEnd}`)
  push(`Reports analyzed: ${input.periodsAvailable}`)
  push(`Generated: ${new Date().toISOString().slice(0, 10)}`)
  push('')

  rule()
  push('1. EXECUTIVE SUMMARY')
  rule()
  push(situation.headline)
  push(situation.funnelLine)
  push(`Primary opportunity: ${situation.primaryOpportunity}`)
  push(situation.explanation)
  push(situation.implication)
  if (input.periodsAvailable === 1) push('This is your first performance snapshot. Future reports will show changes and trends.')
  push('')

  rule()
  push('2. CURRENT KPI SNAPSHOT')
  rule()
  push(`Products analyzed: ${fmtNum(input.current.productsAnalyzed)}`)
  push(`Impressions: ${fmtNum(input.current.impressions)}`)
  push(`Clicks: ${fmtNum(input.current.clicks)}`)
  push(`CTR: ${fmtPct(input.current.ctr)}`)
  push(`Add to carts: ${fmtNum(input.current.addToCarts)}`)
  push(`Cart rate: ${fmtPct(input.current.atcRate)}`)
  push(`Purchases: ${fmtNum(input.current.purchases)}`)
  push(`Purchase conversion: ${fmtPct(input.current.conversionRate)}`)
  push(`Return rate: ${fmtPct(input.current.returnRate)}`)
  push('')

  rule()
  push('3. CURRENT PERFORMANCE DIAGNOSIS')
  rule()
  push(funnel.gapLine)
  push(funnel.explanation)
  push('')

  rule()
  push('4. WHERE SHOPPERS ARE BEING LOST')
  rule()
  const attention = buildAttentionItems(input.accountDiagnoses, input.current)
  if (attention.length > 0) {
    for (const item of attention) {
      push(`${item.rank}. ${item.title} (Priority: ${item.priority})`)
      push(`  ${item.headline}`)
      push(`  Investigate: ${item.investigate.join(', ')}.`)
      push('')
    }
  } else {
    push('No significant funnel opportunity identified this period.')
    push('')
  }

  rule()
  push('5. WHAT CHANGED')
  rule()
  if (input.previous && input.trend) {
    for (const line of describeWhatChanged(input.current, input.previous, input.trend)) {
      push(`${line.label}: ${line.value}${line.changeLabel ? ` (${line.changeLabel})` : ''}`)
      push(`  ${line.explanation}`)
    }
  } else {
    push('Not enough history yet: upload another report to unlock a comparison.')
  }
  if (input.multiPeriodStory) {
    push('')
    push(input.multiPeriodStory)
  }
  push('')

  rule()
  push('6. CATALOG OPPORTUNITY MAP')
  rule()
  for (const row of cohortMap) {
    push(`${row.label}: ${row.count} products: ${row.description}`)
  }
  if (input.segmentNarratives.length > 0) {
    push('')
    for (const s of input.segmentNarratives) push(s.sentence)
  }
  push('')

  rule()
  push('7. TOP 3 PRIORITIES')
  rule()
  if (topActions.length > 0) {
    for (const a of topActions) {
      push(`${a.rank}. ${a.title} (Priority: ${a.priority}, ${a.affectedProductCount} products)`)
      push(`  Why: ${a.why}`)
      if (a.productIds.length > 0) push(`  See: ${a.productIds.join(', ')} (full evidence in section 8, Products to Work On First).`)
      if (a.investigate.length > 0) push(`  Investigate: ${a.investigate.join(', ')}.`)
      push(`  Measure next: ${a.measureNext}`)
      push('')
    }
  } else {
    push('No urgent priorities identified this period.')
    push('')
  }

  rule()
  push('8. PRODUCTS TO WORK ON FIRST')
  rule()
  if (fixNow.length > 0) {
    for (const p of fixNow) {
      push(`Style/ASIN ${p.externalProductId}`)
      push(`  ${describeWhyPrioritized(p)}`)
      push(`  Investigate: ${investigateFor(p).join(', ')}.`)
      push('')
    }
  } else {
    push('No high-priority products identified this period.')
    push('')
  }
  if (optimize.length > 0) {
    push('Additional products to optimize:')
    for (const p of optimize) push(`  Style/ASIN ${p.externalProductId}: ${describeWhyPrioritized(p)}`)
    push('')
  }

  rule()
  push('9. POSITIVE PERFORMERS')
  rule()
  if (scale.length > 0) {
    for (const p of scale) {
      push(`Style/ASIN ${p.externalProductId}: ${describeWhyPrioritized(p)}`)
    }
    push('Study what these products have in common before applying changes to weaker products.')
  } else {
    push('No clear positive performers identified yet.')
  }
  push('')

  rule()
  push('10. PRODUCTS NOT YET WORTH PRIORITIZING')
  rule()
  push(
    dontPrioritize.length > 0
      ? `${dontPrioritize.length} product(s) do not currently provide enough evidence for Tesolute to recommend significant optimization. Focus your effort on higher-opportunity products first.`
      : 'No products are currently deprioritized.'
  )
  push('')

  rule()
  push('11. 15-DAY ACTION PLAN')
  rule()
  for (const phase of input.actionPlan.fifteenDay) {
    push(phase.label)
    for (const item of phase.items) push(`  - ${item.title}: ${item.detail}`)
    push('')
  }

  rule()
  push('12. 30-DAY ACTION PLAN')
  rule()
  for (const phase of input.actionPlan.thirtyDay) {
    push(phase.label)
    for (const item of phase.items) push(`  - ${item.title}: ${item.detail}`)
    push('')
  }

  rule()
  push('13. WHAT TO MEASURE NEXT')
  rule()
  for (const line of describeMeasurementPlan(topActions)) push(line)
  push('')

  rule()
  push('14. DATA LIMITATIONS')
  rule()
  push('This report is based only on the Myntra Impress Report fields available: Style ID, Seller ID, Article Type, Brand, Gender,')
  push('Seller MRP, Inventory Age, RPLC, Impressions, Clicks, Add to Carts, Purchases, Return %, Consideration %, Conversion %, and Rating.')
  push('It does NOT have access to advertising performance, ad spend, ROAS, revenue, profit, exact pricing causality, competitor pricing,')
  push('inventory availability beyond what is reported, delivery data, or the exact reason any individual shopper did not purchase.')
  push('Where price, offer, availability, delivery, or trust are mentioned, they are areas to investigate: not confirmed causes.')

  return lines.join('\n')
}
