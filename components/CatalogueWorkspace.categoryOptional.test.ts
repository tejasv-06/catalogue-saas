// Regression guard: Category is optional in Manual Entry: only Brand Name
// and Description are required to Add Product. Same source-inspection
// approach as every other CatalogueWorkspace.*.test.ts file in this repo
// (no DOM/React-testing-library harness exists).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(__dirname, 'CatalogueWorkspace.tsx'), 'utf8')
const leftPanelSource = readFileSync(join(__dirname, 'workspace', 'LeftPanel.tsx'), 'utf8')
const imageOnlyPanelSource = readFileSync(join(__dirname, 'workspace', 'ImageOnlyPanel.tsx'), 'utf8')

function bodyOf(src: string, fnSignature: string, window = 800): string {
  const start = src.indexOf(fnSignature)
  assert.ok(start !== -1, `expected to find "${fnSignature}"`)
  return src.slice(start, start + window)
}

test('handleAddProduct no longer requires category.trim(): only brandName and description', () => {
  const body = bodyOf(source, 'async function handleAddProduct() {')
  assert.match(body, /if \(!brandName\.trim\(\) \|\| !description\.trim\(\)\) \{/)
  assert.ok(!/!category\.trim\(\)/.test(body), 'handleAddProduct must not gate on category')
  assert.match(body, /Brand Name and Description are required/)
})

test('the old "Category missing" warning is gone: it contradicted the field now being labeled optional', () => {
  assert.ok(!/Category missing/.test(leftPanelSource))
})

test('the Category input is labeled optional', () => {
  assert.match(leftPanelSource, /placeholder="Category \(optional\)"/)
})

test('Photos Only also has no leftover "Category missing" warning: its category field is optional too', () => {
  assert.ok(!/Category missing/.test(imageOnlyPanelSource))
  assert.match(imageOnlyPanelSource, /placeholder="Category \(optional\)"/)
})

test('a product can still be added with an empty category (category persists as empty string, not required truthy)', () => {
  // commitAddProduct writes `category` verbatim from state, no truthiness
  // gate re-added anywhere in the create path.
  const body = bodyOf(source, 'function commitAddProduct(', 3200)
  assert.match(body, /category,\s*\r?\n\s*imageFile: null,/)
})

// --- Bulk Upload (CSV): category was already optional here; this locks it
// in against a future regression rather than fixing anything broken. ---

test('CSV bulk upload only skips a row for a missing Brand or Description: category is never part of the skip condition', () => {
  const body = bodyOf(source, "async function handleUploadCsv() {", 2200)
  assert.match(body, /if \(!brand \|\| !rowDescription\) \{/)
  assert.ok(!/!category/.test(body), 'a CSV row must never be skipped for a missing/empty category')
})

test('a CSV row with no category value still gets a real product with category defaulting to empty string, not skipped or null', () => {
  const body = bodyOf(source, "async function handleUploadCsv() {", 2800)
  assert.match(body, /category: pick\(row, 'category'\) \|\| ''/)
})
