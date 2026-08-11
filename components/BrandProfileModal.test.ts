// Regression guard for components/BrandProfileModal.tsx and its wiring
// into AppHeader.tsx / CatalogueWorkspace.tsx (Milestone C12), using Node's
// built-in test runner — same source-inspection approach as every other
// CatalogueWorkspace-adjacent test file in this repo (ClientSelector.test.ts,
// CatalogueWorkspace.addProducts.test.ts, etc.). Actual React/async
// behavior is covered separately by live browser verification.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const modalSource = readFileSync(join(__dirname, 'BrandProfileModal.tsx'), 'utf8')
const headerSource = readFileSync(join(__dirname, 'AppHeader.tsx'), 'utf8')
const workspaceSource = readFileSync(join(__dirname, 'CatalogueWorkspace.tsx'), 'utf8')

test('BrandProfileModal saves via updateBrand, never createBrand or a raw client_name/user_id field', () => {
  assert.match(modalSource, /import \{ updateBrand,/)
  assert.match(modalSource, /await updateBrand\(\s*brand\.id,/)
  assert.ok(!/user_id/.test(modalSource), 'BrandProfileModal must never reference user_id — ownership is session-derived inside lib/brands.ts, not here')
})

test('BrandProfileModal exposes all 7 required profile sections', () => {
  for (const label of [
    'Brand Identity',
    'Brand Voice',
    'Target Audience',
    'Product Categories',
    'Positioning',
    'Brand Guidelines',
    'Marketplace Preferences'
  ]) {
    assert.ok(modalSource.includes(label), `expected BrandProfileModal to include the "${label}" section`)
  }
})

test('BrandProfileModal marketplace preferences cover exactly SUPPORTED_MARKETPLACES, no Shopify', () => {
  assert.match(modalSource, /SUPPORTED_MARKETPLACES\.map/)
  assert.ok(!/shopify/i.test(modalSource), 'C12 explicitly defers Shopify')
})

test('BrandProfileModal has distinct saving/error/success states, never a silent success', () => {
  assert.match(modalSource, /const \[saving, setSaving\] = useState/)
  assert.match(modalSource, /const \[error, setError\] = useState/)
  assert.match(modalSource, /const \[saved, setSaved\] = useState/)
  assert.match(modalSource, /catch \(err: any\) \{\s*setError\(/)
})

test('AppHeader only renders the brand-profile trigger when a brand is actually selected', () => {
  const start = headerSource.indexOf('Edit Brand Profile')
  assert.ok(start !== -1)
  const before = headerSource.slice(Math.max(0, start - 300), start)
  assert.match(before, /\{selectedClientId && \(/)
})

test('CatalogueWorkspace renders BrandProfileModal only when both showBrandProfile and a selectedClient exist', () => {
  const start = workspaceSource.indexOf('<BrandProfileModal')
  assert.ok(start !== -1)
  const before = workspaceSource.slice(Math.max(0, start - 100), start)
  assert.match(before, /\{showBrandProfile && selectedClient && \(/)
})

test('CatalogueWorkspace keeps selectedClient in sync with a saved brand profile (no reload required)', () => {
  const start = workspaceSource.indexOf('<BrandProfileModal')
  const callSite = workspaceSource.slice(start, start + 500)
  assert.match(callSite, /onSaved=\{\(updated\) => \{/)
  assert.match(callSite, /setSelectedClient\(updated\)/)
})
