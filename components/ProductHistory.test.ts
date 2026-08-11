// Milestone C14 (Milestone 34) — source-inspection tests for
// components/ProductHistory.tsx, same convention as every other
// CatalogueWorkspace.*.test.ts file (no jest/testing-library in this
// project; real rendered behavior is covered by live browser verification).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(__dirname, 'ProductHistory.tsx'), 'utf8')

// --- History loading -----------------------------------------------------

test('loading state renders while status is "loading", with aria-busy for accessibility', () => {
  assert.match(source, /state\.status === 'loading'/)
  assert.match(source, /aria-busy="true"/)
})

test('a fetch is kicked off (status set to loading) whenever productId changes, via useEffect', () => {
  assert.match(source, /useEffect\(\(\) => \{/)
  assert.match(source, /\}, \[productId\]\)/)
  assert.match(source, /setState\(\{ status: 'loading', events: \[\] \}\)/)
})

// --- Empty state -----------------------------------------------------------

test('empty state shows the exact required "No history yet." copy', () => {
  assert.match(source, />No history yet\.</)
})

// --- Timeline rendering ------------------------------------------------------

test('the loaded timeline renders one <li> per event, using the centralized describeProductHistoryEvent for its label', () => {
  assert.match(source, /state\.events\.map\(\(event\) => \{/)
  assert.match(source, /const display = describeProductHistoryEvent\(event\)/)
  assert.match(source, /\{display\.title\}/)
})

test('every event shows a formatted timestamp', () => {
  assert.match(source, /formatEventTimestamp\(event\.created_at\)/)
})

test('the component imports its display strings from lib/productHistory.ts — it defines no event-label strings of its own', () => {
  assert.match(source, /import \{ getProductHistory, describeProductHistoryEvent, type ProductHistoryEventRow \} from '@\/lib\/productHistory'/)
  // The only hardcoded copy in this file is the four UI-state sentences
  // themselves (loading/empty/error/unsaved) — never an event_type label.
  assert.ok(!/'product_created'|'listing_generated'|'listing_approved'|'exported'/.test(source), 'ProductHistory.tsx must never hardcode a raw event_type — that belongs solely to lib/productHistory.ts')
})

// --- Marketplace display -----------------------------------------------------

test('marketplace is shown as its own context line when describeProductHistoryEvent provides one', () => {
  assert.match(source, /\{display\.marketplaceLabel && <p[^>]*>\{display\.marketplaceLabel\}<\/p>\}/)
})

// --- Failure state -----------------------------------------------------------

test('error state shows the exact required "Unable to load product history." copy, and never throws into the parent drawer', () => {
  assert.match(source, />Unable to load product history\.</)
  assert.match(source, /\.catch\(\(err: any\) => \{/)
  assert.match(source, /setState\(\{ status: 'error', events: \[\] \}\)/)
})

test('unsaved product (no productId yet) shows its own explanatory state, distinct from loading/empty/error', () => {
  assert.match(source, /!productId &&/)
  assert.match(source, /History is available once this product is saved\./)
})

// --- No duplicate event rendering / no accidental duplicate creation --------

test('ProductHistory only ever READS history (getProductHistory) — it never calls recordProductHistoryEvent, so it structurally cannot cause a duplicate event to be created by rendering/re-rendering', () => {
  assert.match(source, /import \{ getProductHistory,/)
  assert.ok(!/recordProductHistoryEvent/.test(source))
})

test('a stale in-flight fetch can never overwrite a newer one (the cancelled-flag guard) — prevents a flicker/duplicate render on rapid productId changes', () => {
  assert.match(source, /let cancelled = false/)
  assert.match(source, /if \(!cancelled\) setState\(\{ status: 'loaded', events \}\)/)
  assert.match(source, /return \(\) => \{\s*cancelled = true\s*\}/)
})

test('each rendered event uses its own stable database id as the React key — never an array index, which is what causes duplicate/misordered rendering on updates', () => {
  assert.match(source, /key=\{event\.id\}/)
})
