import { NextResponse } from 'next/server'

// Milestone 11 — locked down, not deleted.
//
// This route operated on the legacy `products` table (status='reviewed',
// filtered by target_marketplace) with no authentication of any kind, and
// with no ownership column on that table to scope results to a caller in
// the first place — verified via live schema introspection this milestone,
// not assumed. Confirmed via repository search to have zero current callers
// in components/, scripts/, or any deployment config; the current product's
// real export path is entirely client-side (performExport in
// CatalogueWorkspace.tsx / lib/exportShapers.ts) and never calls this route.
//
// A real per-user auth+ownership fix isn't possible here without adding an
// owner column to the legacy `products` table, which this milestone
// explicitly preserves untouched. Rather than half-fix it (e.g. adding an
// auth check that still can't scope results to "your" data), this route now
// short-circuits before touching the database. The `products` table itself
// also has RLS enabled as of this milestone (see
// supabase/migrations/20260810_01_legacy_baseline_and_rls_lockdown.sql),
// which independently blocks the anon-key client this route used, so this
// is defense in depth, not the only protection.
//
// Not deleted: repository evidence alone can't confirm zero deployment
// traffic, and deletion was explicitly disallowed without that evidence.
export async function POST() {
  return NextResponse.json(
    {
      error: 'This endpoint is deprecated and no longer serves requests.',
      detail: 'Export is handled client-side in the current product. See components/CatalogueWorkspace.tsx.'
    },
    { status: 410 }
  )
}
