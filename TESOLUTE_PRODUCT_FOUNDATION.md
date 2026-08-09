# Tesolute — Product Foundation

Internal source of truth for product direction and UX rules. Read this before making product/UX decisions in this codebase. It reflects what Tesolute genuinely does today, verified against the actual implementation — not aspiration.

Status: **Milestone 0 — foundation/documentation only.** No application code changed to produce this document.

---

## 1. Product Definition

Tesolute is an AI-powered cataloging and listing generation platform for e-commerce sellers and agencies.

> Tesolute turns raw product data and photos into marketplace-ready listings — generated, validated, reviewed and ready to export.

Treat it internally as **"a cataloging workflow that uses AI to automate marketplace listing creation,"** not "an AI content generator with multiple input methods." The generation engine is the mechanism; the catalog workflow is the product.

---

## 2. Official User Workflow

**ADD → GENERATE → VALIDATE → REVIEW → EXPORT**

This is the one canonical workflow vocabulary. Do not introduce competing terms (e.g. "Understand → Enrich → Generate → Export") without a specific reason documented at the point of use.

| Step | Definition | Implemented via |
|---|---|---|
| ADD | Bring product info in via Bulk CSV, Manual Entry, or Photos/Image-only | `components/workspace/LeftPanel.tsx`, `ImageOnlyPanel.tsx`, handlers in `CatalogueWorkspace.tsx` |
| GENERATE | Create marketplace-specific listing content | `app/api/generate-single/route.ts` |
| VALIDATE | Check generated content against real, checkable marketplace requirements | `lib/listingHealth.ts` + `lib/marketplaceRules.ts` |
| REVIEW | Inspect, fix, selectively regenerate | `GeneratedListingDrawer` in `components/CatalogueWorkspace.tsx` |
| EXPORT | Download approved listings in marketplace-ready files | `handleDownloadApproved` in `CatalogueWorkspace.tsx`, `lib/exportShapers.ts` |

All five steps are implemented today. This is not aspirational.

---

## 3. Core Product Principles

**A. Catalog-first.** The catalog is the product; AI generation is the means.

**B. Marketplace-specific.** Content is shaped per marketplace, not one generic description. Current marketplaces: **Amazon, Flipkart, Myntra, Etsy** (`SUPPORTED_MARKETPLACES` in `lib/platformShapers.ts`). Do not assume others without a code change confirming it.

**C. Validation must be real.** Never invent SEO scores, AI accuracy/confidence percentages, conversion scores, search-volume claims, unimplemented marketplace requirements, or "brand voice matched" claims. Every check in `lib/listingHealth.ts` and every limit in `lib/marketplaceRules.ts` traces to a real, enforced rule — see §6 and §10.

**D. Content first, validation second.** The seller sees actual listing content as the dominant element; validation is a compact annotation, never a score dashboard.

**E. Action over information.** The interface should always answer "what should I do next," not just describe state.

**F. Input methods are not products.** Bulk Upload, Manual Entry, Photos-Only are three ways to ADD — not three separate Tesolute products.

**G. Preserve functionality.** Do not regress: the generation engine, marketplace shaping, validation logic, field-level regeneration, credit deduction, export functionality, or existing API behavior — unless a future milestone explicitly approves the change.

---

## 4. Seller Mental Model

On entering Tesolute, the seller should be answering:

> "Which listings are ready, which need attention, and what do I need to do next?"

Not "which AI mode should I use" or "what AI features exist." The product should progressively guide: Add products → Generate listings → Validate listings → Review issues → Export ready listings.

---

## 5. Primary Status Vocabulary

**READY · NEEDS REVIEW · MISSING DATA · ERROR** — listing *readiness*, computed by `computeListingHealth()` in `lib/listingHealth.ts`, rendered via `components/workspace/ListingHealthBadge.tsx`. This is the seller-facing vocabulary for "is this listing done."

Generation *progress* (not readiness) is shown contextually as **"Generating…"** — one of `ListingHealthBadge`'s states, not a separate headline system.

> ⚠️ **Known tension, not yet resolved:** `components/StatusBadge.tsx` is a second, pre-existing badge system tracking product-level generation progress (`draft / generating / partial / generated / approved`) — a different axis from listing readiness. It currently renders in the same drawer as `ListingHealthBadge` (next to the "Generated Listings" heading, and again per marketplace as an "approved" pill). This is exactly the kind of competing status system §5's rule warns against. It has not been removed or merged — flagged here so it isn't mistaken for intentional and isn't reintroduced if removed later. See the Milestone -1 UX audit's §10 recommendation to drop the drawer-header instance.

---

## 6. Validation Philosophy

> "Can Tesolute verify that this listing is complete and compliant with the rules it actually knows?"

**The 7 checks** (`computeListingHealth()`, exactly these, no others):
1. Generation succeeded
2. Title exists
3. Title is within the applicable marketplace character limit
4. Bullets/features exist where applicable (not-applicable, not failed, for marketplaces with no bullets field)
5. Description exists (and within its limit, where one is verified)
6. Keywords/tags exist
7. Required marketplace fields are non-empty

**Marketplace constraints are enforced on every generation path**, not just checked after the fact:

- A single config, `lib/marketplaceRules.ts`, is the one source of truth for every field-level limit — imported by `platformShapers.ts` (shaping), `listingHealth.ts` (validation), and `app/api/generate-single/route.ts` (prompting + retry). No limit is duplicated or hardcoded a second time anywhere else.
- Every generation prompt — full listing, bulk, retry, or a single field via field-level regenerate — has the real limit for that field injected into it before the model runs.
- After generation, the raw (pre-shaping) output is checked against the same config. If a scalar text field (title, or a marketplace's description where a real limit exists) exceeds its limit, the route automatically asks the model to rewrite it to fit — up to 2 bounded retries — before returning anything to the client.
- `shapeForPlatform`'s `.slice()` truncation still exists as a last-resort safety net, not the primary compliance mechanism. If a value is still over limit after retries, the listing is **not** presented as Ready — `withinLimit: false` is reported honestly through to the health check.
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
- On failure: prior content is left untouched (never cleared), the specific field group that failed is tracked (`failedRegenFieldGroup`, keyed by product+marketplace), and the drawer shows a scoped "⚠ Regeneration failed" on that field's own label — never a full-listing error banner, never a generic "retry the whole listing" button when only one field was being regenerated. The retry offered is always scoped to the same field group that failed.
- Field-level regenerate uses the *same* marketplace-and-field-specific constraint as full generation (§6) — a scoped prompt built from the same `lib/marketplaceRules.ts` config, not a generic prompt.
- One credit per `generate-single` call regardless of scope; internal constraint-retry attempts (§6) happen inside that same call and never trigger a second deduction.

---

## 8. Image / Visual Attribute Principle

- Attributes are only ever surfaced under "Detected from image" when **at least one** attribute has a real, non-null value (`detectedAttributes` filter in `GeneratedListingDrawer`) — an image analyzed with everything coming back null shows no section at all, not an empty one.
- Null/undetected individual attributes are simply omitted from the list, not shown as blank or "—".
- No confidence percentage exists anywhere in this pipeline — none should be added unless a real confidence mechanism is built.

---

## 9. Brand Voice Principle

Brand voice today is a per-client `brand_guidelines` free-text field (`ClientSelector`, `clients` table), passed as-is into the generation prompt when selected. There is **no mechanism that scores or verifies voice adherence.**

Approved language: "Brand guidelines applied," "Brand voice selected," "Brand profile used."
Not approved: "Brand voice matched," "Brand voice matched perfectly," or any claim implying measurement.

---

## 10. Marketplace Rule Principle

`lib/marketplaceRules.ts` is the single source of truth for every marketplace/field constraint used in prompting, validation, and shaping. If a rule isn't in that file with `verified: true`, it is not a real Tesolute capability — do not write UX copy, validation checks, or prompt instructions implying otherwise. See the table in §6 for the current verified/unverified split.

---

## 11. Current Architectural Boundary

**Current routes:** `/` (marketing), `/how-it-works` (marketing), `/contact`, `/login`, `/workspace` (the product, one page), `/audit` (a separate tool).

**No `/catalog`, `/brand`, `/tools`, or `/settings` routes exist.** The future direction (CATALOG / BRAND / TOOLS / SETTINGS, potentially `/catalog`, `/catalog/add`, `/catalog/:id`, `/brand`, `/tools`, `/settings`) is not implemented and must not be implied as current.

**Persistence — important:** the workspace's "catalog" is a single browser's `localStorage` session (`catalogue-draft-session`, 4-hour expiry, schema-versioned), not server-backed, not tied to an account, not accessible across devices. Do not describe or design around a persistent catalog until this changes. Approved/exported rows are cleared from local state on export; nothing is archived server-side today.

---

## 12. Current UX Direction (not yet implemented)

Agreed target, recorded from the Milestone -1 UX/IA audit — **not implemented in Milestone 0 or any prior milestone:**

```
CATALOG
   ↓
+ ADD PRODUCTS
   ↓
Bulk Upload / Manual Entry / Photos Only

Then: GENERATE → VALIDATE → REVIEW → EXPORT
```

Today's actual sidebar is still: **ADD PRODUCTS** group (Bulk Upload, Manual Entry, Image-Only Generate) + **Account Audit**, with the catalog/queue table appearing beside the active input form rather than as the default landing view. This is the gap the future direction closes — see the Milestone -1 audit document/response for the full IA proposal, phasing, and exact copy changes. None of it is implemented.

---

## 13. Action / Button Philosophy

Buttons should name the workflow action, not the mechanism. Current, real button labels in the product today:

`+ Add Product` / `Upload CSV` · `Generate Listings` · `Regenerate Title` · `Regenerate Bullets` · `Regenerate Description` · `Regenerate Entire Listing` · `Approve Listing` · `Unapprove` · `Bulk Approve` · `Download CSV` · `Retry {Marketplace}` / `Retry`

Avoid generic labels ("AI Generate," "Create Content") when a workflow-specific one already exists and fits.

**Known gap:** `Download CSV` does not yet match the canonical vocabulary — `Export Listings` was recommended (Milestone -1 audit, §14) but is not implemented. Do not assume the rename has happened.

Do not create buttons for functionality that doesn't exist (e.g. no per-row Approve exists in the queue table today — approval is drawer-level or bulk-level only).

---

## 14. Marketing vs. Product Language

Canonical vocabulary: **ADD → GENERATE → VALIDATE → REVIEW → EXPORT.**

**Current state, verified directly against the code:**
- `app/page.tsx` (homepage) — aligned. "The Tesolute Workflow" section uses the 5-step Add/Generate/Validate/Review/Export sequence; the older "Understand → Enrich → Generate → Export" and the redundant second "Upload → Generate → Review → Export" section have both been removed.
- `app/how-it-works/page.tsx` — aligned. Its 5 steps are titled `1. Add` / `2. Generate` / `3. Validate` / `4. Review` / `5. Export`, explicitly commented as "the expanded version" of the homepage's workflow, not a separate explanation.
- `/workspace` (the product itself) — **not yet aligned.** Sidebar and button copy still use pre-5-step-era labels (`Image-Only Generate` rather than `Photos Only`, `Download CSV` rather than `Export Listings`, no visible "Add Products" heading, no labels on the marketplace/brand-voice context bar). This is tracked as UX work, not done here.

Future workspace copy changes should converge on the same vocabulary the marketing pages already use — don't invent a third variant.

---

## 15. Desired Product Perception

> I give Tesolute my product catalog. Tesolute creates the marketplace-specific listings. It checks what can be checked. It tells me what needs attention. I fix or approve the listings. Then I export them.

Not: "I opened another ChatGPT-like AI writing tool."

---

## 16. Future Product Direction (not current requirements)

Recorded for future milestones — none of these exist today and none should be implied as current:

- Persistent, server-backed catalog
- Catalog history
- Brand profiles (beyond the current single free-text `brand_guidelines` field)
- Multi-client/brand management for agencies (beyond the current single-select dropdown)
- Dedicated Tools area (separating Account Audit from the cataloging nav)
- Settings page
- Billing/self-serve credit purchase (today: "Buy more credits" links to `/contact`, no in-app purchase flow)
- Export history
- Catalog filtering and search (the queue table has neither today)
- Deeper marketplace/category intelligence (required-attribute taxonomies, category-specific rules beyond §6/§10's table)

---

## Appendix: Where to look

| Concern | File |
|---|---|
| Marketplace/field rules (single source of truth) | `lib/marketplaceRules.ts` |
| Shaping content per marketplace | `lib/platformShapers.ts` |
| Listing health / validation | `lib/listingHealth.ts` |
| Generation + constraint retry pipeline | `app/api/generate-single/route.ts` |
| Workspace state, generation orchestration, drawer | `components/CatalogueWorkspace.tsx` |
| Catalog/queue table | `components/workspace/QueueTable.tsx` |
| Readiness badge | `components/workspace/ListingHealthBadge.tsx` |
| Generation-progress badge (see §5 tension) | `components/StatusBadge.tsx` |
| Sidebar nav | `components/AppSidebar.tsx` |
| Marketplace/brand context bar | `components/AppHeader.tsx` |
| Brand voice / client profiles | `components/ClientSelector.tsx` |
| Credits display | `components/CreditsBalance.tsx` |
