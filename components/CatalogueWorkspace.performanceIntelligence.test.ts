// Milestone C15 — migration structure, UI wiring, and cross-milestone
// regression-boundary tests. Same source-inspection approach as every
// other CatalogueWorkspace.*.test.ts file in this repo.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20260810_11_performance_intelligence.sql'), 'utf8')
const workspaceSource = readFileSync(join(__dirname, 'CatalogueWorkspace.tsx'), 'utf8')
const auditPageSource = readFileSync(join(__dirname, '..', 'app', 'audit', 'page.tsx'), 'utf8')
const marketplaceAdaptersSource = readFileSync(join(__dirname, '..', 'lib', 'marketplaceAdapters.ts'), 'utf8')
const accountReportStatsSource = readFileSync(join(__dirname, '..', 'lib', 'accountReportStats.ts'), 'utf8')
const accountAuditPanelSource = readFileSync(join(__dirname, 'reports', 'AccountAuditPanel.tsx'), 'utf8')

// --- 14. Append-only migration structure -------------------------------------

test('14. marketplace_performance has SELECT + INSERT policies only — no UPDATE/DELETE policy for any client role', () => {
  const start = migration.indexOf('create table if not exists marketplace_performance')
  const body = migration.slice(start)
  assert.match(body, /create policy "marketplace_performance_owner_select"/)
  assert.match(body, /create policy "marketplace_performance_owner_insert"/)
  assert.ok(!/create policy "marketplace_performance_owner_update"/.test(body))
  assert.ok(!/create policy "marketplace_performance_owner_delete"/.test(body))
})

test('the insert policy verifies both owner_user_id and product ownership via catalog_products — same pattern as C14\'s product_history_events', () => {
  const start = migration.indexOf('marketplace_performance_owner_insert')
  const body = migration.slice(start, start + 500)
  assert.match(body, /auth\.uid\(\) = owner_user_id/)
  assert.match(body, /exists\s*\(\s*select 1 from catalog_products/)
})

test('nullable metric columns have no NOT NULL constraint — missing data is representable, not forced to a default', () => {
  assert.ok(!/impressions integer not null/.test(migration))
  assert.ok(!/revenue numeric not null/.test(migration))
})

test('percentage/rating columns have real bounds checks — invalid data is rejected at the database layer too, not just in application code', () => {
  assert.match(migration, /return_rate >= 0 and return_rate <= 100/)
  assert.match(migration, /rating >= 0 and rating <= 5/)
})

test('catalog_product_external_ids is a plain mapping table (CAN be corrected) — unlike marketplace_performance, it legitimately has update/delete policies', () => {
  const start = migration.indexOf('create table if not exists catalog_product_external_ids')
  const end = migration.indexOf('create table if not exists marketplace_performance')
  const body = migration.slice(start, end)
  assert.match(body, /create policy "catalog_product_external_ids_owner_update"/)
  assert.match(body, /create policy "catalog_product_external_ids_owner_delete"/)
})

test('external id mapping is unique per (owner, marketplace, external_id) — the same Style ID/ASIN can never map to two different products for one seller', () => {
  assert.match(migration, /unique \(owner_user_id, marketplace, external_id\)/)
})

// --- §2/§20 marketplace scope: no fake Etsy/Flipkart adapters ---------------

test('the migration only permits amazon/myntra — etsy/flipkart/shopify are rejected by the CHECK constraint itself', () => {
  const marketplaceChecks = migration.match(/marketplace in \('amazon', 'myntra'\)/g) ?? []
  assert.ok(marketplaceChecks.length >= 2, 'both tables should constrain marketplace to exactly amazon/myntra')
  assert.ok(!/etsy|flipkart|shopify/i.test(migration))
})

// --- 12. UI wiring: drawer + import flow, no unnecessary navigation --------

test('ProductPerformance is mounted inside the existing GeneratedListingDrawer (product detail view) — no new top-level page', () => {
  assert.match(workspaceSource, /import ProductPerformance from '@\/components\/ProductPerformance'/)
  assert.match(workspaceSource, /<ProductPerformance productId=\{product\.serverId\} \/>/)
  const drawerStart = workspaceSource.indexOf('function GeneratedListingDrawer(')
  const performanceIdx = workspaceSource.indexOf('<ProductPerformance')
  assert.ok(drawerStart !== -1 && performanceIdx !== -1 && drawerStart < performanceIdx)
})

test('the performance report import flow lives inside the EXISTING /audit page as a tab, not a new top-level route', () => {
  assert.match(auditPageSource, /import AuditTabs from '@\/components\/reports\/AuditTabs'/)
  assert.match(auditPageSource, /<AuditTabs \/>/)
  assert.ok(!/<AccountAuditPanel/.test(auditPageSource), 'AccountAuditPanel should now be reached through AuditTabs, not rendered directly')
})

test('no new app/ route directory was created for performance import/reports', () => {
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const appDir = path.join(__dirname, '..', 'app')
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/performance/i.test(entry.name)) found.push(full)
    }
  }
  walk(appDir)
  assert.deepEqual(found, [])
})

// --- §19 Credit safety --------------------------------------------------------

test('19. AuditTabs/PerformanceImportPanel/PerformanceIntelligencePanel/ProductPerformance never import lib/credits.ts or call deductCredits/assertSufficientCredits', () => {
  for (const file of ['reports/AuditTabs.tsx', 'reports/PerformanceImportPanel.tsx', 'reports/PerformanceIntelligencePanel.tsx', 'ProductPerformance.tsx'] as const) {
    const source = readFileSync(join(__dirname, file), 'utf8')
    assert.ok(!/lib\/credits/.test(source), `${file} must not import lib/credits.ts`)
    assert.ok(!/deductCredits|assertSufficientCredits/.test(source), `${file} must not call credit deduction functions`)
  }
})

// --- §3 Amazon reuse, not rebuild --------------------------------------------

test('AccountAuditPanel.tsx (the existing Amazon report tool) is completely untouched by C15 — still renders standalone, still owns its own upload UI', () => {
  assert.match(accountAuditPanelSource, /export default function AccountAuditPanel\(\)/)
  assert.ok(!/performanceAdapters|performance\.ts|marketplace_performance/.test(accountAuditPanelSource))
})

test('lib/accountReportStats.ts (the existing Amazon CSV parser C15 reuses) is completely untouched — same exports, same behavior', () => {
  assert.match(accountReportStatsSource, /export function parseAccountReportRow/)
  assert.match(accountReportStatsSource, /export function computeAccountReportStats/)
  assert.match(accountReportStatsSource, /export function parseAmazonNumber/)
  assert.ok(!/performanceAdapters|marketplace_performance/.test(accountReportStatsSource))
})

// --- 30. C10 adapter regression: marketplace generation adapters untouched --

test('30. lib/marketplaceAdapters.ts (C10, listing generation) is untouched by C15 — no performance-related code leaked into it', () => {
  assert.match(marketplaceAdaptersSource, /export function getMarketplaceAdapter/)
  assert.ok(!/performance|PerformanceAdapter/i.test(marketplaceAdaptersSource))
})

// --- §20 architecture requirement: separate adapter registries -------------

test('performance adapters are a SEPARATE registry from C10\'s listing-generation adapters — getPerformanceAdapter is not getMarketplaceAdapter', () => {
  const performanceAdaptersSource = readFileSync(join(__dirname, '..', 'lib', 'performanceAdapters.ts'), 'utf8')
  assert.match(performanceAdaptersSource, /export function getPerformanceAdapter/)
  const codeOnly = performanceAdaptersSource
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n')
  assert.ok(!/getMarketplaceAdapter/.test(codeOnly), 'no real code (outside comments) should reference C10\'s getMarketplaceAdapter — the two registries must stay independent')
})

// --- C14 relationship: performance_imported fits the existing event architecture ---

test('performance_imported was added via a NEW migration extending C14\'s existing CHECK constraint, not by editing the original C14 migration file', () => {
  const originalC14Migration = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20260810_10_product_history.sql'), 'utf8')
  assert.ok(!/performance_imported/.test(originalC14Migration), 'the original C14 migration must remain exactly as C14 shipped it')
  const extensionMigration = readFileSync(
    join(__dirname, '..', 'supabase', 'migrations', '20260810_12_product_history_performance_event.sql'),
    'utf8'
  )
  assert.match(extensionMigration, /performance_imported/)
  assert.match(extensionMigration, /drop constraint if exists product_history_events_event_type_check/)
})

test('performance_imported is recorded only after every brand group\'s commitPerformanceImport call succeeds, one event per LINKED product, never per row — rows with no linked product record nothing', () => {
  const source = readFileSync(join(__dirname, 'reports', 'PerformanceImportPanel.tsx'), 'utf8')
  const commitIdx = source.indexOf('await commitPerformanceImport(marketplace, group.brand, group.records)')
  const uniqueIdx = source.indexOf('for (const productId of allProductIds)')
  const eventIdx = source.indexOf("eventType: 'performance_imported'")
  assert.ok(commitIdx !== -1 && uniqueIdx !== -1 && eventIdx !== -1)
  assert.ok(commitIdx < uniqueIdx && uniqueIdx < eventIdx)
})

// --- existsSync sanity: every C15 file this suite reads actually exists -----

test('every C15 file referenced by this test suite exists on disk', () => {
  for (const p of [
    join(__dirname, '..', 'supabase', 'migrations', '20260810_11_performance_intelligence.sql'),
    join(__dirname, '..', 'supabase', 'migrations', '20260810_12_product_history_performance_event.sql'),
    join(__dirname, '..', 'supabase', 'migrations', '20260810_13_performance_optional_product_link.sql'),
    join(__dirname, '..', 'lib', 'performanceAdapters.ts'),
    join(__dirname, '..', 'lib', 'performanceMetrics.ts'),
    join(__dirname, '..', 'lib', 'performanceDiagnosis.ts'),
    join(__dirname, '..', 'lib', 'performanceRecommendations.ts'),
    join(__dirname, '..', 'lib', 'performanceIntelligence.ts'),
    join(__dirname, '..', 'lib', 'performanceNarrative.ts'),
    join(__dirname, '..', 'lib', 'performance.ts'),
    join(__dirname, 'ProductPerformance.tsx'),
    join(__dirname, 'reports', 'PerformanceImportPanel.tsx'),
    join(__dirname, 'reports', 'PerformanceIntelligencePanel.tsx'),
    join(__dirname, 'reports', 'AuditTabs.tsx')
  ]) {
    assert.ok(existsSync(p), `expected ${p} to exist`)
  }
})

// --- Seller Performance Intelligence & Action Engine — UI wiring ------------

test('AuditTabs mounts PerformanceIntelligencePanel (not the bare import form) for the Performance Reports tab — the dashboard, not just upload, is the entry point once data exists', () => {
  const auditTabsSource = readFileSync(join(__dirname, 'reports', 'AuditTabs.tsx'), 'utf8')
  assert.match(auditTabsSource, /import PerformanceIntelligencePanel from '@\/components\/reports\/PerformanceIntelligencePanel'/)
  assert.match(auditTabsSource, /<PerformanceIntelligencePanel \/>/)
})

test('PerformanceIntelligencePanel renders the existing PerformanceImportPanel for the actual upload — it never duplicates parse/matching/import logic itself', () => {
  const source = readFileSync(join(__dirname, 'reports', 'PerformanceIntelligencePanel.tsx'), 'utf8')
  assert.match(source, /import PerformanceImportPanel from '.\/PerformanceImportPanel'/)
  assert.match(source, /<PerformanceImportPanel onImported=/)
  assert.ok(!/Papa\.parse|adapter\.parseRows/.test(source), 'parsing must stay exclusively in PerformanceImportPanel.tsx')
})

test('PerformanceIntelligencePanel does no calculation itself — every number/diagnosis/recommendation comes from lib/performanceIntelligence.ts', () => {
  const source = readFileSync(join(__dirname, 'reports', 'PerformanceIntelligencePanel.tsx'), 'utf8')
  assert.match(source, /from '@\/lib\/performanceIntelligence'/)
  assert.ok(!/diagnosePerformance|computeTrend|computeCtr|computeAtcRate|computeConversionRate/.test(source), 'must reuse the intelligence layer\'s own exports, never call the lower-level engines directly and duplicate logic')
})

test('the dashboard shows the plain import flow (no dashboard chrome) when NO marketplace has any data yet — first-time sellers see upload, not an empty dashboard', () => {
  const source = readFileSync(join(__dirname, 'reports', 'PerformanceIntelligencePanel.tsx'), 'utf8')
  assert.match(source, /if \(!anyDataAnywhere\) \{\s*\n\s*return <PerformanceImportPanel/)
})

test('Download Action Report calls buildActionReportText and triggers a real client-side file download — never a raw database export', () => {
  const source = readFileSync(join(__dirname, 'reports', 'PerformanceIntelligencePanel.tsx'), 'utf8')
  assert.match(source, /buildActionReportText\(/)
  assert.match(source, /downloadTextFile\(/)
  assert.ok(!/\.from\('marketplace_performance'\)\.select\(/.test(source), 'the panel must not query raw rows for export — it downloads the already-computed report text')
})

// --- Dashboard "Close" — a view-state toggle, never a data deletion --------

test('the dashboard has a Close control that dismisses the view and returns to the upload form, without deleting any data', () => {
  const source = readFileSync(join(__dirname, 'reports', 'PerformanceIntelligencePanel.tsx'), 'utf8')
  assert.match(source, /const \[dismissed, setDismissed\] = useState\(false\)/)
  assert.match(source, /onClick=\{onClose\}/)
  assert.match(source, /if \(dismissed\) \{/)
  // "Close" must never touch the database — it's a client-side toggle only.
  const closeButtonIdx = source.indexOf('onClick={onClose}')
  const nearbyBody = source.slice(Math.max(0, closeButtonIdx - 200), closeButtonIdx + 200)
  assert.ok(!/\.delete\(\)|\.from\('marketplace_performance'\)/.test(nearbyBody))
})

test('closing the dashboard and then completing a new import automatically un-dismisses it — handleImported resets both showUpload and dismissed', () => {
  const source = readFileSync(join(__dirname, 'reports', 'PerformanceIntelligencePanel.tsx'), 'utf8')
  const start = source.indexOf('async function handleImported(')
  const end = source.indexOf('\n  }', start)
  const body = source.slice(start, end)
  assert.match(body, /setShowUpload\(false\)/)
  assert.match(body, /setDismissed\(false\)/)
})
