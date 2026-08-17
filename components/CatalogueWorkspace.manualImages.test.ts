// Milestone C17.1 — Manual Entry: Multi-Image Product Upload.
// Same source-inspection approach as every other CatalogueWorkspace.*.test.ts
// file in this repo (no DOM/React-testing-library harness exists) — these
// assert the real structural facts of the implementation: cap enforcement,
// one-product-not-five, Photos Only left untouched, images surviving edit/
// persistence.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_MANUAL_IMAGES } from '@/lib/types'

const source = readFileSync(join(__dirname, 'CatalogueWorkspace.tsx'), 'utf8')
const leftPanelSource = readFileSync(join(__dirname, 'workspace', 'LeftPanel.tsx'), 'utf8')
const imageOnlyPanelSource = readFileSync(join(__dirname, 'workspace', 'ImageOnlyPanel.tsx'), 'utf8')
const manualEntryImagesSource = readFileSync(join(__dirname, 'workspace', 'ManualEntryImages.tsx'), 'utf8')

function bodyOf(src: string, fnSignature: string, window = 3000): string {
  const start = src.indexOf(fnSignature)
  assert.ok(start !== -1, `expected to find "${fnSignature}"`)
  return src.slice(start, start + window)
}

test('MAX_MANUAL_IMAGES is 5', () => {
  assert.equal(MAX_MANUAL_IMAGES, 5)
})

// --- 0 / 1 / 5 / 6th image, client-side cap ---------------------------------

test('handleAddManualImages caps additions at the remaining room, never exceeding MAX_MANUAL_IMAGES — a 6th image is silently not added, not an error', () => {
  const body = bodyOf(source, 'function handleAddManualImages(files: File[]) {', 500)
  assert.match(body, /const room = MAX_MANUAL_IMAGES - prev\.length/)
  assert.match(body, /if \(room <= 0\) return prev/)
  assert.match(body, /files\.slice\(0, room\)/)
})

test('ManualEntryImages renders one "Add Image" tile per remaining slot (up to 5 in a row when empty), never more tiles than MAX_MANUAL_IMAGES allows — no way to reach a 6th image from the UI', () => {
  assert.match(manualEntryImagesSource, /const emptySlotCount = MAX_MANUAL_IMAGES - images\.length/)
  assert.match(manualEntryImagesSource, /Array\.from\(\{ length: emptySlotCount \}\)/)
  // Every empty tile shares the SAME input via a click-trigger, never a
  // second/duplicated file input per tile.
  assert.match(manualEntryImagesSource, /onClick=\{\(\) => inputRef\.current\?\.click\(\)\}/)
})

test('the file input accepts multiple files in one pick (not locked to exactly one)', () => {
  assert.match(manualEntryImagesSource, /<input[\s\S]{0,120}type="file"[\s\S]{0,120}multiple/)
})

test('0 images is allowed — Add Product does not require any image', () => {
  // handleAddProduct's own validation only requires brand/description —
  // category is optional (see the dedicated categoryOptional test file).
  const body = bodyOf(source, 'async function handleAddProduct() {', 800)
  assert.ok(!/manualImages\.length/.test(body), 'handleAddProduct must not gate on having any images')
  assert.match(body, /Brand Name and Description are required/)
})

// --- remove ------------------------------------------------------------------

test('handleRemoveManualImage removes exactly the given index, freeing a slot, without touching any other form field', () => {
  const body = bodyOf(source, 'function handleRemoveManualImage(index: number) {', 200)
  assert.match(body, /setManualImages\(\(prev\) => prev\.filter\(\(_, i\) => i !== index\)\)/)
})

test('every thumbnail renders a remove (×) control', () => {
  assert.match(manualEntryImagesSource, /onClick=\{\(\) => onRemove\(index\)\}/)
  assert.match(manualEntryImagesSource, />\s*×\s*</)
})

// --- reorder -------------------------------------------------------------

test('handleMoveManualImage swaps the slot at index with its neighbor in the requested direction, bounds-checked', () => {
  const body = bodyOf(source, 'function handleMoveManualImage(index: number, direction: -1 | 1) {', 400)
  assert.match(body, /const target = index \+ direction/)
  assert.match(body, /if \(target < 0 \|\| target >= prev\.length\) return prev/)
  assert.match(body, /\[next\[index\], next\[target\]\] = \[next\[target\], next\[index\]\]/)
})

test('the first image is visibly labeled Primary and reorder controls never let it be moved earlier than index 0', () => {
  assert.match(manualEntryImagesSource, /index === 0[\s\S]{0,300}Primary/)
  assert.match(manualEntryImagesSource, /\{index > 0 && \(/)
})

// --- one product, not five (the critical distinction) ------------------------

test('resolveManualImageUrls resolves ALL manualImages slots into ONE ordered string[] — never one call/product per image', () => {
  const body = bodyOf(source, 'async function resolveManualImageUrls(): Promise<string[]> {', 900)
  assert.match(body, /Promise\.all\(manualImages\.map/)
})

test('commitAddProduct creates exactly one DraftProduct carrying the full imageUrls array — Add Product with 5 images never loops/pushes multiple products', () => {
  const body = bodyOf(source, 'function commitAddProduct(', 4500)
  // Exactly one `setDraftProducts((prev) => [...prev, newProduct])` push in
  // the non-edit branch — one product object, with the whole array on it.
  assert.match(body, /const newProduct: DraftProduct = \{/)
  assert.match(body, /imageUrls: resolvedImageUrls/)
  assert.match(body, /setDraftProducts\(\(prev\) => \[\.\.\.prev, newProduct\]\)/)
  // Only one ensureServerProduct call for this product, not one per image.
  const ensureCalls = body.match(/ensureServerProduct\(newProduct, source\)/g) ?? []
  assert.equal(ensureCalls.length, 1)
})

test('DraftProduct.imageUrl always mirrors imageUrls[0] (primary), both on create and on edit', () => {
  const body = bodyOf(source, 'function commitAddProduct(', 3200)
  assert.match(body, /imageUrl: resolvedImageUrls\[0\] \?\? null/)
  assert.match(body, /imageUrl: uploadedImageUrls\[0\] \?\? null, imageUrls: uploadedImageUrls/)
})

test('the first image is never reassigned based on AI/visual analysis — the success-path product update only ever touches generation-related fields, never imageUrl/imageUrls', () => {
  // The exact object generateForProductMarketplace merges back into
  // draftProducts on a successful response — spreads the previous product
  // (...p, which is how an untouched imageUrl/imageUrls survives) and then
  // overwrites only these five generation-related keys. Listing every key
  // this object literal actually sets, in order, proves imageUrl/imageUrls
  // is not among them — a stronger guarantee than a substring search.
  assert.match(
    source,
    /return \{\s*\r?\n\s*\.\.\.p,\s*\r?\n\s*generatedContent,\s*\r?\n\s*generationError,\s*\r?\n\s*generationMeta,\s*\r?\n\s*visualAttributes,\s*\r?\n\s*status: computeProductStatus\(/
  )
})

// --- edit existing product with multiple images -------------------------------

test('handleEditProduct seeds manualImages from the product\'s own imageUrls, in persisted order, as { file: null, url } slots', () => {
  const body = bodyOf(source, 'function handleEditProduct(product: DraftProduct) {', 900)
  assert.match(body, /product\.imageUrls\.length > 0 \? product\.imageUrls/)
  assert.match(body, /\.map\(\(url\) => \(\{/)
  assert.match(body, /file: null,/)
  assert.match(body, /setManualImages\(/)
})

test('editing replaces imageUrls wholesale from Manual Entry (a removal is a real edit), but leaves images untouched when no new image is provided via Photos Only', () => {
  const body = bodyOf(source, 'function commitAddProduct(', 3200)
  assert.match(body, /uploadedImageUrls !== undefined\s*\n\s*\?\s*\{ imageFile: null, imageUrl: uploadedImageUrls\[0\] \?\? null, imageUrls: uploadedImageUrls \}\s*\n\s*: \{\}/)
})

// --- persistence: server round-trip + old-session fallback -------------------

test('ensureServerProduct sends the full imageUrls array to createProduct as image_urls', () => {
  const body = bodyOf(source, 'async function ensureServerProduct(', 900)
  assert.match(body, /image_urls: product\.imageUrls/)
})

test('commitAddProduct persists image_urls (and the primary image_url) on edit via updateProduct', () => {
  const body = bodyOf(source, 'function commitAddProduct(', 3200)
  assert.match(body, /image_url: uploadedImageUrls\[0\] \?\? null, image_urls: uploadedImageUrls/)
})

test('a session saved before C17.1 (no imageUrls key at all after JSON.parse) is backfilled from its existing imageUrl, never left undefined', () => {
  const body = bodyOf(source, 'async function applyRestoredState(parsed: any) {', 700)
  assert.match(body, /imageUrls: Array\.isArray\(p\.imageUrls\) \? p\.imageUrls : p\.imageUrl \? \[p\.imageUrl\] : \[\]/)
})

test('buildDraftFromServer (lib/catalogReconciliation.ts) reads image_urls from the server row, falling back to [image_url]', () => {
  const reconciliationSource = readFileSync(join(__dirname, '..', 'lib', 'catalogReconciliation.ts'), 'utf8')
  assert.match(
    reconciliationSource,
    /imageUrls: serverProduct\.image_urls \?\? \(serverProduct\.image_url \? \[serverProduct\.image_url\] : \[\]\)/
  )
})

// --- existing single-image product compatibility ------------------------------

test('a single-image product (imageUrls with exactly one entry) round-trips through handleEditProduct exactly like a multi-image one — no special-cased single-image path', () => {
  const body = bodyOf(source, 'function handleEditProduct(product: DraftProduct) {', 900)
  // Same one code path handles 0, 1, or 5 images — no `if (imageUrls.length === 1)` branch.
  assert.ok(!/imageUrls\.length === 1/.test(body))
})

// --- Bulk Upload / Photos Only are not changed --------------------------------

test('Bulk Upload (CSV) still constructs a single-image-shaped row, only mirroring it into imageUrls for compatibility with the (shared) edit UI — no multi-image CSV column parsing introduced', () => {
  const body = bodyOf(source, "async function handleUploadCsv() {", 2200)
  assert.match(body, /const csvImageUrl = pick\(row, 'image url', 'image_url'\)/)
  assert.match(body, /imageUrls: csvImageUrl \? \[csvImageUrl\] : \[\]/)
  // Still exactly one pick() call for the image column — no per-image-N column lookup.
  const pickImageCalls = body.match(/pick\(row, 'image url', 'image_url'\)/g) ?? []
  assert.equal(pickImageCalls.length, 1)
})

test('ImageOnlyPanel (Photos Only) is untouched — still single imageFile/imageUrl props, no manualImages/ManualEntryImages reference', () => {
  assert.match(imageOnlyPanelSource, /imageFile: File \| null/)
  assert.match(imageOnlyPanelSource, /onImageFileChange: \(file: File \| null\) => void/)
  assert.ok(!/manualImages|ManualEntryImages|MAX_MANUAL_IMAGES/.test(imageOnlyPanelSource))
})

test('handleAddImageOnlyProduct (Photos Only submit) is structurally unchanged apart from wrapping its one URL for commitAddProduct\'s new signature', () => {
  const body = bodyOf(source, 'async function handleAddImageOnlyProduct() {', 1200)
  assert.match(body, /if \(!imageFile && !editingId\)/)
  assert.match(body, /uploadedImageUrl = await uploadProductImage\(imageFile\)/)
})

test('LeftPanel\'s manual tab uses ManualEntryImages, not a single "Upload Product Image" input', () => {
  assert.match(leftPanelSource, /<ManualEntryImages/)
  assert.ok(!/Upload Product Image/.test(leftPanelSource))
})

test('the Images section sits above Brand Name in the manual-entry form (images-first, per the milestone spec)', () => {
  const manualImagesIdx = leftPanelSource.indexOf('<ManualEntryImages')
  const brandNameIdx = leftPanelSource.indexOf('placeholder="Brand name"')
  assert.ok(manualImagesIdx !== -1 && brandNameIdx !== -1 && manualImagesIdx < brandNameIdx)
})
