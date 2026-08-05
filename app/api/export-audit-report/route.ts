import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle
} from 'docx'
import { NextResponse } from 'next/server'
import { isAccountReportStats } from '@/lib/accountReportStats'
import { isAccountInsights, type AccountInsights, type ActionPlanItem } from '@/lib/accountInsights'

// ---------------------------------------------------------------------------
// CHART-EMBEDDING DECISION (v1): charts are intentionally NOT rendered into
// this document. The dashboard's bar/scatter charts are live Recharts SVGs —
// turning them into a static image for docx embedding needs either (a)
// server-side chart rendering (a Node canvas/SVG renderer reproducing the
// same chart logic, kept in sync by hand with AccountReportDashboard.tsx) or
// (b) a headless-browser screenshot of the live dashboard (Playwright/
// Puppeteer), which is heavy to run inside a Next.js API route and fragile
// in a serverless deployment target. Neither is a small addition, so v1
// ships without charts and says so explicitly in the document (see the note
// paragraph below) rather than silently omitting them. If charts are wanted
// in the doc later, (b) is the more honest approach — it reuses the actual
// rendered chart rather than a hand-maintained reimplementation that can
// drift from what the dashboard shows.
// ---------------------------------------------------------------------------

const COLORS = {
  heading: '0F172A',
  brand: '2563EB',
  body: '334155',
  muted: '64748B',
  faint: '94A3B8',
  border: 'E2E8F0',
  white: 'FFFFFF'
}

function titleBlock(accountName: string, dateStr: string): Paragraph[] {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: 'Account Performance Audit', bold: true, size: 44, color: COLORS.heading })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [new TextRun({ text: accountName, bold: true, size: 28, color: COLORS.brand })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new TextRun({ text: dateStr, size: 20, color: COLORS.muted })]
    })
  ]
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    children: [new TextRun({ text, bold: true, color: COLORS.heading })]
  })
}

function subHeading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, bold: true, color: COLORS.brand })]
  })
}

function bodyParagraph(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 160 },
    children: [new TextRun({ text, color: COLORS.body })]
  })
}

function bulletParagraph(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 100 },
    children: [new TextRun({ text, color: COLORS.body })]
  })
}

function headerCell(text: string, widthPercent: number): TableCell {
  return new TableCell({
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
    shading: { fill: COLORS.brand },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: COLORS.white, size: 20 })] })]
  })
}

function bodyCell(text: string, widthPercent: number, opts: { bold?: boolean; center?: boolean } = {}): TableCell {
  return new TableCell({
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [
      new Paragraph({
        alignment: opts.center ? AlignmentType.CENTER : undefined,
        children: [new TextRun({ text, bold: opts.bold, color: COLORS.body, size: 20 })]
      })
    ]
  })
}

function actionPlanTable(items: ActionPlanItem[]): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: [headerCell('Priority', 12), headerCell('Action', 28), headerCell('Detail', 60)]
  })

  const rows = items.map(
    (item) =>
      new TableRow({
        children: [
          bodyCell(String(item.priority), 12, { bold: true, center: true }),
          bodyCell(item.title, 28, { bold: true }),
          bodyCell(item.detail, 60)
        ]
      })
  )

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...rows] })
}

function buildDocument(accountName: string, insights: AccountInsights, verificationWarnings: string[]): Document {
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const sortedActionPlan = [...insights.actionPlan].sort((a, b) => a.priority - b.priority)

  const children: (Paragraph | Table)[] = [...titleBlock(accountName, dateStr)]

  if (verificationWarnings.length > 0) {
    children.push(
      new Paragraph({
        spacing: { after: 240 },
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'FCD34D' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'FCD34D' } },
        children: [
          new TextRun({
            bold: true,
            color: '92400E',
            size: 18,
            text: `Note: ${verificationWarnings.length} figure${verificationWarnings.length === 1 ? '' : 's'} in this narrative couldn't be automatically matched against the verified stats (${verificationWarnings.join(', ')}). Review before sharing.`
          })
        ]
      })
    )
  }

  children.push(sectionHeading('Account Overview'))
  for (const point of insights.accountSnapshot) {
    children.push(bulletParagraph(point))
  }

  children.push(sectionHeading('What Is Going On'))
  children.push(subHeading('Revenue Concentration'))
  children.push(bodyParagraph(insights.keyOperationalFindings.revenueConcentration))
  children.push(subHeading('Conversion Bottleneck'))
  children.push(bodyParagraph(insights.keyOperationalFindings.conversionBottleneck))
  children.push(subHeading('Volatility'))
  children.push(bodyParagraph(insights.keyOperationalFindings.volatility))

  children.push(sectionHeading('30-Day Action Plan'))
  children.push(actionPlanTable(sortedActionPlan))

  children.push(sectionHeading('Overall Assessment'))
  children.push(bodyParagraph(insights.strategicSummary))

  children.push(
    new Paragraph({
      spacing: { before: 300 },
      children: [
        new TextRun({
          italics: true,
          color: COLORS.muted,
          size: 18,
          text: 'Charts and visual breakdowns (revenue concentration, traffic vs. conversion) are available in the live dashboard and are not included in this document.'
        })
      ]
    }),
    new Paragraph({
      spacing: { before: 200 },
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border } },
      children: [
        new TextRun({
          italics: true,
          color: COLORS.faint,
          size: 16,
          text: 'This report was written by AI from verified account data. Every figure above is sourced directly from the account performance report, not recalculated.'
        })
      ]
    })
  )

  return new Document({ sections: [{ properties: {}, children }] })
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { accountName, insights, stats, verificationWarnings } = body as {
    accountName?: string
    insights?: unknown
    stats?: unknown
    verificationWarnings?: unknown
  }

  if (!isAccountInsights(insights)) {
    return NextResponse.json(
      { error: 'Expected an already-generated narrative (insights) matching the AccountInsights shape.' },
      { status: 400 }
    )
  }

  if (!isAccountReportStats(stats)) {
    return NextResponse.json(
      { error: 'Expected the verified output of computeAccountReportStats, not raw CSV rows or another shape.' },
      { status: 400 }
    )
  }

  const resolvedAccountName = typeof accountName === 'string' && accountName.trim() ? accountName.trim() : '[Account Name]'
  const warnings = Array.isArray(verificationWarnings) ? verificationWarnings.filter((w): w is string => typeof w === 'string') : []

  const doc = buildDocument(resolvedAccountName, insights, warnings)
  const buffer = await Packer.toBuffer(doc)

  const fileSlug = resolvedAccountName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'account'

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${fileSlug}-audit-report.docx"`
    }
  })
}
