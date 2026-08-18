// Pure constants only: safe to import from client components (e.g. cost
// preview labels on the generate/audit buttons) as well as server routes.
// Deliberately kept separate from lib/credits.ts, which reads
// SUPABASE_SERVICE_ROLE_KEY and must never be imported into client code:
// see the "service_role key is read ONLY here" discipline in
// app/api/generate-single/route.ts and app/api/upload-image/route.ts.
//
// Type-only import below: CreditTransactionReason is erased at compile
// time, so this never pulls lib/credits.ts's server-only runtime code into
// a client bundle.
import type { CreditTransactionReason } from '@/lib/credits'

export const CREDIT_COSTS = {
  listingGeneration: 1,
  accountAudit: 5,
  // Milestone C18: charged once per "Group Into Multiple Products" click
  // (app/api/group-product-images/route.ts), regardless of how many images
  // are in the batch, how many products the AI ends up detecting, or how
  // many chunked Groq calls that route makes internally to respect the
  // model's 3-image-per-request limit: one seller-facing action, one
  // charge, recorded with reason 'image_grouping' (lib/credits.ts).
  //
  // "Create Single Product" (the sibling action on the same staging screen)
  // never calls that route and costs 0 of these credits: see
  // startSingleProductFromStaged in components/CatalogueWorkspace.tsx.
  // Confirming either action's resulting product(s) is itself free, exactly
  // like every other add path (Manual Entry, Bulk Upload); the existing
  // listingGeneration charge is the only cost that applies once a product
  // goes through Generate Listings, same as any other product: there is
  // no separate per-product charge for image-only products.
  imageGroupingRequest: 1
} as const

// Milestone C18: friendly labels for credit_transactions.reason, for any
// transaction-history UI that displays a seller-facing reason (none exists
// in this codebase yet: this map is ready for when one does, and is what
// makes 'image_grouping' read as "Photo Grouping Analysis" rather than its
// raw identifier).
export const CREDIT_TRANSACTION_REASON_LABELS: Record<CreditTransactionReason, string> = {
  generation: 'Listing Generation',
  account_audit: 'Account Audit',
  refund: 'Refund',
  image_grouping: 'Photo Grouping Analysis'
} as const
