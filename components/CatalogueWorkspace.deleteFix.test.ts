// Milestone C17 — regression guard for the confirmed delete-doesn't-persist
// bug (a deleted product reappeared after refresh because the old
// handleDeleteProduct never called any server-side delete). Same
// source-inspection approach as the other CatalogueWorkspace.*.test.ts
// files; the real end-to-end behavior (delete -> reload -> stays gone) is
// covered separately by live browser verification.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const workspaceSource = readFileSync(join(__dirname, 'CatalogueWorkspace.tsx'), 'utf8')
const catalogSource = readFileSync(join(__dirname, '..', 'lib', 'catalog.ts'), 'utf8')

function bodyOf(fnSignature: string, window = 1500): string {
  const start = workspaceSource.indexOf(fnSignature)
  assert.ok(start !== -1, `expected to find "${fnSignature}" in CatalogueWorkspace.tsx`)
  return workspaceSource.slice(start, start + window)
}

test('lib/catalog.ts exports a real deleteProduct that issues a DELETE, not an update/soft-delete flag', () => {
  const start = catalogSource.indexOf('export async function deleteProduct(')
  assert.ok(start !== -1, 'expected lib/catalog.ts to export deleteProduct')
  const body = catalogSource.slice(start, start + 500)
  assert.match(body, /\.from\('catalog_products'\)\s*\.delete\(\)/)
  assert.match(body, /\.eq\('id', productId\)/)
})

test("deleteProduct throws (rather than silently no-oping) when the delete's own .select() reports zero affected rows", () => {
  const start = catalogSource.indexOf('export async function deleteProduct(')
  const body = catalogSource.slice(start, start + 700)
  assert.match(body, /data\.length === 0/)
  assert.match(body, /throw new Error/)
})

test('handleDeleteProduct calls the real server-side deleteProduct for a persisted (authenticated) product', () => {
  const body = bodyOf('async function handleDeleteProduct(id: string)', 1400)
  assert.match(body, /await deleteProduct\(product\.serverId\)/)
})

test('handleDeleteProduct only removes the product from local state AFTER the server delete resolves (or for a product with nothing to delete server-side) — never optimistically before it', () => {
  const body = bodyOf('async function handleDeleteProduct(id: string)', 1400)
  const deleteCallIndex = body.indexOf('await deleteProduct(')
  const localRemovalIndex = body.indexOf('setDraftProducts((prev) => prev.filter((p) => p.id !== id))')
  assert.ok(deleteCallIndex !== -1 && localRemovalIndex !== -1)
  assert.ok(deleteCallIndex < localRemovalIndex, 'the server delete must be awaited before local state is ever touched')
})

test('a failed server-side delete surfaces deleteError and does NOT touch local draftProducts state', () => {
  const body = bodyOf('async function handleDeleteProduct(id: string)', 1400)
  assert.match(body, /catch \(err: any\) \{/)
  const catchStart = body.indexOf('catch (err: any) {')
  const catchReturnIndex = body.indexOf('return', catchStart)
  const catchBlock = body.slice(catchStart, catchReturnIndex)
  assert.match(catchBlock, /setDeleteError\(/)
  assert.ok(!/setDraftProducts/.test(catchBlock), 'the catch block must not also mutate draftProducts before its own return')
})

test('deleteProduct is imported from lib/catalog.ts, not reimplemented inline in the component', () => {
  assert.match(workspaceSource, /import \{[^}]*deleteProduct[^}]*\} from '@\/lib\/catalog'/)
})
