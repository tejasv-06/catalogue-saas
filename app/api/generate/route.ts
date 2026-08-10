import { NextResponse } from 'next/server'

// Milestone 11 — locked down, not deleted.
//
// This route called the LLM once per `pending` row in the legacy `products`
// table, for ALL rows, with no authentication and no credit check of any
// kind — genuinely unmetered generation cost, confirmed live this milestone.
// Its own subsequent database write (`ai_title`/`ai_description`/
// `ai_bullets`/`ai_tags`) targets columns that do not exist in the live
// `products` schema (verified via introspection — the real columns are
// `title`/`description`/`image_url`/`status`/`target_marketplace`/
// `brand_name`/`generated_content`/`category`), so that write already fails
// today — but the unmetered LLM call before it still succeeds and still
// costs money on every invocation. Confirmed via repository search (and via
// this file's own sibling, lib/platformShapers.ts, whose comments already
// call generate-all "legacy... not used by the current client") to have
// zero current callers.
//
// The current, real, credited generation engine is
// app/api/generate-single/route.ts — untouched by this milestone. Retrofitting
// this route into that engine would mean rewriting its entire per-request
// model (single product+marketplace, authenticated, credited) to replace its
// current bulk-all-pending-rows model — a redesign, not a lockdown, and
// explicitly out of scope. Per this milestone's own guidance, the unmetered
// LLM-cost risk is closed by disabling the route outright rather than
// inventing a parallel, partial credit system.
export async function POST() {
  return NextResponse.json(
    {
      error: 'This endpoint is deprecated and no longer serves requests.',
      detail: 'Generation is handled by /api/generate-single in the current product.'
    },
    { status: 410 }
  )
}
