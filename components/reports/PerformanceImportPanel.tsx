"use client"

import { useState, type ChangeEvent } from 'react'
import Papa from 'papaparse'
import {
  getPerformanceAdapter,
  groupRecordsByReportBrand,
  PERFORMANCE_MARKETPLACES,
  PERFORMANCE_MARKETPLACE_LABELS,
  type PerformanceMarketplace,
  type PerformancePeriodType,
  type CanonicalPerformanceRecord,
  type PerformanceImportRowResult,
  type PreviewValues,
  type BrandGroup
} from '@/lib/performanceAdapters'
import { commitPerformanceImport } from '@/lib/performance'
import { recordProductHistoryEvent } from '@/lib/productHistory'
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  selectClass,
  inputClass,
  cardClass,
  bodyTextClass,
  labelClass,
  dangerBannerClass,
  dangerTextClass
} from '@/lib/uiClasses'

// Milestone C15 — §14 Report Import UX. New tab inside the existing
// /audit page (Account Audit's own established home for report-upload
// tools) — no new top-level navigation. Client-side parse/preview
// (Papa.parse, same convention as components/reports/AccountAuditPanel.tsx
// and CatalogueWorkspace.tsx's own CSV product-intake tab), nothing
// persisted until the seller explicitly confirms.
//
// FINAL ARCHITECTURE CORRECTION — this is a marketplace performance
// REPORT IMPORT, not a catalog-product-matching tool. The uploaded report
// already IS the source of truth for every field in it (Style ID, Brand,
// Article Type, every metric — see lib/performanceAdapters.ts's
// previewColumns/parseRows). Importing a valid row never requires the
// seller to identify, confirm, or select anything Tesolute could already
// read straight off the file. There is no "Product Match" column, no
// dropdown, no matched/unmatched gate on Confirm Import — every valid row
// imports. Catalog linkage (Style ID/ASIN -> a Tesolute product) is a
// separate, OPTIONAL enrichment the seller can set up on a product's own
// page (components/ProductMarketplaceIds.tsx, lib/performance.ts's
// setProductExternalId) before or after any report import — never a
// precondition for it. commitPerformanceImport looks up any existing
// mapping opportunistically and leaves product_id null otherwise
// (migration 20260810_13 made that column optional for exactly this).

type PreviewRowState =
  | { kind: 'valid'; record: CanonicalPerformanceRecord; previewValues: PreviewValues }
  | { kind: 'invalid'; reason: string; previewValues: PreviewValues }

// Large report performance — a report can have hundreds or thousands of
// rows. The DOM only ever renders this many; the full parsed dataset
// stays in previewRows state and is what Confirm Import actually sends to
// commitPerformanceImport — this constant only slices what gets RENDERED,
// never what gets processed.
const PREVIEW_LIMIT = 15

// Every filter starts genuinely blank on every fresh mount (page load,
// refresh, or switching back to this tab — AuditTabs unmounts this
// component when its tab isn't active, so a remount already means a
// brand-new instance of this state). There is no localStorage/
// sessionStorage/URL persistence anywhere in this file to remove.
export default function PerformanceImportPanel({
  onImported
}: { onImported?: (marketplace: PerformanceMarketplace, brands: (string | null)[]) => void } = {}) {
  const [step, setStep] = useState<'setup' | 'preview' | 'done'>('setup')
  const [marketplace, setMarketplace] = useState<PerformanceMarketplace | ''>('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [periodType, setPeriodType] = useState<PerformancePeriodType | ''>('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewRows, setPreviewRows] = useState<PreviewRowState[]>([])
  // Derived from the report's own Brand column (never typed by hand) —
  // computed once at parse time so the "this file has N brands" notice is
  // visible during preview, before Confirm Import ever runs.
  const [brandGroups, setBrandGroups] = useState<BrandGroup[]>([])
  const [importing, setImporting] = useState(false)
  const [importSummary, setImportSummary] = useState<{ imported: number; skipped: number; brandCount: number } | null>(null)

  const adapter = marketplace ? getPerformanceAdapter(marketplace) : undefined
  const canUpload = marketplace !== '' && periodType !== '' && periodStart !== '' && periodEnd !== ''

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setError(null)

    if (!marketplace || !periodType || !periodStart || !periodEnd) {
      setError('Select a marketplace, and set a period type and period start/end date, before uploading.')
      return
    }
    if (!adapter) {
      setError(`No performance adapter for "${marketplace}".`)
      return
    }

    setFileName(file.name)

    const csvText = await file.text()
    const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })
    if (parsed.data.length === 0) {
      setError('No rows found in this file.')
      return
    }

    // Parsing/validation only — no matching lookup, no catalog fetch. A
    // row's validity depends only on the report's own data (does it have
    // a Style ID, are its counts/percentages in bounds), never on whether
    // any Tesolute product has been linked to it yet.
    const results: PerformanceImportRowResult[] = adapter.parseRows(parsed.data, { periodStart, periodEnd, periodType })
    const combined: PreviewRowState[] = results.map((r) =>
      r.status === 'invalid'
        ? { kind: 'invalid', reason: r.reason, previewValues: r.previewValues }
        : { kind: 'valid', record: r.record, previewValues: r.previewValues }
    )

    const validRecords = combined
      .filter((r): r is Extract<PreviewRowState, { kind: 'valid' }> => r.kind === 'valid')
      .map((r) => r.record)
    setBrandGroups(groupRecordsByReportBrand(validRecords))
    setPreviewRows(combined)
    setStep('preview')
  }

  // The ONLY place row count is limited — rendering. previewRows itself
  // (and Confirm Import below) always sees the complete dataset.
  const visibleRows = previewRows.slice(0, PREVIEW_LIMIT)
  const validCount = previewRows.filter((r) => r.kind === 'valid').length
  const invalidCount = previewRows.filter((r) => r.kind === 'invalid').length

  async function handleConfirmImport() {
    // Reachable only from the 'preview' step, which handleFileChange only
    // enters after confirming marketplace/period are set — this guard
    // just lets TypeScript narrow PerformanceMarketplace | '' down to
    // PerformanceMarketplace for the call below, not a real runtime case.
    if (!marketplace) return

    const validRecords = previewRows.filter((r): r is Extract<PreviewRowState, { kind: 'valid' }> => r.kind === 'valid').map((r) => r.record)

    if (validRecords.length === 0) {
      setError('No valid rows to import.')
      return
    }

    // Never blend different brands' reports into one dataset — one commit
    // per detected brand group, so two brands sharing one uploaded file
    // become two separately-scoped historical snapshots, not one blended
    // catalog. groupRecordsByReportBrand is recomputed here (not just
    // read from state) so Confirm Import can never drift from exactly the
    // valid rows it's about to send.
    const groups = groupRecordsByReportBrand(validRecords)

    setImporting(true)
    setError(null)
    let committedGroups = 0
    try {
      const allProductIds = new Set<string>()
      for (const group of groups) {
        const result = await commitPerformanceImport(marketplace, group.brand, group.records)
        committedGroups++
        for (const row of result.inserted) {
          if (row.product_id) allProductIds.add(row.product_id)
        }
      }

      // Milestone C14 relationship (§18) — one performance_imported event
      // per product this import actually linked (product_id came back
      // non-null), only after every group has fully committed. Rows with
      // no linked product yet have nothing to attach history to, so
      // they're skipped here, not treated as an error. Fire-and-forget,
      // same convention as every other history call: a logging failure
      // here must never undo an already-successful import.
      for (const productId of allProductIds) {
        void recordProductHistoryEvent({
          productId,
          eventType: 'performance_imported',
          marketplace,
          metadata: { source: marketplace === 'myntra' ? 'myntra_impress_report' : 'amazon_business_report' }
        }).catch((err: any) => {
          console.error(`Product history: failed to record performance_imported for ${productId}:`, err?.message ?? err)
        })
      }

      setImportSummary({ imported: validRecords.length, skipped: previewRows.length - validRecords.length, brandCount: groups.length })
      setStep('done')
      onImported?.(
        marketplace,
        groups.map((g) => g.brand)
      )
    } catch (err: any) {
      const progress = groups.length > 1 ? ` ${committedGroups} of ${groups.length} brand dataset(s) were imported before this error.` : ''
      setError(`Import failed: ${err?.message ?? err}.${progress}`)
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setStep('setup')
    setFileName(null)
    setError(null)
    setPreviewRows([])
    setBrandGroups([])
    setImportSummary(null)
    setMarketplace('')
    setPeriodType('')
    setPeriodStart('')
    setPeriodEnd('')
  }

  const cellBase = 'px-3 py-1.5 border-r border-b border-[var(--card-border)] whitespace-nowrap overflow-hidden text-ellipsis'
  const stickyBg = 'bg-[var(--card-bg)]'

  return (
    <div className="flex flex-col gap-6">
      {step === 'setup' && (
        <div className={`p-6 flex flex-col gap-4 ${cardClass}`}>
          <p className={bodyTextClass}>
            Import a marketplace performance report (Amazon Business Report or Myntra Impress report) to see product-level
            impressions, clicks, conversion, and diagnosis inside each product. Brand scoping is read automatically from the
            report's own Brand column — no need to select it here.
          </p>

          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1">
              <label className={labelClass}>Marketplace</label>
              <select
                value={marketplace}
                onChange={(e) => setMarketplace(e.target.value as PerformanceMarketplace | '')}
                className={selectClass}
              >
                <option value="">Select marketplace</option>
                {PERFORMANCE_MARKETPLACES.map((m) => (
                  <option key={m} value={m}>
                    {PERFORMANCE_MARKETPLACE_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className={labelClass}>Period type</label>
              <select
                value={periodType}
                onChange={(e) => setPeriodType(e.target.value as PerformancePeriodType | '')}
                className={selectClass}
              >
                <option value="">Select period type</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className={labelClass}>Period start</label>
              <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className={inputClass} />
            </div>

            <div className="flex flex-col gap-1">
              <label className={labelClass}>Period end</label>
              <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={inputClass} />
            </div>
          </div>

          {/* The file picker itself is never disabled — parsing needs
              marketplace/period, but choosing a file shouldn't be blocked
              on that. If the seller picks a file before those are set,
              handleFileChange's own guard below surfaces a clear error
              (rendered just below, shared across steps) instead of the
              click silently doing nothing. */}
          <label className={`inline-flex items-center justify-center shrink-0 self-start cursor-pointer ${buttonPrimaryClass}`}>
            Upload report
            <input type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
          </label>
          {!canUpload && (
            <p className="text-xs text-[var(--muted-text)]">Select a marketplace, and set a period type and period start/end date, before uploading.</p>
          )}
          {fileName && <span className={bodyTextClass}>{fileName}</span>}
        </div>
      )}

      {/* Shared across every step — handleFileChange can set an error
          while still on 'setup' (e.g. picked a file before marketplace/
          period were set), and that must never be silently invisible. */}
      {error && (
        <div className={dangerBannerClass}>
          <p className={dangerTextClass}>{error}</p>
        </div>
      )}

      {step === 'preview' && adapter && (
        <div className={`p-6 flex flex-col gap-4 ${cardClass}`}>
          {/* Informational only — never a gate on Confirm Import. Every
              valid row imports regardless of these counts. */}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-[var(--body-text)]">{previewRows.length} rows detected</span>
            <span className="text-[var(--success-text)]">{validCount} valid</span>
            <span className="text-[var(--muted-text)]">{invalidCount} invalid</span>
          </div>

          <p className="text-xs text-[var(--muted-text)]">
            {previewRows.length > PREVIEW_LIMIT
              ? `Preview — first ${PREVIEW_LIMIT} of ${previewRows.length} rows`
              : `Showing ${previewRows.length} of ${previewRows.length} rows`}
          </p>

          {/* Brand scoping is read from the report's own Brand column —
              never merged silently. A single brand (or no Brand column at
              all, e.g. Amazon's report) gets a quiet confirmation line; two
              or more distinct brands in one file get an explicit notice
              before Confirm Import ever runs, since it will commit each as
              its own separately-scoped historical snapshot. */}
          {brandGroups.length > 1 ? (
            <p className="text-xs text-[var(--warn-text)]">
              This file contains {brandGroups.length} brands:{' '}
              {brandGroups.map((g) => g.brand ?? 'Unspecified').join(', ')} — importing as {brandGroups.length} separate datasets, one
              per brand.
            </p>
          ) : (
            <p className="text-xs text-[var(--muted-text)]">
              Brand: {brandGroups[0]?.brand ?? 'Unspecified (this report format has no Brand column)'}
            </p>
          )}

          {/* The report itself — a real, sticky-header, horizontally AND
              vertically scrollable spreadsheet, not cards, and not a
              matching interface. Every column here comes straight from
              the uploaded file's own columns (adapter.previewColumns) —
              no extra Tesolute-owned column is appended. Internal scroll
              container (max-h + overflow-auto) so this never breaks the
              page's own layout regardless of row count. */}
          <div
            className="themed-scrollbar border border-[var(--card-border)] rounded-xl overflow-auto max-h-[32rem]"
            data-testid="performance-import-table-scroll"
          >
            <table className="border-collapse text-xs" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  {adapter.previewColumns.map((col, colIndex) => (
                    <th
                      key={col.key}
                      className={`${cellBase} ${stickyBg} sticky top-0 font-semibold text-[var(--heading-text)] ${col.align === 'right' ? 'text-right' : 'text-left'} ${colIndex === 0 ? 'sticky left-0 z-30' : 'z-20'}`}
                      style={{ width: col.width, minWidth: col.width }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, i) => {
                  const accent = row.kind === 'invalid' ? 'border-l-4 border-l-[var(--danger-border)]' : ''
                  return (
                    <tr key={i}>
                      {adapter.previewColumns.map((col, colIndex) => (
                        <td
                          key={col.key}
                          className={`${cellBase} ${col.align === 'right' ? 'text-right' : 'text-left'} text-[var(--body-text)] ${
                            colIndex === 0 ? `sticky left-0 z-10 ${stickyBg} ${accent}` : ''
                          }`}
                          style={{ width: col.width, minWidth: col.width }}
                          title={colIndex === 0 && row.kind === 'invalid' ? `Invalid: ${row.reason}` : row.previewValues[col.key]}
                        >
                          {row.previewValues[col.key]}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2">
            <button onClick={handleConfirmImport} disabled={importing || validCount === 0} className={buttonPrimaryClass}>
              {importing ? 'Importing…' : 'Import Performance Report'}
            </button>
            <button onClick={reset} disabled={importing} className={buttonSecondaryClass}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'done' && importSummary && (
        <div className={`p-6 flex flex-col gap-3 ${cardClass}`}>
          <p className="text-sm text-[var(--success-text)]">
            ✓ Imported {importSummary.imported} row{importSummary.imported === 1 ? '' : 's'}
            {importSummary.brandCount > 1 ? ` across ${importSummary.brandCount} separately-scoped brand datasets` : ''} as a new
            historical snapshot.
            {importSummary.skipped > 0 && ` ${importSummary.skipped} row(s) were invalid and not imported.`}
          </p>
          <button onClick={reset} className={buttonSecondaryClass}>
            Import another report
          </button>
        </div>
      )}
    </div>
  )
}
