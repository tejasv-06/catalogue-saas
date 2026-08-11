// Regression guard for Milestone 30 (C8)'s addition to
// components/CatalogueWorkspace.tsx, using Node's built-in test runner (no
// new dependency — tsx is already a project devDependency).
// Run with: npx tsx --test components/CatalogueWorkspace.addProducts.test.ts
//
// CatalogueWorkspace.tsx is a React component — its actual runtime behavior
// (state updates, async persistence, reconciliation) can't be unit-tested
// without a DOM/React-testing-library harness, which this repository
// deliberately doesn't have (same constraint as every other component test
// in this repo — see ClientSelector.test.ts). What CAN be tested without
// one: that the three intake call sites (Manual Entry, Photos Only — both
// share commitAddProduct — and CSV's commitCsvUpload) genuinely route
// through the existing, already-tested ensureServerProduct/createProduct
// path (see lib/catalog.test.ts for ownership/session coverage of
// createProduct itself), are gated on hasSession so guests stay local-only
// exactly as before this milestone, and that the call is fire-and-forget
// (never awaited into the add flow, matching persistGenerationToCatalog's
// established convention) so a persistence failure can never block adding a
// product locally. End-to-end proof that this actually creates real
// catalog_products rows live is covered separately by browser verification
// against the real database, not by this file.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(__dirname, 'CatalogueWorkspace.tsx'), 'utf8')

function bodyOf(fnSignature: string): string {
  const start = source.indexOf(fnSignature)
  assert.ok(start !== -1, `expected to find "${fnSignature}" in CatalogueWorkspace.tsx`)
  // Grab a generous window after the signature — enough to contain the
  // whole function body for every function this file inspects, without
  // needing a real brace-matching parser for a source-pattern check.
  return source.slice(start, start + 3000)
}

test('Manual Entry / Photos Only (commitAddProduct) creates the server-side product for authenticated users', () => {
  const body = bodyOf('function commitAddProduct(')
  assert.match(body, /if \(hasSession\)/)
  assert.match(body, /ensureServerProduct\(newProduct\)/)
})

test('CSV intake (commitCsvUpload) creates the server-side product for every row, for authenticated users', () => {
  const body = bodyOf('function commitCsvUpload(')
  assert.match(body, /if \(hasSession\)/)
  assert.match(body, /for \(const product of products\)/)
  assert.match(body, /ensureServerProduct\(product\)/)
})

test('both new call sites are fire-and-forget (void + .catch), never awaited into the add flow', () => {
  const addBody = bodyOf('function commitAddProduct(')
  const csvBody = bodyOf('function commitCsvUpload(')
  assert.match(addBody, /void ensureServerProduct\(newProduct\)\.catch\(/)
  assert.match(csvBody, /void ensureServerProduct\(product\)\.catch\(/)
})

test('neither new call site invents a second product-creation path — both reuse the one existing ensureServerProduct', () => {
  // ensureServerProduct itself must still be defined exactly once (Step C2,
  // unchanged) — this milestone must not have introduced a competing helper.
  const occurrences = source.split('async function ensureServerProduct(').length - 1
  assert.equal(occurrences, 1)
})

test('editing an existing product does not trigger a duplicate server-side create', () => {
  // commitAddProduct's editingId branch returns before newProduct is ever
  // constructed — the new ensureServerProduct call is only reachable in the
  // create branch. A crude but effective check: the call site appears after
  // `const newProduct: DraftProduct = {`, not before it.
  const body = bodyOf('function commitAddProduct(')
  const newProductIdx = body.indexOf('const newProduct: DraftProduct = {')
  const ensureCallIdx = body.indexOf('ensureServerProduct(newProduct)')
  assert.ok(newProductIdx !== -1 && ensureCallIdx !== -1 && ensureCallIdx > newProductIdx)
})
