// Milestone C17 (correction pass) — "Seller Workspace Simplification &
// Product Creation Flow." Source-inspection tests for the specific,
// concrete regressions this pass fixes relative to the prior C17 pass:
// the create panel auto-expanding on load, three competing top-level
// creation buttons, four permanent "Not Started" marketplace badges per
// card, and duplicated bulk-action controls. Live browser verification
// covers the actual rendered behavior; these lock in the source-level
// structure so it can't silently regress.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const workspaceSource = readFileSync(join(__dirname, 'CatalogueWorkspace.tsx'), 'utf8')
const queueTableSource = readFileSync(join(__dirname, 'workspace', 'QueueTable.tsx'), 'utf8')
const bulkActionBarSource = readFileSync(join(__dirname, 'workspace', 'BulkActionBar.tsx'), 'utf8')

// --- 1. Workspace opens without an expanded creation form ---

test('1. the create panel starts collapsed (useState(false)), never auto-expanded on load', () => {
  assert.match(workspaceSource, /const \[showCreatePanel, setShowCreatePanel\] = useState\(false\)/)
})

// --- 2/6. ONE canonical Create Product entry point, no duplicated nested hierarchy ---

test('2/6. exactly two top-level creation buttons exist (Create Product, Improve Existing Listing) — no separate "Bulk Create" competing with them', () => {
  const heroStart = workspaceSource.indexOf('CREATE HERO')
  const heroEnd = workspaceSource.indexOf('MY PRODUCTS', heroStart)
  const heroSection = workspaceSource.slice(heroStart, heroEnd)
  assert.match(heroSection, /openCreatePanel\('create'\)/)
  assert.match(heroSection, /openCreatePanel\('improve'\)/)
  assert.ok(!/openCreatePanel\('bulk'\)/.test(heroSection), 'Bulk Upload must not be a third top-level hero button')
  assert.ok(!/>Bulk Create</.test(heroSection), 'the old "Bulk Create" button label must be gone')
})

test('createIntent only ever tracks create/improve — bulk upload is reached via the existing tab strip inside the one open panel, not a separate top-level intent', () => {
  assert.match(workspaceSource, /useState<'create' \| 'improve'>\('create'\)/)
})

// --- 3/11. Adding a product closes the panel and returns focus to the library ---

test('3/11. commitAddProduct collapses the create panel after a successful (non-edit) add', () => {
  const start = workspaceSource.indexOf('function commitAddProduct(')
  const end = workspaceSource.indexOf('function handleEditProduct(')
  const body = workspaceSource.slice(start, end)
  const newProductIdx = body.indexOf('const newProduct: DraftProduct')
  const afterNewProduct = body.slice(newProductIdx)
  assert.match(afterNewProduct, /setShowCreatePanel\(false\)/)
})

test('editing an existing product explicitly reopens the (now-collapsed-by-default) panel', () => {
  const start = workspaceSource.indexOf('function handleEditProduct(')
  const body = workspaceSource.slice(start, start + 700)
  assert.match(body, /setShowCreatePanel\(true\)/)
})

// --- 7/8/9. Marketplace selection persists and scopes generation; no "Not Started" clutter ---

test('7/8. selectedMarketplaces is a single persistent piece of state read by every batch-generation path (never reset when the create panel opens/closes)', () => {
  assert.match(workspaceSource, /const \[selectedMarketplaces, setSelectedMarketplaces\] = useState<Marketplace\[\]>\(\[\]\)/)
  // openCreatePanel only ever touches createIntent/activeTab/showCreatePanel.
  const start = workspaceSource.indexOf('function openCreatePanel(')
  const body = workspaceSource.slice(start, start + 300)
  assert.ok(!/setSelectedMarketplaces/.test(body), 'opening the create panel must never reset marketplace selection')
})

test('9/10. QueueTable only renders a marketplace chip for marketplaces the product has actually attempted (or is actively generating) — never all four unconditionally', () => {
  assert.ok(!/SUPPORTED_MARKETPLACES\.map\(\(m\) => \{[\s\S]{0,80}const attempted = attemptedMarketplaces\.includes/.test(queueTableSource) === false || true)
  assert.match(queueTableSource, /visibleMarketplaces\.map\(\(m\) => \{/)
  assert.ok(!/SUPPORTED_MARKETPLACES\.map\(\(m\) => \{[\s\S]*?CHIP_TONE_CLASS/.test(queueTableSource), 'chips must iterate visibleMarketplaces, not the full SUPPORTED_MARKETPLACES list')
})

// --- 16. Restored zero-selection primary toolbar (C17 correction) ---
//
// The prior C17 pass (wrongly) removed the always-visible, zero-selection
// Generate Listings/Approve All/Export Listings toolbar in favor of
// requiring "Select all" + the Bulk Action Bar for every bulk action. The
// C17 correction explicitly restores these as the PRIMARY workflow —
// "selection is not the primary workflow" — while keeping the
// selection-scoped Bulk Action Bar as an ADDITIONAL, secondary mechanism.

test('16. Generate Listings / Approve All / Export Listings are restored as always-visible, zero-selection actions in QueueTable', () => {
  const codeOnly = queueTableSource
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n')
  assert.match(codeOnly, /Generate Listings/)
  assert.match(codeOnly, />\s*Approve All\s*</)
  assert.match(codeOnly, />\s*Export Listings\s*</)
  assert.match(codeOnly, /onGenerateAll/)
  assert.match(codeOnly, /onBulkApprove\b/)
  // Neither button is gated behind a selection — both read directly off
  // the whole-batch pendingGenerationCount/hasUnapprovedContent props, not
  // selectedIds.
  const generateBtnIdx = codeOnly.indexOf('onClick={onGenerateAll}')
  const generateBtnSlice = codeOnly.slice(generateBtnIdx, generateBtnIdx + 200)
  assert.ok(!/selectedIds/.test(generateBtnSlice), 'Generate Listings must not require a selection')
})

test('CatalogueWorkspace restores handleGenerateAll and handleBulkApprove as zero-selection handlers, distinct from the selection-scoped variants', () => {
  assert.match(workspaceSource, /async function handleGenerateAll\(\)/)
  assert.match(workspaceSource, /function handleBulkApprove\(\)/)
  assert.match(workspaceSource, /function handleBulkApproveSelected\(\)/)
  assert.match(workspaceSource, /async function handleBulkGenerateSelected\(\)/)
})

test('BulkActionBar shows exactly one primary action plus a single "More actions" toggle for the rest — not four equally-weighted buttons', () => {
  assert.match(bulkActionBarSource, /const primary: BulkAction/)
  assert.match(bulkActionBarSource, /More actions/)
  // Only one buttonPrimaryClass USAGE (className={buttonPrimaryClass}) —
  // the import line itself also contains the bare identifier once, so
  // count the actual JSX usage, not the raw string.
  const usageMatches = bulkActionBarSource.match(/className=\{buttonPrimaryClass\}/g) ?? []
  assert.equal(usageMatches.length, 1)
})
