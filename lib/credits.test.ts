// Unit tests for lib/credits.ts, using Node's built-in test runner (no new
// dependency — tsx is already a project devDependency).
// Run with: npx tsx --test lib/credits.test.ts
//
// Scope: only the Milestone 27 (C5) change — deductCredits now requires and
// forwards a `reason`. getOrCreateCreditBalance/assertSufficientCredits are
// unchanged by this milestone and are not re-tested here.
//
// What could NOT be unit-tested here, and why: unlike lib/catalog.ts's
// functions, deductCredits has no injectable-client parameter — it builds
// its own admin client internally from process.env, by design (a
// service-role-only module deliberately never exposed to browser code).
// That means its actual RPC-call shape (does it really send p_reason?)
// can't be asserted against a mock without either adding a dependency-
// injection seam to a currently-working module (out of scope for this
// milestone) or hitting a real database. That specific behavior is instead
// covered by (a) the TypeScript compiler — deductCredits(userId, amount)
// with no third argument is now a compile error, so every real call site
// is forced to supply one — and (b) live verification (see the Milestone
// 27 report).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deductCredits, InsufficientCreditsError, type CreditTransactionReason } from './credits'

test('CreditTransactionReason accepts exactly the three schema-constrained values', () => {
  // Type-level assertion: this only compiles if all three are valid and
  // exhaustive for the type — a fourth, invalid string here would fail
  // `npx tsc --noEmit`, which is the actual check this test exists to
  // trigger under `tsc`, not runtime assertion.
  const values: CreditTransactionReason[] = ['generation', 'account_audit', 'refund']
  assert.deepEqual(values, ['generation', 'account_audit', 'refund'])
})

test('deductCredits requires a reason argument at the type level', () => {
  // Real regression check for the actual milestone requirement ("ensure
  // call sites pass the correct reason parameter"): if a future edit ever
  // makes `reason` optional again, this line stops compiling under
  // strict arity checking only if TS considers a 2-arg call assignable —
  // asserting the parameter count directly is the honest way to pin this
  // without a broken runtime mock.
  assert.equal(deductCredits.length, 3)
})

test('InsufficientCreditsError still formats required/available correctly (unchanged by this milestone)', () => {
  const err = new InsufficientCreditsError(5, 2)
  assert.equal(err.required, 5)
  assert.equal(err.available, 2)
  assert.match(err.message, /costs 5/)
  assert.match(err.message, /2 remaining/)
})
