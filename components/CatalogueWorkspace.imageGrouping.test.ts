// Milestone C18: Photos Only Product Grouping + Credit Accounting.
// Source-inspection tests for the client-side wiring (CatalogueWorkspace.tsx,
// ImageOnlyPanel.tsx): same convention every other CatalogueWorkspace.*
// .test.ts file in this repo already uses for logic embedded in component
// closures. Real, executable coverage for the pure grouping logic itself
// lives in lib/imageGrouping.test.ts; credit-gate/reason coverage for
// app/api/group-product-images/route.ts also lives there.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(__dirname, 'CatalogueWorkspace.tsx'), 'utf8')
const imageOnlyPanelSource = readFileSync(join(__dirname, 'workspace', 'ImageOnlyPanel.tsx'), 'utf8')
const leftPanelSource = readFileSync(join(__dirname, 'workspace', 'LeftPanel.tsx'), 'utf8')
const imageGroupReviewSource = readFileSync(join(__dirname, 'workspace', 'ImageGroupReview.tsx'), 'utf8')

function bodyOf(fnSignature: string, window = 2000): string {
  const start = source.indexOf(fnSignature)
  assert.ok(start !== -1, `expected to find "${fnSignature}" in CatalogueWorkspace.tsx`)
  return source.slice(start, start + window)
}

// --- §13: one grouping request per batch, never per image ------------------

test('startImageGroupingFromFiles uploads every file then calls runImageGrouping ONCE for the whole batch: no per-image loop calling the grouping route', () => {
  const body = bodyOf('async function startImageGroupingFromFiles(files: File[]) {')
  assert.match(body, /Promise\.all\(files\.map\(uploadProductImage\)\)/)
  assert.match(body, /await runImageGrouping\(urls\)/)
})

test('runImageGrouping calls POST /api/group-product-images exactly once per invocation, with the whole URL array in one request body', () => {
  const body = bodyOf('async function runImageGrouping(urls: string[]) {')
  assert.match(body, /fetch\('\/api\/group-product-images'/)
  assert.match(body, /body: JSON\.stringify\(\{ imageUrls: urls \}\)/)
  // Exactly one fetch call in this function: not one per url.
  const fetchCalls = body.match(/fetch\(/g) ?? []
  assert.equal(fetchCalls.length, 1)
})

test('the 1-image case short-circuits before ever calling the grouping route (mirrors the same short-circuit the route itself has server-side)', () => {
  const body = bodyOf('async function runImageGrouping(urls: string[]) {')
  assert.match(body, /if \(urls\.length === 1\) \{/)
  assert.match(body, /buildSingleGroupFallback\(urls\)/)
})

test('the batch is capped at MAX_IMAGE_GROUPING_BATCH before any upload happens: no wasted uploads for a rejected batch', () => {
  const body = bodyOf('async function startImageGroupingFromFiles(files: File[]) {')
  const capCheckIdx = body.indexOf('files.length > MAX_IMAGE_GROUPING_BATCH')
  const uploadIdx = body.indexOf('Promise.all(files.map(uploadProductImage))')
  assert.ok(capCheckIdx !== -1 && uploadIdx !== -1 && capCheckIdx < uploadIdx)
})

// --- §16: group-editing actions never call an AI route ----------------------

for (const fn of [
  'function handleRemoveGroupImage(groupId: string, imageUrl: string) {',
  'function handleMoveGroupImage(groupId: string, imageUrl: string, targetGroupId: string | \'new\') {',
  'function handleMergeImageGroup(groupId: string, targetGroupId: string) {',
  'function handleSplitImageGroup(groupId: string) {',
  'function handleResolveGroupReview(groupId: string, action: \'keep\' | \'split\') {'
]) {
  test(`${fn.split('(')[0].replace('function ', '')} never calls fetch: pure synchronous state edit only`, () => {
    const body = bodyOf(fn, 700)
    assert.ok(!/fetch\(/.test(body), `${fn} must not call an API route`)
  })
}

// --- §21 / Part J: one confirmed group = one DraftProduct, one
// ensureServerProduct call, source 'photo' (never a new source tag / new
// persistence path): via the shared buildDraftProductsFromImageGroups /
// commitDraftProducts helpers both staging actions now go through ----------

test('buildDraftProductsFromImageGroups builds exactly one DraftProduct per group via a pure .map: never a loop that could produce more or fewer', () => {
  const body = bodyOf('function buildDraftProductsFromImageGroups(groups: { imageUrls: string[] }[]): DraftProduct[] {', 1000)
  assert.match(body, /return groups\.map\(\(group\) => \(\{/)
  assert.match(body, /imageUrl: group\.imageUrls\[0\] \?\? null/)
  assert.match(body, /imageUrls: group\.imageUrls/)
})

test('groups built into DraftProducts start with empty brandName/description/category: never hallucinated (§9), left for the seller/Product Intelligence to fill in', () => {
  const body = bodyOf('function buildDraftProductsFromImageGroups(groups: { imageUrls: string[] }[]): DraftProduct[] {', 1000)
  assert.match(body, /brandName: ''/)
  assert.match(body, /description: ''/)
  assert.match(body, /category: ''/)
})

test('commitDraftProducts reuses ensureServerProduct with source \'photo\': same primitive every other add path uses, no new persistence mechanism, no new source tag', () => {
  const body = bodyOf('function commitDraftProducts(products: DraftProduct[]) {', 900)
  assert.match(body, /void ensureServerProduct\(product, 'photo'\)/)
  assert.ok(!/'photo_group'|'grouped'|'batch'|'single'/.test(body), 'must not invent a new product-history source tag')
})

test('commitDraftProducts and buildDraftProductsFromImageGroups never call fetch or any credit-charging route: creating/confirming products is free', () => {
  const buildBody = bodyOf('function buildDraftProductsFromImageGroups(groups: { imageUrls: string[] }[]): DraftProduct[] {', 1000)
  const commitBody = bodyOf('function commitDraftProducts(products: DraftProduct[]) {', 900)
  assert.ok(!/fetch\(/.test(buildBody))
  assert.ok(!/fetch\(/.test(commitBody))
})

test('commitConfirmedImageGroups is blocked while any group still needsReview, and skips empty groups', () => {
  const body = bodyOf('function commitConfirmedImageGroups() {', 1300)
  assert.match(body, /confirmableGroups\.some\(\(g\) => g\.needsReview\)/)
  assert.match(body, /imageGroupImport\.groups\.filter\(\(g\) => g\.imageUrls\.length > 0\)/)
})

test('commitConfirmedImageGroups is a plain synchronous function (not async): confirming a grouped batch is now a pure, instant client-side operation with no network credit gate', () => {
  const start = source.indexOf('function commitConfirmedImageGroups() {')
  assert.ok(start !== -1)
  assert.ok(!source.slice(Math.max(0, start - 20), start).includes('async'), 'commitConfirmedImageGroups must not be declared async')
})

test('commitConfirmedImageGroups builds products via buildDraftProductsFromImageGroups + commitDraftProducts: the same shared helpers "Create Single Product" uses, not a separate product-building path', () => {
  const body = bodyOf('function commitConfirmedImageGroups() {', 1300)
  assert.match(body, /commitDraftProducts\(buildDraftProductsFromImageGroups\(confirmableGroups\)\)/)
})

test('commitConfirmedImageGroups never calls /api/confirm-image-groups (that route no longer exists) and never calls fetch at all', () => {
  const body = bodyOf('function commitConfirmedImageGroups() {', 1300)
  assert.ok(!/confirm-image-groups/.test(body))
  assert.ok(!/fetch\(/.test(body))
})

// --- Part B/G: "Create Single Product": the sibling, zero-grouping-credit
// staging action -------------------------------------------------------------

test('startSingleProductFromStaged uploads every staged file, then builds ONE group (one DraftProduct) via the shared helpers: never per-file products', () => {
  const body = bodyOf('async function startSingleProductFromStaged(files: File[]) {', 1000)
  assert.match(body, /Promise\.all\(files\.map\(uploadProductImage\)\)/)
  assert.match(body, /commitDraftProducts\(buildDraftProductsFromImageGroups\(\[\{ imageUrls: urls \}\]\)\)/)
})

test('startSingleProductFromStaged never calls /api/group-product-images, runImageGrouping, or fetch: Part G', () => {
  const body = bodyOf('async function startSingleProductFromStaged(files: File[]) {', 1000)
  assert.ok(!/group-product-images/.test(body))
  assert.ok(!/runImageGrouping/.test(body))
  assert.ok(!/fetch\(/.test(body))
})

test('startSingleProductFromStaged sets status \'creating\' (not \'grouping\') before uploading: a distinct, honest loading state for the free path', () => {
  const body = bodyOf('async function startSingleProductFromStaged(files: File[]) {', 1000)
  assert.match(body, /setImageGroupImport\(\{ status: 'creating' \}\)/)
})

test('handleCreateSingleProductFromStaged is the only path from staged files into startSingleProductFromStaged', () => {
  const body = bodyOf('function handleCreateSingleProductFromStaged() {', 400)
  assert.match(body, /void startSingleProductFromStaged\(imageGroupImport\.files\)/)
})

test('handleStartGroupingFromStaged only fires for mode \'multiple\': a structural guard, not just "the button isn\'t rendered," so Single Product mode can never accidentally reach the grouping endpoint (Part 7)', () => {
  const body = bodyOf('function handleStartGroupingFromStaged() {', 400)
  assert.match(body, /imageGroupImport\.mode !== 'multiple'/)
  assert.match(body, /void startImageGroupingFromFiles\(imageGroupImport\.files\)/)
  // The staging handlers themselves never call startImageGroupingFromFiles.
  const stagingBody = bodyOf('function handleStageImageFiles(files: File[]) {', 1000)
  assert.ok(!/startImageGroupingFromFiles/.test(stagingBody))
})

test('handleCreateSingleProductFromStaged only fires for mode \'single\': the mirror-image structural guard (Part 7)', () => {
  const body = bodyOf('function handleCreateSingleProductFromStaged() {', 400)
  assert.match(body, /imageGroupImport\.mode !== 'single'/)
})

test('handleChooseSingleProductMode / handleChooseMultipleProductsMode are the ONLY two ways imageGroupImport ever becomes a \'staging\' state with an empty files array: the mode is chosen before any photo is picked (Part 1/5)', () => {
  const singleBody = bodyOf('function handleChooseSingleProductMode() {', 150)
  const multipleBody = bodyOf('function handleChooseMultipleProductsMode() {', 150)
  assert.match(singleBody, /setImageGroupImport\(\{ status: 'staging', mode: 'single', files: \[\] \}\)/)
  assert.match(multipleBody, /setImageGroupImport\(\{ status: 'staging', mode: 'multiple', files: \[\] \}\)/)
})

test('multi-selecting/adding files only STAGES them (no upload, no AI call, no product created): neither staging action runs automatically on selection', () => {
  const body = bodyOf('function handleStageImageFiles(files: File[]) {', 1000)
  assert.ok(!/fetch\(|uploadProductImage/.test(body), 'staging must never upload or call an API route')
  assert.match(body, /prev\.status !== 'staging'/)
})

test('handleStageImageFiles preserves the chosen mode as more photos are added: it never re-derives or re-asks which mode is active', () => {
  const body = bodyOf('function handleStageImageFiles(files: File[]) {', 1000)
  assert.match(body, /\.\.\.prev/)
  assert.ok(!/mode: 'single'|mode: 'multiple'/.test(body), 'must carry prev.mode forward via spread, never hard-code a mode')
})

test('handleStageImageFiles never silently truncates an over-limit selection: it surfaces a validation message naming how many were actually added (Part D)', () => {
  const body = bodyOf('function handleStageImageFiles(files: File[]) {', 1000)
  assert.match(body, /error:/)
  assert.match(body, /overflow/)
})

test('the staging cap is MAX_IMAGE_GROUPING_BATCH (10), enforced by room-based slicing as more files are added incrementally', () => {
  const body = bodyOf('function handleStageImageFiles(files: File[]) {', 1000)
  assert.match(body, /const room = MAX_IMAGE_GROUPING_BATCH - prev\.files\.length/)
  assert.match(body, /files\.slice\(0, room\)/)
})

test('ImageOnlyPanel renders ImageGroupReview only while a batch import is in the "review" state, and shows Try Again / Organize Manually / Cancel on a grouping error', () => {
  assert.match(imageOnlyPanelSource, /<ImageGroupReview/)
  assert.match(imageOnlyPanelSource, /Try Again/)
  assert.match(imageOnlyPanelSource, /Organize Manually/)
  assert.match(imageOnlyPanelSource, /Couldn't confidently organize these images/)
})

// --- Part 1/5: the choice is shown BEFORE upload, on its own entry screen:
// never re-presented as a pair of buttons after photos are already staged --

test('a signed-in seller adding a new product (not editing) sees the Single Product / Multiple Products choice screen whenever no batch import is in progress: the choice renders before any photo is picked', () => {
  const gateIdx = imageOnlyPanelSource.indexOf('if (hasSession && !editingId) {')
  assert.ok(gateIdx !== -1, 'expected a hasSession && !editingId branch gating the entry choice screen')
  const gateBody = imageOnlyPanelSource.slice(gateIdx, gateIdx + 2000)
  assert.match(gateBody, /How are you uploading your photos\?/)
  assert.match(gateBody, /title="Single Product"/)
  assert.match(gateBody, /title="Multiple Products"/)
  assert.match(gateBody, /onClick=\{onChooseSingleProductMode\}/)
  assert.match(gateBody, /onClick=\{onChooseMultipleProductsMode\}/)
})

test('the entry choice screen only appears when imageGroupImport is null: it is the "before upload" state, structurally distinct from the staging screen that appears once a mode is chosen', () => {
  const ifBatchIdx = imageOnlyPanelSource.indexOf('if (imageGroupImport) {')
  const entryChoiceIdx = imageOnlyPanelSource.indexOf('if (hasSession && !editingId) {')
  assert.ok(ifBatchIdx !== -1 && entryChoiceIdx !== -1 && ifBatchIdx < entryChoiceIdx, 'the imageGroupImport batch-UI branch must return before the entry choice screen is ever reached')
})

test('entry choice card copy is the short, seller-friendly wording: just the two one-line descriptions, nothing longer', () => {
  const gateIdx = imageOnlyPanelSource.indexOf('if (hasSession && !editingId) {')
  const gateBody = imageOnlyPanelSource.slice(gateIdx, gateIdx + 900)
  assert.match(gateBody, /description="Photos of the same product"/)
  assert.match(gateBody, /description="Photos of different products"/)
})

test('the verbose pre-refinement copy is gone from the entry choice screen: no "Have only product photos?" heading, no explanatory paragraph, no supporting-text/credit lines on this screen', () => {
  const gateIdx = imageOnlyPanelSource.indexOf('if (hasSession && !editingId) {')
  const nextBranchIdx = imageOnlyPanelSource.indexOf('// Guest preview, or editing an existing product')
  const gateBody = imageOnlyPanelSource.slice(gateIdx, nextBranchIdx)
  assert.ok(!/Have only product photos\? That's enough to start\./.test(gateBody))
  assert.ok(!/writes the full listing/.test(gateBody))
  assert.ok(!/All photos will be treated as one product/.test(gateBody))
  assert.ok(!/AI will group/.test(gateBody))
  assert.ok(!/No grouping credits used/.test(gateBody))
  assert.ok(!/grouping credit/.test(gateBody), 'no credit explanation belongs on the initial choice screen')
})

test('UploadModeCard no longer accepts supportingText/creditText props: the entry screen shows only a title and a one-line description', () => {
  const cardDefIdx = imageOnlyPanelSource.indexOf('function UploadModeCard({')
  const cardDefBody = imageOnlyPanelSource.slice(cardDefIdx, cardDefIdx + 700)
  assert.ok(!/supportingText/.test(cardDefBody))
  assert.ok(!/creditText/.test(cardDefBody))
})

test('none of the banned technical terms (clustering, classification, inference, grouping algorithm, AI segmentation) appear anywhere in ImageOnlyPanel', () => {
  assert.ok(!/clustering|classification|inference|grouping algorithm|segmentation/i.test(imageOnlyPanelSource))
})

// --- Part 2/3/5: once a mode is chosen, the staging screen shows exactly
// ONE mode-appropriate action: never both, and never the "Single Product"/
// "Multiple Products" labels again (that choice already happened) ----------

test('the staging screen never shows both a Single-Product action and a Multiple-Products action together: it branches on imageGroupImport.mode and renders exactly one', () => {
  const stagingBlockIdx = imageOnlyPanelSource.indexOf("imageGroupImport.status === 'staging' &&")
  const stagingBlockEnd = imageOnlyPanelSource.indexOf("imageGroupImport.status === 'creating'", stagingBlockIdx)
  const stagingBlock = imageOnlyPanelSource.slice(stagingBlockIdx, stagingBlockEnd)
  assert.match(stagingBlock, /imageGroupImport\.mode === 'single' \?/)
  assert.match(stagingBlock, /onClick=\{onCreateSingleProductFromStaged\}/)
  assert.match(stagingBlock, /onClick=\{onStartGroupingFromStaged\}/)
  // The staging screen's own action buttons are never labeled with the
  // entry-screen's mode-choice titles: no re-presented choice post-upload.
  assert.ok(!/>Single Product</.test(stagingBlock))
  assert.ok(!/>Multiple Products</.test(stagingBlock))
})

test('the staging screen\'s per-mode microcopy matches the required credit wording', () => {
  assert.match(imageOnlyPanelSource, /No grouping credits used\./)
  assert.match(imageOnlyPanelSource, /Uses \{CREDIT_COSTS\.imageGroupingRequest\} grouping credit\{CREDIT_COSTS\.imageGroupingRequest === 1 \? '' : 's'\}\./)
})

// --- ImageGroupReview: Confirm is blocked by unresolved low-confidence
// groups (§5/§6/§15), and confirming is free (no credit-cost preview) ------

test('ImageGroupReview disables Confirm & Analyze Products while any group still needs review', () => {
  assert.match(imageGroupReviewSource, /disabled=\{needsReviewCount > 0 \|\| confirmableGroups\.length === 0\}/)
})

test('ImageGroupReview no longer shows a credit-cost preview or a "confirming" prop: confirming grouped products is free, matching every other add path', () => {
  assert.ok(!/confirming/.test(imageGroupReviewSource))
  assert.ok(!/imageOnlyProductAnalysis/.test(imageGroupReviewSource))
  assert.ok(!/CREDIT_COSTS/.test(imageGroupReviewSource))
})

test('ImageGroupReview shows a distinct "Needs review" style badge for low-confidence groups and a Keep/Split quick-resolve: high-confidence groups are never blocked by it (§15)', () => {
  assert.match(imageGroupReviewSource, /low: \{ label: 'Needs review'/)
  assert.match(imageGroupReviewSource, /Looks right, keep together/)
  assert.match(imageGroupReviewSource, /Split into separate products/)
})

// --- ensureProductIntelligence is completely unmodified: still exactly
// one call site, still not called from anywhere in the C18 grouping code
// (Part K/16-19: one analysis per confirmed product, all its images, no
// per-marketplace duplication, no cross-product leakage: all guaranteed
// structurally by this being the ONE unmodified call site every product,
// image-only or not, goes through) ------------------------------------------

test('ensureProductIntelligence is still called from exactly one place in the whole file (unchanged from C17.3): grouping/staging never triggers it directly', () => {
  const occurrences = [...source.matchAll(/ensureProductIntelligence\(/g)]
  assert.equal(occurrences.length, 2, 'expected exactly the definition + its one call site inside generateForProductMarketplace')
})

test('neither buildDraftProductsFromImageGroups, commitDraftProducts, startSingleProductFromStaged, nor commitConfirmedImageGroups reference ensureProductIntelligence: Product Intelligence only ever runs later, via the existing Generate Listings path, never a second AI analysis system', () => {
  for (const [fn, window] of [
    ['function buildDraftProductsFromImageGroups(groups: { imageUrls: string[] }[]): DraftProduct[] {', 1000],
    ['function commitDraftProducts(products: DraftProduct[]) {', 900],
    ['async function startSingleProductFromStaged(files: File[]) {', 1000],
    ['function commitConfirmedImageGroups() {', 1300]
  ] as const) {
    const body = bodyOf(fn, window)
    assert.ok(!/ensureProductIntelligence/.test(body), `${fn} must not call ensureProductIntelligence directly`)
  }
})

// --- Manual Entry / Bulk Upload are untouched by grouping -------------------

test('LeftPanel (Manual Entry / Bulk Upload) never references image grouping: grouping is exclusively a Photos Only concept (§7)', () => {
  assert.ok(!/ImageGroupReview|imageGroupImport|group-product-images/.test(leftPanelSource))
})

test('handleAddManualImages / handleAddProduct (Manual Entry) are untouched: still the exact C17.1 cap logic, no grouping reference', () => {
  const body = bodyOf('function handleAddManualImages(files: File[]) {', 500)
  assert.match(body, /const room = MAX_MANUAL_IMAGES - prev\.length/)
  assert.ok(!/grouping|ImageGroupCandidate/i.test(body))
})

test('handleUploadCsv (Bulk Upload) is untouched: no cross-row image grouping introduced', () => {
  const body = bodyOf('async function handleUploadCsv() {', 3000)
  assert.ok(!/group-product-images|ImageGroupCandidate|buildImageGroupCandidates/.test(body))
})

// --- ImageOnlyPanel: guest preview / editing keep the original, unmodified
// single-image form: no multi-select there at all, since batch import is
// now reached exclusively via the Part 1 mode choice for a signed-in
// seller adding a new product (Part 10: must not regress) ------------------

test('the guest/editing single-image form never offers multi-select: no `multiple` attribute on its file input, and it always calls onImageFileChange with a single file', () => {
  const guestFormIdx = imageOnlyPanelSource.lastIndexOf('Guest preview, or editing an existing product')
  assert.ok(guestFormIdx !== -1, 'expected the guest/editing form section to still exist')
  const guestFormBody = imageOnlyPanelSource.slice(guestFormIdx)
  assert.ok(!/multiple/.test(guestFormBody), 'the guest/editing form must never enable multi-select')
  assert.match(guestFormBody, /onImageFileChange\(files\[0\] \?\? null\)/)
  assert.ok(!/onStageImageFiles/.test(guestFormBody), 'guest/editing form must never enter the batch staging flow')
})

test('editing an existing product (editingId set) skips the entry choice screen entirely and falls through to the original single-image form, even for a signed-in seller', () => {
  const entryChoiceIdx = imageOnlyPanelSource.indexOf('if (hasSession && !editingId) {')
  assert.ok(entryChoiceIdx !== -1)
  assert.match(imageOnlyPanelSource.slice(0, entryChoiceIdx + 40), /hasSession && !editingId/)
})

// --- Untouched systems: marketplace adapters, credits, C15 -----------------

test('marketplace shaping/rules/adapters files have no C18 grouping reference at all', () => {
  for (const file of ['../lib/platformShapers.ts', '../lib/marketplaceRules.ts', '../lib/marketplaceAdapters.ts']) {
    const fileSource = readFileSync(join(__dirname, file), 'utf8')
    assert.ok(!/imageGrouping|ImageGroupCandidate|group-product-images/i.test(fileSource), `${file} must be untouched by C18`)
  }
})

// Credit accounting for image grouping IS intentionally new (per explicit
// product-owner direction): CREDIT_COSTS.imageGroupingRequest (1, per
// "Group Into Multiple Products" click). What must still hold: it's defined
// in the ONE shared CREDIT_COSTS constant (never a parallel cost table),
// there is no second, per-confirmed-product charge (Part L/O: no second
// credit system), and the core generation-metering logic other products
// already rely on is untouched. Real coverage of the credit check/deduct
// ordering lives in lib/imageGrouping.test.ts.
test('CREDIT_COSTS has exactly the one new C18 cost (imageGroupingRequest), and existing listingGeneration/accountAudit rates are unchanged', () => {
  const creditCostsSource = readFileSync(join(__dirname, '..', 'lib', 'creditCosts.ts'), 'utf8')
  assert.match(creditCostsSource, /imageGroupingRequest: 1/)
  assert.match(creditCostsSource, /listingGeneration: 1/)
  assert.match(creditCostsSource, /accountAudit: 5/)
  assert.ok(!/imageOnlyProductAnalysis/.test(creditCostsSource))
})

test('generateForProductMarketplace (the shared generation pipeline every product goes through) has no C18-specific credit branching: grouped/single-product image-only products are charged exactly like any other product once they reach Generate Listings', () => {
  const body = bodyOf('async function generateForProductMarketplace(', 6500)
  assert.ok(!/imageGroupingRequest|imageOnlyProductAnalysis|ImageGroupCandidate/.test(body))
})

test('C15 performance intelligence files have no C18 grouping reference', () => {
  const performanceSource = readFileSync(join(__dirname, '..', 'lib', 'performance.ts'), 'utf8')
  assert.ok(!/imageGrouping|ImageGroupCandidate|group-product-images/i.test(performanceSource))
})

// --- Part H: duplicate submission cannot double-charge / double-create -----

test('both staging actions flip imageGroupImport away from \'staging\' synchronously, before any await: the buttons that trigger them are structurally gone from the next render, so a double-click cannot start two uploads/requests', () => {
  const singleBody = bodyOf('async function startSingleProductFromStaged(files: File[]) {', 1000)
  const groupBody = bodyOf('async function startImageGroupingFromFiles(files: File[]) {', 1000)
  // The status-flip line appears before the first `await` in each function.
  const singleFlipIdx = singleBody.indexOf("setImageGroupImport({ status: 'creating' })")
  const singleFirstAwaitIdx = singleBody.indexOf('await ')
  assert.ok(singleFlipIdx !== -1 && singleFirstAwaitIdx !== -1 && singleFlipIdx < singleFirstAwaitIdx)
  const groupFlipIdx = groupBody.indexOf("setImageGroupImport({ status: 'grouping' })")
  const groupFirstAwaitIdx = groupBody.indexOf('await ')
  assert.ok(groupFlipIdx !== -1 && groupFirstAwaitIdx !== -1 && groupFlipIdx < groupFirstAwaitIdx)
})
