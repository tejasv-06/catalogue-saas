// Pure constants only — safe to import from client components (e.g. cost
// preview labels on the generate/audit buttons) as well as server routes.
// Deliberately kept separate from lib/credits.ts, which reads
// SUPABASE_SERVICE_ROLE_KEY and must never be imported into client code —
// see the "service_role key is read ONLY here" discipline in
// app/api/generate-single/route.ts and app/api/upload-image/route.ts.
export const CREDIT_COSTS = {
  listingGeneration: 1,
  accountAudit: 5
} as const
