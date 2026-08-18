// Milestone C17.2 (hotfix): Bulk Upload gets the same up-to-5-image model
// Manual Entry already has (C17.1). Two kinds of tests here:
//   1. Real, executable tests against the actual `pick()` mapping helper
//      (lib/csvMapping.ts) and the actual public/sample-products.csv file:
//      not just source-inspection regexes, since both are plain, importable/
//      readable artifacts this file can exercise directly.
//   2. Source-inspection tests for handleUploadCsv's own logic, matching the
//      convention every other CatalogueWorkspace.*.test.ts file in this repo
//      already uses (no DOM/React-testing-library harness exists).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pick, normalizeKey } from '@/lib/csvMapping'

const source = readFileSync(join(__dirname, 'CatalogueWorkspace.tsx'), 'utf8')
const sampleCsv = readFileSync(join(__dirname, '..', 'public', 'sample-products.csv'), 'utf8')

function bodyOf(fnSignature: string, window = 2200): string {
  const start = source.indexOf(fnSignature)
  assert.ok(start !== -1, `expected to find "${fnSignature}" in CatalogueWorkspace.tsx`)
  return source.slice(start, start + window)
}

// The exact same mapping handleUploadCsv itself runs (see the source-
// inspection test below that pins this to the real implementation):
// duplicated here, using the REAL `pick`, so these tests exercise genuine
// behavior against real CSV row objects, not just assert the source text
// looks right.
function mapRowImages(row: Record<string, string>): string[] {
  const numbered = [1, 2, 3, 4, 5]
    .map((n) => pick(row, `Image URL ${n}`, `image_url_${n}`))
    .filter((url): url is string => !!url)
  const legacy = numbered.length === 0 ? pick(row, 'image url', 'image_url') : null
  return numbered.length > 0 ? numbered : legacy ? [legacy] : []
}

// --- Real behavior: image URL mapping (0 / 1 / gaps / all 5 / >5 / legacy) --

test('zero image columns filled -> image_urls = []', () => {
  const row = { Brand: 'Acme', Description: 'desc' }
  assert.deepEqual(mapRowImages(row), [])
})

test('only Image URL 1 filled -> image_urls = [url1]', () => {
  const row = { 'Image URL 1': 'https://x/1.jpg', 'Image URL 2': '', 'Image URL 3': '' }
  assert.deepEqual(mapRowImages(row), ['https://x/1.jpg'])
})

test('Image URL 1 + Image URL 3 filled, 2/4/5 blank -> image_urls = [url1, url3] (blank cells simply skipped, not empty strings)', () => {
  const row = {
    'Image URL 1': 'https://x/1.jpg',
    'Image URL 2': '',
    'Image URL 3': 'https://x/3.jpg',
    'Image URL 4': '',
    'Image URL 5': ''
  }
  assert.deepEqual(mapRowImages(row), ['https://x/1.jpg', 'https://x/3.jpg'])
  assert.ok(!mapRowImages(row).includes(''), 'must never contain an empty-string entry')
})

test('all five Image URL columns filled -> image_urls = [url1..url5], in order', () => {
  const row = {
    'Image URL 1': 'https://x/1.jpg',
    'Image URL 2': 'https://x/2.jpg',
    'Image URL 3': 'https://x/3.jpg',
    'Image URL 4': 'https://x/4.jpg',
    'Image URL 5': 'https://x/5.jpg'
  }
  assert.deepEqual(mapRowImages(row), ['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg', 'https://x/4.jpg', 'https://x/5.jpg'])
})

test('a 6th numbered column ("Image URL 6") is never picked up as a 6th product image', () => {
  const row = {
    'Image URL 1': 'https://x/1.jpg',
    'Image URL 2': 'https://x/2.jpg',
    'Image URL 3': 'https://x/3.jpg',
    'Image URL 4': 'https://x/4.jpg',
    'Image URL 5': 'https://x/5.jpg',
    'Image URL 6': 'https://x/6.jpg'
  }
  const result = mapRowImages(row)
  assert.equal(result.length, 5)
  assert.ok(!result.includes('https://x/6.jpg'))
})

test('the header annotation "(optional)" does not break column matching (normalizeKey strips parentheticals)', () => {
  const row = { 'Image URL 1 (optional)': 'https://x/1.jpg', 'Image URL 2 (optional)': 'https://x/2.jpg' }
  assert.deepEqual(mapRowImages(row), ['https://x/1.jpg', 'https://x/2.jpg'])
})

test('backward compatibility: an old single-column file ("Image URL", no numbered columns) still imports its one image', () => {
  const row = { Brand: 'Acme', Description: 'desc', 'Image URL': 'https://x/legacy.jpg' }
  assert.deepEqual(mapRowImages(row), ['https://x/legacy.jpg'])
})

test('backward compatibility: the "image_url" (underscore) legacy variant also still works', () => {
  const row = { image_url: 'https://x/legacy2.jpg' }
  assert.deepEqual(mapRowImages(row), ['https://x/legacy2.jpg'])
})

test('a new-format file never falls back to the legacy single column, even if both happen to be present', () => {
  const row = { 'Image URL 1': 'https://x/new.jpg', 'Image URL': 'https://x/legacy.jpg' }
  assert.deepEqual(mapRowImages(row), ['https://x/new.jpg'])
})

// --- Primary image assignment -------------------------------------------

test('image_urls[0] is always the primary image, matching image_url', () => {
  const row = { 'Image URL 1': 'https://x/1.jpg', 'Image URL 2': 'https://x/2.jpg' }
  const urls = mapRowImages(row)
  const imageUrl = urls[0] ?? null
  assert.equal(imageUrl, urls[0])
  assert.equal(imageUrl, 'https://x/1.jpg')
})

test('zero images -> image_url is null, not undefined or empty string', () => {
  const urls = mapRowImages({})
  const imageUrl = urls[0] ?? null
  assert.equal(imageUrl, null)
})

// --- The actual downloaded sample CSV file (public/sample-products.csv) ---

test('the actual sample CSV header contains Image URL 1 through 5', () => {
  const header = sampleCsv.split(/\r?\n/)[0]
  const columns = header.split(',').map((c) => normalizeKey(c))
  for (let n = 1; n <= 5; n++) {
    assert.ok(columns.includes(`image_url_${n}`), `expected column normalizing to image_url_${n}, got: ${columns.join(', ')}`)
  }
})

test('the actual sample CSV header does NOT contain a bare single "Image URL" column anymore', () => {
  const header = sampleCsv.split(/\r?\n/)[0]
  const columns = header.split(',').map((c) => normalizeKey(c))
  assert.ok(!columns.includes('image_url'), `did not expect a bare image_url column, got: ${columns.join(', ')}`)
})

test('the sample CSV template communicates that the image columns are optional', () => {
  const header = sampleCsv.split(/\r?\n/)[0]
  assert.match(header, /Image URL 1 \(optional\)/)
})

test('Brand and Description are still present, unchanged, in the sample CSV: not removed or reordered relative to each other', () => {
  const header = sampleCsv.split(/\r?\n/)[0]
  const columns = header.split(',').map((c) => c.trim())
  const brandIdx = columns.findIndex((c) => normalizeKey(c) === 'brand')
  const descIdx = columns.findIndex((c) => normalizeKey(c) === 'description')
  assert.ok(brandIdx !== -1 && descIdx !== -1)
  assert.ok(brandIdx < descIdx, 'Brand should still come before Description, as in the original template')
})

test('the sample CSV example row leaves some image columns blank, demonstrating optionality in the template itself', () => {
  const lines = sampleCsv.split(/\r?\n/).filter(Boolean)
  assert.ok(lines.length >= 2, 'expected at least one example data row')
  const cells = lines[1].split(',')
  // header has 8 columns (Brand, Category, Description, Image URL 1..5): an
  // example row that filled all 5 wouldn't demonstrate optionality at all.
  const filledImageCells = cells.slice(3).filter((c) => c.trim() !== '')
  assert.ok(filledImageCells.length < 5, 'the example row should leave at least one image column blank')
})

// --- Source-inspection: pins the real implementation to the same logic
// exercised above, so a future edit that changes the real code without
// updating these tests fails loudly. ---

test('handleUploadCsv maps up to 5 numbered "Image URL N" columns in order, filtering out blanks', () => {
  const body = bodyOf('async function handleUploadCsv() {')
  assert.match(body, /\[1, 2, 3, 4, 5\]\s*\r?\n\s*\.map\(\(n\) => pick\(row, `Image URL \$\{n\}`, `image_url_\$\{n\}`\)\)/)
  assert.match(body, /\.filter\(\(url\): url is string => !!url\)/)
})

test('handleUploadCsv falls back to the legacy single image-url column only when no numbered columns matched', () => {
  const body = bodyOf('async function handleUploadCsv() {')
  assert.match(body, /const legacyImageUrl = numberedImageUrls\.length === 0 \? pick\(row, 'image url', 'image_url'\) : null/)
})

test('handleUploadCsv still requires Brand and Description, never gates on any image column', () => {
  const body = bodyOf('async function handleUploadCsv() {')
  assert.match(body, /if \(!brand \|\| !rowDescription\) \{/)
  assert.ok(!/!csvImageUrls|!numberedImageUrls|!legacyImageUrl/.test(body), 'must never skip a row for missing images')
})

test('handleUploadCsv sets image_url to the resolved primary (csvImageUrls[0] ?? null), never a stale single-column read', () => {
  const body = bodyOf('async function handleUploadCsv() {', 2800)
  assert.match(body, /imageUrl: csvImageUrls\[0\] \?\? null/)
  assert.match(body, /imageUrls: csvImageUrls/)
})

// --- Manual Entry / Bulk Upload consistency: both add paths write to the
// same DraftProduct.imageUrl/imageUrls fields, never a second image model ---

test('Manual Entry (commitAddProduct) and Bulk Upload (handleUploadCsv) both populate the same imageUrl + imageUrls fields on DraftProduct', () => {
  const commitBody = bodyOf('function commitAddProduct(', 3000)
  const csvBody = bodyOf('async function handleUploadCsv() {', 2800)
  assert.match(commitBody, /imageUrl: resolvedImageUrls\[0\] \?\? null/)
  assert.match(commitBody, /imageUrls: resolvedImageUrls/)
  assert.match(csvBody, /imageUrl: csvImageUrls\[0\] \?\? null/)
  assert.match(csvBody, /imageUrls: csvImageUrls/)
})

// --- Manual Entry required-field guard is unchanged by this hotfix --------

test('Manual Entry still requires Brand Name and Description; images remain optional (unchanged from the earlier category-optional hotfix)', () => {
  const body = bodyOf('async function handleAddProduct() {', 800)
  assert.match(body, /if \(!brandName\.trim\(\) \|\| !description\.trim\(\)\) \{/)
  assert.ok(!/manualImages\.length/.test(body), 'Add Product must not require any image')
})
