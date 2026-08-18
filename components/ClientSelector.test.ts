// Regression guard for components/ClientSelector.tsx, using Node's built-in
// test runner (no new dependency: tsx is already a project devDependency).
// Run with: npx tsx --test components/ClientSelector.test.ts
//
// ClientSelector.tsx is a React component: it can't be unit-tested for
// real behavior without a DOM/React-testing-library harness, which this
// repository deliberately doesn't have (same constraint as the C2/C3
// persistence tests). What CAN be tested without one: that the file's
// source doesn't regress into the exact defect Milestone 17 discovered and
// Milestone 18 fixed: using the session-less `lib/supabaseClient.ts`
// import instead of the session-aware `lib/supabase/client.ts`, or
// omitting `user_id` from the client-creation insert payload. Both were
// real, live bugs in this exact file once; these are architecture-fitness
// checks against them recurring, not a claim of full behavioral coverage.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(__dirname, 'ClientSelector.tsx'), 'utf8')

test('does not import the session-less legacy Supabase client', () => {
  assert.ok(
    !source.includes("from '@/lib/supabaseClient'"),
    'ClientSelector.tsx must not import from lib/supabaseClient: that client never carries the signed-in session (Milestone 17/18)'
  )
})

test('imports the session-aware browser client', () => {
  assert.match(source, /from ['"]@\/lib\/supabase\/client['"]/)
})

test('the new-client insert includes user_id derived from the authenticated session', () => {
  // Not a full parse: a targeted string check that the insert call site
  // both fetches the real user and includes user_id in the same payload,
  // which is what C6-AC2/AC6 actually depend on for this component.
  assert.match(source, /supabase\.auth\.getUser\(\)/)
  assert.match(source, /user_id:\s*userData\.user\.id/)
})

test('does not construct an insert payload with a hardcoded or caller-suppliable user_id', () => {
  // Guards against a future edit accidentally threading a prop/state value
  // in as user_id instead of the session-derived one.
  assert.ok(!/user_id:\s*selectedClientId/.test(source))
  assert.ok(!/user_id:\s*props\./.test(source))
})
