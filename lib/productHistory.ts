import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/catalog'
import { SUPPORTED_MARKETPLACES, MARKETPLACE_LABELS } from '@/lib/platformShapers'
import type { Marketplace } from '@/lib/types'

// Milestone C14 (Milestone 34) — Product History & Timeline.
//
// Same session-aware-wrapper pattern as lib/catalog.ts (this module
// literally reuses that file's own requireUserId): every exported function
// takes an optional trailing `client` parameter, defaulting to the real
// browser client, so the exact same code path works whether it's called
// from a client component (CatalogueWorkspace.tsx, right after an existing
// lib/catalog.ts write succeeds) or from a server route's own
// session-bound client (lib/supabase/server.ts — see
// app/api/enrich-product/route.ts for the established convention this
// follows). No service-role client is used anywhere in this file.
//
// Ownership is enforced by supabase/migrations/20260810_09_product_history.sql's
// RLS policies (owner_user_id = auth.uid(), plus a product-ownership
// subquery on insert) — never by application code re-checking anything,
// same division of responsibility as every other C1-C13 write in
// lib/catalog.ts. This module's own job is: validate shape (event type,
// marketplace, JSON-safe metadata) and derive the session's own user id —
// never accept one from a caller.

export const PRODUCT_HISTORY_EVENT_TYPES = [
  'product_created',
  'product_updated',
  'enrichment_started',
  'enrichment_completed',
  'enrichment_failed',
  'listing_generated',
  'listing_edited',
  'listing_approved',
  'listing_rejected',
  'exported'
] as const

export type ProductHistoryEventType = (typeof PRODUCT_HISTORY_EVENT_TYPES)[number]

function isValidEventType(value: unknown): value is ProductHistoryEventType {
  return typeof value === 'string' && (PRODUCT_HISTORY_EVENT_TYPES as readonly string[]).includes(value)
}

function isValidMarketplace(value: unknown): value is Marketplace {
  return typeof value === 'string' && (SUPPORTED_MARKETPLACES as readonly string[]).includes(value)
}

// "JSON-safe and bounded to useful context" (spec §5/§6) — a flat object of
// primitives only, never a nested object/array, never a function, never a
// full listing payload or prompt. This is intentionally stricter than
// "anything JSON.stringify can handle": the point is to make it structurally
// impossible to accidentally dump a large/sensitive payload in here, not
// just to avoid a serialization error.
export type ProductHistoryEventMetadata = Record<string, string | number | boolean | null>

function isValidMetadata(value: unknown): value is ProductHistoryEventMetadata {
  if (value === null || value === undefined) return true
  if (typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every(
    (v) => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
  )
}

export type ProductHistoryEventRow = {
  id: string
  product_id: string
  owner_user_id: string
  event_type: ProductHistoryEventType
  marketplace: Marketplace | null
  listing_id: string | null
  metadata: ProductHistoryEventMetadata | null
  created_at: string
}

export type RecordProductHistoryEventParams = {
  productId: string
  eventType: ProductHistoryEventType
  marketplace?: Marketplace | null
  listingId?: string | null
  metadata?: ProductHistoryEventMetadata | null
}

// The one write function this module has. Validates productId/event_type/
// marketplace/metadata BEFORE ever reaching the database — the table's own
// CHECK constraints are the real, final enforcement (this is defense in
// depth, not a replacement for them), but failing fast here with a clear
// message is more useful to a caller than a raw Postgres constraint-
// violation error.
//
// owner_user_id is always derived from the authenticated session
// (requireUserId), exactly like every write in lib/catalog.ts — there is no
// parameter a caller could use to set it to anyone else's id, and the
// table's own RLS WITH CHECK would reject a mismatched one anyway even if
// there were.
export async function recordProductHistoryEvent(
  params: RecordProductHistoryEventParams,
  client: SupabaseClient = createClient()
): Promise<ProductHistoryEventRow> {
  if (!params.productId || typeof params.productId !== 'string') {
    throw new Error('productHistory: productId is required')
  }
  if (!isValidEventType(params.eventType)) {
    throw new Error(`productHistory: invalid event_type "${params.eventType}"`)
  }
  if (params.marketplace != null && !isValidMarketplace(params.marketplace)) {
    throw new Error(`productHistory: invalid marketplace "${params.marketplace}"`)
  }
  if (!isValidMetadata(params.metadata)) {
    throw new Error('productHistory: metadata must be a flat object of strings/numbers/booleans/null')
  }

  const ownerUserId = await requireUserId(client)

  const { data, error } = await client
    .from('product_history_events')
    .insert({
      product_id: params.productId,
      owner_user_id: ownerUserId,
      event_type: params.eventType,
      marketplace: params.marketplace ?? null,
      listing_id: params.listingId ?? null,
      metadata: params.metadata ?? null
    })
    .select()
    .single()

  if (error) throw error
  return data as ProductHistoryEventRow
}

// Milestone C14 — the one read function this module has, same shape as
// lib/catalog.ts's getCatalog/getExportHistory: no explicit owner filter
// (RLS already scopes every row to auth.uid() = owner_user_id), scoped to
// exactly one product (never the whole account's history — see the
// performance note in the milestone spec), newest first for the timeline
// UI, with `seq` as a deterministic tiebreaker for events whose created_at
// happens to collide (same millisecond).
export async function getProductHistory(
  productId: string,
  client: SupabaseClient = createClient()
): Promise<ProductHistoryEventRow[]> {
  if (!productId || typeof productId !== 'string') {
    throw new Error('productHistory: productId is required')
  }

  await requireUserId(client)

  const { data, error } = await client
    .from('product_history_events')
    .select('id, product_id, owner_user_id, event_type, marketplace, listing_id, metadata, created_at')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .order('seq', { ascending: false })

  if (error) throw error
  return (data ?? []) as ProductHistoryEventRow[]
}

// --- §12 — centralized, human-readable display mapping -------------------
//
// The ONLY place event_type strings get turned into seller-facing labels.
// components/ProductHistory.tsx (and nowhere else) reads from this — no
// other component is allowed to hardcode its own copy of these strings.

export const EVENT_TYPE_LABELS: Record<ProductHistoryEventType, string> = {
  product_created: 'Product created',
  product_updated: 'Product updated',
  enrichment_started: 'Product intelligence analysis started',
  enrichment_completed: 'Product intelligence completed',
  enrichment_failed: 'Product intelligence failed',
  listing_generated: 'Listing generated',
  listing_edited: 'Listing edited',
  listing_approved: 'Listing approved',
  listing_rejected: 'Listing rejected',
  exported: 'Exported'
}

// "source" metadata values actually written by this milestone's own
// integrations (see CatalogueWorkspace.tsx's three ensureServerProduct call
// sites) — mapped to the same plain-language labels the create-panel tabs
// already use, never the raw source string.
const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual Entry',
  csv: 'Bulk Upload',
  photo: 'Photo Only'
}

export type ProductHistoryEventDisplay = {
  // The one-line event name — "Exported to Amazon" for a marketplace-
  // carrying export event (per spec §12's own example), otherwise the
  // plain EVENT_TYPE_LABELS entry with marketplace/source shown as
  // separate context lines instead.
  title: string
  marketplaceLabel: string | null
  sourceLabel: string | null
}

// Pure formatting only — reformats already-known facts (event_type,
// marketplace, metadata.source), never infers or guesses anything new.
export function describeProductHistoryEvent(event: ProductHistoryEventRow): ProductHistoryEventDisplay {
  const marketplaceLabel = event.marketplace ? MARKETPLACE_LABELS[event.marketplace] : null
  const source = event.metadata && typeof event.metadata.source === 'string' ? event.metadata.source : null
  const sourceLabel = source ? SOURCE_LABELS[source] ?? null : null

  if (event.event_type === 'exported' && marketplaceLabel) {
    return { title: `Exported to ${marketplaceLabel}`, marketplaceLabel: null, sourceLabel }
  }

  return { title: EVENT_TYPE_LABELS[event.event_type], marketplaceLabel, sourceLabel }
}
