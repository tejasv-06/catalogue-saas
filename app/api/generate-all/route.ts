import { NextResponse } from 'next/server'

// Milestone 11: locked down, not deleted.
//
// This route called the LLM once per `pending` row in the legacy `products`
// table, for ALL rows, with no authentication and no credit check of any
// kind. Unlike its sibling app/api/generate/route.ts, this one wrote to
// real, existing columns (generated_content, status) and so was fully
// functional: unauthenticated, uncredited, working bulk generation against
// production data. Confirmed via repository search, and via this file's own
// downstream comments in lib/platformShapers.ts ("the legacy
// app/api/generate-all/route.ts caller... still real code, just not used by
// the current client"), to have zero current callers.
//
// The current, real, credited generation engine is
// app/api/generate-single/route.ts: untouched by this milestone. Retrofitting
// this route into that engine would mean rewriting its entire per-request
// model (single product+marketplace, authenticated, credited) to replace its
// current bulk-all-pending-rows model: a redesign, not a lockdown, and
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
