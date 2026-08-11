// Unit tests for lib/creditPackages.ts (Milestone C13).
// Run with: npx tsx --test lib/creditPackages.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getCreditPackage, CREDIT_PACKAGES, CREDIT_PACKAGE_IDS } from './creditPackages'

test('getCreditPackage resolves every known package id', () => {
  for (const id of CREDIT_PACKAGE_IDS) {
    const pkg = getCreditPackage(id)
    assert.ok(pkg)
    assert.equal(pkg!.id, id)
    assert.ok(pkg!.credits > 0)
    assert.ok(pkg!.unitAmount > 0)
  }
})

test('getCreditPackage returns undefined for any unknown/arbitrary package id — never a fabricated fallback', () => {
  assert.equal(getCreditPackage('mega-pack-100000-credits'), undefined)
  assert.equal(getCreditPackage(''), undefined)
  assert.equal(getCreditPackage('__proto__'), undefined)
  assert.equal(getCreditPackage('constructor'), undefined)
})

test('CREDIT_PACKAGES has no Shopify or unrelated entries — exactly the fixed package set', () => {
  assert.deepEqual(new Set(CREDIT_PACKAGE_IDS), new Set(['starter', 'pro', 'business']))
})

test('every package has a positive, whole-cent unitAmount (no float-money bugs)', () => {
  for (const id of CREDIT_PACKAGE_IDS) {
    const pkg = CREDIT_PACKAGES[id]
    assert.equal(Number.isInteger(pkg.unitAmount), true)
    assert.equal(pkg.currency, 'usd')
  }
})
