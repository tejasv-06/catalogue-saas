// Project-wide typography rule: no em dash (U+2014) anywhere in the
// repository. Walks the whole tree (source, tests, docs, migrations,
// public files) the same way the one-off cleanup script that enforced this
// did, excluding only node_modules/.next/.git. A single test, not a
// per-file assertion, so this stays cheap to run and gives one clear
// failure message naming every offending location if the rule is ever
// broken by a future change.
//
// The target character is built from its code point at runtime, never
// typed as a literal glyph anywhere in this file: typing it literally
// would make this very file trip its own scan (a real bug hit while
// writing this file's first draft).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = join(__dirname, '..')
const EXCLUDE_DIRS = new Set(['node_modules', '.next', '.git'])
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.pdf', '.zip', '.lock'])
const EM_DASH = String.fromCharCode(0x2014)

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectFiles(full, out)
    } else if (!BINARY_EXT.has(extname(entry.name).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}

test('no file in the repository contains an em dash: use a period, colon, comma, parentheses, or a rewritten sentence instead', () => {
  const offenders: string[] = []
  for (const file of collectFiles(ROOT)) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue // not readable as text (shouldn't happen given the BINARY_EXT filter, but never fail the scan on a stray unreadable file)
    }
    if (!text.includes(EM_DASH)) continue
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      if (line.includes(EM_DASH)) offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}`)
    })
  }
  assert.deepEqual(offenders, [])
})
