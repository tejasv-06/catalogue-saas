# Tesolute — Product Foundation

Internal source of truth for product direction and UX rules. Read this before making product/UX decisions in this codebase. It reflects what Tesolute genuinely does today, verified directly against the implementation — not aspiration, and not carried forward from a prior conversation's memory.

Status: **Milestone 0 — foundation/documentation only, refreshed.** No application code changed to produce this revision. Every current-state claim below was checked against the repository at the time of writing; §12–§14 in particular replace an earlier version of this document that had drifted out of date (it described the sidebar/labeling restructuring as a *future* direction after it had already shipped).

---

## 1. Product Definition

Tesolute is an AI-powered cataloging and listing-generation platform for e-commerce sellers and agencies.

> Tesolute turns raw product data and photos into marketplace-ready listings — generated, validated, reviewed and ready to export.

Treat it internally as **"a cataloging workflow that uses AI to automate marketplace listing creation,"** not "an AI content generator with multiple input methods." The generation engine is the mechanism; the catalog workflow is the product.

Tesolute is **not** primarily an AI writing tool, a generic content generator, an SEO score generator, a chatbot, or a marketplace itself. It is a marketplace-listing preparation and management workflow. The seller's core job is *"manage my product listings and get them ready for marketplaces,"* not *"generate some AI content."*

---

## 2. Official User Workflow

**ADD → GENERATE → VALIDATE → REVIEW → EXPORT**

This is the one canonical workflow vocabulary. Do not introduce competing terms (e.g. "Understand → Enrich → Generate → Export") without a specific reason documented at the point of use.

| Step | Definition | Implemented via |
|---|---|---|
| ADD | Bring product info in via Bulk Upload (CSV), Manual Entry, or Photos Only — input methods, not primary navigation destinations | `components/workspace/LeftPanel.tsx`, `ImageOnlyPanel.tsx`, handlers in `CatalogueWorkspace.tsx` |
| GENERATE | Create marketplace-specific listing content, respecting the selected target marketplace(s) | `app/api/generate-single/route.ts` |
| VALIDATE | Check generated content against real, checkable marketplace requirements, after generation and after every regeneration | `lib/listingHealth.ts` + `lib/marketplaceRules.ts` |
| REVIEW | Inspect one marketplace's listing, selectively regenerate fields | `GeneratedListingDrawer` in `components/CatalogueWorkspace.tsx` |
| EXPORT | Download approved listings in marketplace-ready files | `handleDownloadApproved` in `CatalogueWorkspace.tsx`, `lib/exportShapers.ts` |

All five steps are implemented today. This is not aspirational.

---

## 3. Core Product Principles

**A. Catalog-first.** The catalog is the product; AI generation is the means. The primary workspace should answer: what products do I have, which marketplaces have listings, which listings are ready, which need attention, what do I do next.

**B. Marketplace-specific.** Content is shaped per marketplace, not one generic description. Current marketplaces: **Amazon, Flipkart, Myntra, Etsy** (`SUPPORTED_MARKETPLACES` in `lib/platformShapers.ts`). Do not assume others without a code change confirming it.

**C. Validation must be real.** Never invent SEO scores, AI accuracy/confidence percentages, conversion scores, search-volume claims, unimplemented marketplace requirements, or "brand voice matched" claims. Every check in `lib/listingHealth.ts` and every limit in `lib/marketplaceRules.ts` traces to a real, enforced rule — see §6 and §10.

**D. Content first, validation second.** The seller sees actual listing content as the dominant element; validation is a compact annotation, never a score dashboard.

**E. Action over information.** The interface should always answer "what should I do next," not just describe state.

**F. Input methods are not products.** Bulk Upload, Manual Entry, Photos Only are three ways to ADD — not three separate Tesolute products, and not primary sidebar navigation (see §13).

**G. Preserve functionality.** Do not regress: the generation engine, marketplace shaping, validation logic, field-level regeneration, credit deduction, export functionality, or existing API behavior — unless a future milestone explicitly approves the change.

**H. Product creation and marketplace generation are separate operations.** Adding a product to the catalog must never require a target marketplace to be selected first — see §8 for the full rule. Conflating the two was an actual regression fixed in-session; do not reintroduce it.

---

## 4. Seller Mental Model

On entering Tesolute, the seller should be answering:

> "Which listings are ready, which need attention, and what do I need to do next?"

Not "which AI mode should I use" or "what AI features exist." The product should progressively guide: Add products → Generate listings → Validate listings → Review issues → Export ready listings.

---

## 5. Primary Status Vocabulary

**READY · NEEDS REVIEW · MISSING DATA · ERROR** — listing *readiness*, computed by `computeListingHealth()` in `lib/listingHealth.ts`, rendered via `components/workspace/ListingHealthBadge.tsx`. This is the seller-facing vocabulary for "is this listing done."

- **Ready** — the listing generated successfully and every applicable verified check passes.
- **Needs Review** — the listing exists but one or more verified checks require seller attention (e.g. a verified length violation, incomplete content, a marketplace-specific issue).
- **Missing Data** — required source/product information is missing and prevents a complete listing.
- **Error** — a technical or generation failure prevented the listing from being produced.

Generation *progress* (not readiness) is shown contextually as **"Generating…"** — one of `ListingHealthBadge`'s states, not a separate headline system.

**Generation progress and listing health are two different concepts** — do not use their labels interchangeably:

> ⚠️ **Known tension, not yet resolved:** `components/StatusBadge.tsx` is a second, pre-existing badge system tracking product-level generation progress (`draft / generating / partial / generated / approved`) — a different axis from listing readiness. It currently renders in the same drawer as `ListingHealthBadge` (next to the "Generated Listings" heading, and again per marketplace as an "approved" pill). This is exactly the kind of competing status system this document generally warns against. It has not been removed or merged — flagged here so it isn't mistaken for intentional and isn't reintroduced-as-a-fix if removed later.

---

## 6. Validation Philosophy

> "Can Tesolute verify that this listing is complete and compliant with the rules it actually knows?"

**The 7 checks** (`computeListingHealth()`, exactly these, no others):
1. Generation succeeded
2. Title exists
3. Title is within the applicable, *verified* marketplace character limit
4. Bullets/features exist where applicable (not-applicable, not failed, for marketplaces with no bullets-equivalent field)
5. Description exists (and within its limit, where one is verified)
6. Keywords/tags exist
7. Required marketplace fields are non-empty

Do not invent additional marketplace requirements or scores beyond this list.

**Marketplace constraints are enforced on every generation path**, not just checked after the fact:

- A single config, `lib/marketplaceRules.ts`, is the one source of truth for every field-level limit — imported by `platformShapers.ts` (shaping), `listingHealth.ts` (validation), and `app/api/generate-single/route.ts` (prompting + retry). No limit is duplicated or hardcoded a second time anywhere else.
- Every generation prompt — full listing, bulk, retry, or a single field via field-level regenerate — has the real limit for that field injected into it before the model runs.
- After generation, the raw (pre-shaping) output is checked against the same config. If a scalar text field (title, description, or Amazon's keywords field, wherever a real limit exists) exceeds its limit, the route asks the model to rewrite it to fit — up to 2 bounded retries.
- A deterministic final safety net (`enforceCharLimit` in `lib/marketplaceRules.ts`) guarantees the stored value is never over limit even if the model never complies — it prefers cutting at a sentence or word boundary over a blind mid-word slice, and is the *last-resort* mechanism, not the primary compliance strategy.
- The final validation state and metadata always correspond to the actual stored value — `generationMeta` is computed *after* final enforcement, never from a pre-correction draft. A listing is never marked Ready while its stored field secretly exceeds a verified limit; if a constraint truly can't be satisfied, the check honestly reports `withinLimit: false` and the listing shows Needs Review.
- This applies identically to initial generation, bulk generation, row-level retry, and field-level regenerate (`Regenerate Title` etc.) — they all route through the same `generateForProductMarketplace` → `/api/generate-single` path.

**Verified vs. unverified rules** (from `lib/marketplaceRules.ts` — do not add UX copy or checks beyond what's marked `verified: true` here without updating that file first):

| Marketplace | Verified (enforced today) | Not verified — do not claim |
|---|---|---|
| Amazon | Title ≤75 chars · Bullets ≤5 items, ≤200 chars each · Generic Keywords ≤25 items / 200 chars total | Description length |
| Flipkart | Title ≤100 · Description ≤2000 · Key Features ≤5 items/100 chars · Search Keywords ≤5 items/3 words each | — |
| Myntra | Vendor Article Name ≤50 · List View Name ≤30 (tracked as a **separate** limit from Vendor Article Name, not a shared value) | Product Display Name, Product Details, Style Note, Tags length/count |
| Etsy | Title ≤140 · Tags ≤13 items | Per-tag character length (Etsy's real 20-char/tag limit is not enforced here), Description length |

---

## 7. Regeneration Principle

Field-level regeneration is isolated by construction, not by convention:

- `FIELD_GROUPS` (in `CatalogueWorkspace.tsx`) maps each marketplace's `title` / `bullets` / `description` group to its exact shaped-content keys (e.g. Myntra's `title` group = `vendorArticleName`, `listViewName`, `productDisplayName`).
- On a scoped regenerate, only that group's keys are taken from the fresh API response and merged into the *existing* content object for that marketplace; every other key is preserved via spread. "Regenerate Bullets" cannot alter the title — this is enforced in the merge logic, not just in the prompt.
- `Regenerate Entire Listing` (fieldGroup = undefined) is the only path that replaces the whole marketplace's content.
- On failure: prior content is left untouched (never cleared), the specific field group that failed is tracked (`failedRegenFieldGroup`, keyed by product+marketplace), and the drawer shows a scoped "⚠ Regeneration failed" on that field's own label — never a full-listing error banner, and the retry offered is always scoped to that same field group, never a generic "retry the whole listing" button.
- Field-level regenerate uses the *same* marketplace-and-field-specific constraint as full generation (§6) — a scoped prompt built from the same `lib/marketplaceRules.ts` config, not a generic prompt.
- One credit per `generate-single` call regardless of scope; internal constraint-retry attempts (§6) happen inside that same call and never trigger a second deduction.

---

## 8. Marketplace Selection Rule — Product Creation vs. Generation

**Adding a product to the catalog must never require a target marketplace to be selected.** This is a locked, verified-current behavior, not a future direction — it was the subject of an explicit in-session fix and must not be regressed.

- Bulk Upload, Manual Entry, and Photos Only all allow the user to add products with zero marketplaces selected. `handleAddProduct`, `handleAddImageOnlyProduct`, `handleUploadCsv`, and `handleDrop` in `CatalogueWorkspace.tsx` do not check `selectedMarketplaces` at all.
- Marketplace selection becomes required only when the user attempts to **generate** content — the "Generate Listings" button's handler, `handleGenerateAll`, is the single point where `selectedMarketplaces.length === 0` is checked.
- If no marketplace is selected at that point, the button does **not** silently do nothing — it calls `flagMissingMarketplace()`, which shows an **inline warning**, not a native `alert()`, popup, modal, or toast:
  - Sets `marketplaceError` to the exact text: `"Please select at least one target marketplace before proceeding."`
  - `AppHeader.tsx` renders that text in red directly beneath the Target Marketplaces button group, and applies a red ring (`ring-2 ring-red-500`, with a brief pulse) around the group itself.
  - The warning clears itself automatically the moment the seller selects any marketplace (`handleToggleMarketplace` resets both `marketplaceError` and `marketplaceFlash`) — no dismiss action needed.
- `requireMarketplace()` (a separate, older helper that uses a native `alert()`) still gates **Bulk Approve** and **Export Listings**, unchanged — those two actions were not part of this rule change and still use the alert-based gate. Do not assume `requireMarketplace()` and `flagMissingMarketplace()` are interchangeable; they serve different actions with deliberately different UX.

A product can therefore exist in the catalog before any marketplace-specific content has been generated. That is intentional — product existence and marketplace generation are different concepts (see §3.H).

---

## 9. Marketplace-Specific Review & Filtering

A product can have a different listing state per marketplace simultaneously — e.g. Amazon: Ready, Flipkart: Needs Review, Myntra: Generating. Never treat a product as having one universal generation/health state.

**Review isolation.** Opening "View Content" for a specific marketplace row shows *only* that marketplace's content — never every marketplace the product has ever attempted. This is enforced structurally: `QueueTable`'s View action calls `onView(product.id, marketplace)` with the row's own marketplace explicitly narrowed (never inferred from `content || error`); `CatalogueWorkspace` stores this as `viewingTarget: { productId, marketplace }`; `GeneratedListingDrawer` receives `marketplace` as a required prop and builds `attemptedMarketplaces = [marketplace]` — a single-element array, never derived from the product as a whole. Regenerate and Approve inside the drawer act on that same one marketplace only.

**Filter isolation.** The catalog table (`QueueTable.tsx`) renders one row per `(product, marketplace)` pair that has actually been attempted or is in flight — never one row per product. The `[All] [Ready] [Needs Review] [Missing Data] [Error]` filter chips operate at that same row granularity, not at the whole-product level: `buildRowData`/`filterRowData`/`productHasVisibleRow` in `QueueTable.tsx` compute and filter each row's own health independently, so a product with Amazon = Ready and Flipkart = Needs Review shows only the matching row under either filter — never both rows under one filter just because the product matched somewhere. All filtering and the summary counts (`computeListingSummary` in `CatalogueWorkspace.tsx`) call the same single health engine, `computeListingHealth()` — there is no second health calculation anywhere.

---

## 10. Image / Visual Attribute Principle

- Attributes are only ever surfaced under "Detected from image" when **at least one** attribute has a real, non-null value (`detectedAttributes` filter in `GeneratedListingDrawer`) — an image analyzed with everything coming back null shows no section at all, not an empty one.
- Null/undetected individual attributes are simply omitted from the list, not shown as blank or "—".
- No confidence percentage exists anywhere in this pipeline — none should be added unless a real confidence mechanism is built.

---

## 11. Brand Voice Principle

Brand voice today is a per-client `brand_guidelines` free-text field (`ClientSelector`, `clients` table), passed as-is into the generation prompt when selected. There is **no mechanism that scores or verifies voice adherence.**

Approved language: "Brand guidelines applied," "Brand voice selected," "Brand profile used."
Not approved: "Brand voice matched," "Brand voice matched perfectly," or any claim implying measurement.

---

## 12. Marketplace Rule Principle

`lib/marketplaceRules.ts` is the single source of truth for every marketplace/field constraint used in prompting, validation, and shaping. If a rule isn't in that file with `verified: true`, it is not a real Tesolute capability — do not write UX copy, validation checks, or prompt instructions implying otherwise. See the table in §6 for the current verified/unverified split.

---

## 13. Add Products Principle

There is exactly **one** Add Products experience in the product today, and it is a **permanent, fixed area of the workspace layout** — not a drawer, modal, popup, portal, or floating overlay.

- `AddProductsPanel` (defined in `CatalogueWorkspace.tsx`) is the single intake surface, always mounted as the left column of a fixed two-column layout: `Sidebar | Add Products | Listings`. It contains the `Bulk Upload / Manual Entry / Photos Only` tab strip and the corresponding form (`LeftPanel.tsx` for CSV/manual, `ImageOnlyPanel.tsx` for photos-only).
- Bulk Upload, Manual Entry, and Photos Only are **input methods**, not separate product features or primary navigation destinations (§3.F).
- The empty-catalog state's `+ Add Products` button does not open anything — it scrolls/focuses the existing left-side panel into view (`focusAddProducts` in `WorkspaceEmptyState`). There is never a second Add Products surface created.

> ⚠️ **Do not reintroduce a drawer/modal/portal architecture for Add Products.** This was tried in-session (a `createPortal`-based, `position: fixed` overlay triggered by a "+ Add Products" button) and caused real, repeated UX problems — the intake surface either visually collided with the workspace layout or was reverted for other reasons — before the team explicitly reverted to the fixed two-column layout as the approved direction. A future milestone may revisit this, but only with explicit approval; do not treat "catalog-first" (§3.A) as implicit permission to convert this panel into an overlay again.

---

## 14. Header / Context Principles

The workspace header should communicate "what am I working on," not "what features does Tesolute have."

- **Target Marketplaces** — the labeled term for marketplace selection, rendered in `AppHeader.tsx` above the marketplace chip group.
- **Brand Voice** — the labeled term for the client/brand-guidelines selector, rendered in `AppHeader.tsx` next to Target Marketplaces (only shown to signed-in users).

Both labels are implemented today — this was previously tracked as an unresolved gap in an earlier version of this document; it has since shipped and should not be described as pending.

Credits, profile, and account controls remain available (in `TopHeader.tsx`) but do not visually compete with the primary workspace context — they sit in the persistent top bar, not inside the workspace column.

---

## 15. Sidebar Principle

Primary navigation is deliberately simple and is **implemented as described below today** — this is not a future direction:

```
CATALOG
  Listings

TOOLS
  Account Audit
```

`AppSidebar.tsx` renders exactly these two destinations, each under its own group label. Bulk Upload, Manual Entry, and Photos Only are **not** sidebar navigation items — they live only inside the Add Products panel's tab strip (§13). Do not add them back to the sidebar, and do not create `/catalog`, `/brand`, `/tools`, `/settings`, or similar routes merely because §18's future direction mentions them — those remain unimplemented (see §16).

---

## 16. Current Architectural Boundary

**Current routes:** `/` (marketing), `/how-it-works` (marketing), `/contact`, `/login`, `/workspace` (the product, one page), `/audit` (a separate tool).

**No `/catalog`, `/brand`, `/tools`, or `/settings` routes exist.** The future direction (§18) is not implemented and must not be implied as current.

**Persistence — important:** the workspace's "catalog" is a single browser's `localStorage` session (`catalogue-draft-session`, 4-hour expiry, schema-versioned), not server-backed, not tied to an account, not accessible across devices. Do not describe or design around a persistent catalog until this changes. Approved/exported rows are cleared from local state on export; nothing is archived server-side today.

---

## 17. Action / Button Philosophy

Buttons should name the workflow action, not the mechanism. Current, real button labels in the product today (verified directly against source, not assumed):

`Add Product` (Manual Entry / Photos Only — not "+ Add Product"; the leading `+` only appears on the empty-state and toolbar `+ Add Products` scroll-to-panel actions, which are a different label for a different action) · `Upload CSV` · `Generate Listings` · `Regenerate Title` · `Regenerate Bullets` · `Regenerate Description` · `Regenerate Entire Listing` · `Approve Listing` · `Unapprove` · `Bulk Approve` · `Export Listings` · `Retry {Marketplace}` / `Retry`

Avoid generic labels ("AI Generate," "Create Content") when a workflow-specific one already exists and fits.

`Export Listings` is the current, correct label — an earlier version of this document flagged `Download CSV` as the label still in use and `Export Listings` as a recommended-but-unimplemented rename; that rename has since shipped (`QueueTable.tsx`). Do not reintroduce `Download CSV`.

Do not create buttons for functionality that doesn't exist (e.g. no per-row Approve exists in the queue table today — approval is drawer-level or bulk-level only).

---

## 18. Marketing vs. Product Language

Canonical vocabulary: **ADD → GENERATE → VALIDATE → REVIEW → EXPORT.**

**Current state, verified directly against the code:**
- `app/page.tsx` (homepage) — aligned. "The Tesolute Workflow" section uses the 5-step Add/Generate/Validate/Review/Export sequence.
- `app/how-it-works/page.tsx` — aligned. Its 5 steps are titled `1. Add` / `2. Generate` / `3. Validate` / `4. Review` / `5. Export`, explicitly the expanded version of the homepage's workflow.
- `/workspace` (the product itself) — **now substantially aligned.** The Add Products panel has a visible heading, the marketplace/brand-voice context bar is labeled (`Target Marketplaces` / `Brand Voice`, §14), and `Export Listings` matches the canonical export label. This closes the specific gaps an earlier version of this document flagged as open.

Future workspace copy changes should converge on the same vocabulary the marketing pages already use — don't invent a third variant.

---

## 19. Desired Product Perception

> I give Tesolute my product catalog. Tesolute creates the marketplace-specific listings. It checks what can be checked. It tells me what needs attention. I fix or approve the listings. Then I export them.

Not: "I opened another ChatGPT-like AI writing tool."

---

## 20. Terminology Table

Canonical product-language guidelines. This is not a mandate to perform a global copy rewrite — it's a reference for what to prefer when writing new copy.

| Preferred | Avoid |
|---|---|
| Add Products | Upload Tool |
| Generate Listings | Generate AI Content |
| Target Marketplaces | Marketplace Selector |
| Brand Voice | Client Dropdown |
| Validate | Check AI Score |
| Review | Edit AI |
| Export Listings | Download CSV |
| Listing | Generated Content |
| Marketplace-ready | AI-optimized |

---

## 21. Future Product Direction (not current requirements)

Recorded for future milestones — none of these exist today and none should be implied as current:

```
CATALOG
- Products / Listings
- Add Products
- Review

BRAND
- Brand Profiles
- Brand Voice
- Client Management

TOOLS
- Account Audit
- Future Tools

SETTINGS
- Account
- Credits
- Billing
- Export History
```

Potential future routes: `/catalog`, `/catalog/add`, `/catalog/:id`, `/brand`, `/tools`, `/tools/audit`, `/settings`. These require database persistence, stronger session architecture, product/brand/client persistence, marketplace relationships, and export history that do not exist today (§16) — do not implement any of this without an explicit milestone.

Other recorded future direction:
- Persistent, server-backed catalog and catalog history
- Brand profiles beyond the current single free-text `brand_guidelines` field
- Multi-client/brand management for agencies beyond the current single-select dropdown
- A fully separate Tools *area* (today, Account Audit is already grouped under a "Tools" label in the sidebar per §15 — a real but partial step; a dedicated route/section is still future)
- Billing/self-serve credit purchase (today: "Buy more credits" links to `/contact`, no in-app purchase flow)
- Export history
- Catalog search (the queue table has row-level health filtering today, per §9, but no free-text search)
- Deeper marketplace/category intelligence (required-attribute taxonomies, category-specific rules beyond §6/§12's table)

---

## 22. Milestone Discipline

For every future milestone:

1. Inspect current implementation directly — do not rely on a prior conversation's memory of the codebase.
2. Identify what is already implemented.
3. Do not rebuild existing functionality unnecessarily.
4. Change only what the milestone requires; preserve unrelated behavior (§3.G).
5. Run TypeScript checks (`npx tsc --noEmit -p .`).
6. Run a production build (`next build`).
7. Test the relevant behavior — live/real testing where practical, and say plainly when only code-level verification was possible.
8. Report exact files changed.
9. Report anything discovered but intentionally left untouched.
10. Stop. Do not automatically begin the next milestone — wait for explicit approval.

If a future request conflicts with this document, identify and explain the conflict rather than silently choosing an interpretation or inventing a requirement — especially where the conflict would materially affect architecture or UX (e.g. reintroducing the Add Products drawer, §13).

---

## Appendix: Where to look

| Concern | File |
|---|---|
| Marketplace/field rules (single source of truth) | `lib/marketplaceRules.ts` |
| Shaping content per marketplace, deterministic char-limit fallback | `lib/platformShapers.ts` |
| Listing health / validation | `lib/listingHealth.ts` |
| Generation + constraint retry pipeline | `app/api/generate-single/route.ts` |
| Workspace state, generation orchestration, Add Products panel, review drawer | `components/CatalogueWorkspace.tsx` |
| Catalog/queue table, row-level (product × marketplace) filtering | `components/workspace/QueueTable.tsx` |
| Readiness badge | `components/workspace/ListingHealthBadge.tsx` |
| Generation-progress badge (see §5 tension) | `components/StatusBadge.tsx` |
| Sidebar nav (Catalog / Tools) | `components/AppSidebar.tsx` |
| Marketplace/brand context bar (Target Marketplaces / Brand Voice) | `components/AppHeader.tsx` |
| Brand voice / client profiles | `components/ClientSelector.tsx` |
| Credits display, top bar | `components/CreditsBalance.tsx`, `components/TopHeader.tsx` |
