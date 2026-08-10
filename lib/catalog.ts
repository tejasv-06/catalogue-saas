import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import type { Marketplace } from '@/lib/types'
import type { GenerationMeta } from '@/lib/listingHealth'

// Milestone 21 (Step C1 of the Milestone 20 audit) — a thin, session-aware
// wrapper around the catalog tables created in
// supabase/migrations/20260810_02_catalog_foundation.sql. Nothing calls this
// module yet; it is not wired into CatalogueWorkspace.tsx or the generation
// flow. That wiring is Step C2/C3, deliberately not part of this file.
//
// owner_user_id has no database-side default or trigger (verified against
// the live migration) — the RLS policies only ever CHECK that a supplied
// owner_user_id matches auth.uid(), they never populate it. Every write
// function therefore still includes owner_user_id/approved_by in the actual
// Supabase payload, but always derived here from the authenticated session
// (client.auth.getUser()), never accepted as a parameter from this module's
// own callers — the same pattern already verified working end-to-end in
// components/ClientSelector.tsx's handleSaveNewClient (Milestone 18/19).
//
// Every exported function takes an optional trailing `client` parameter,
// defaulting to the real browser client. This is the seam lib/catalog.test.ts
// uses to inject a mock — no behavior change for real callers, who can
// always omit it.

export type CatalogProductFields = {
  brand_name: string | null
  description: string | null
  category: string | null
  image_url: string | null
  client_id?: string | null
}

export type CatalogProductRow = {
  id: string
  owner_user_id: string
  client_id: string | null
  brand_name: string | null
  description: string | null
  category: string | null
  image_url: string | null
  created_at: string
  updated_at: string
}

export type CatalogListingFields = {
  shaped_content: unknown
  generation_meta: GenerationMeta | null
  generation_error: string | null
}

export type CatalogListingRow = {
  id: string
  product_id: string
  owner_user_id: string
  marketplace: Marketplace
  shaped_content: unknown
  generation_meta: GenerationMeta | null
  generation_error: string | null
  created_at: string
  updated_at: string
}

export type CatalogListingApprovalRow = {
  id: string
  listing_id: string
  owner_user_id: string
  approved: boolean
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export type CatalogExportRow = {
  id: string
  owner_user_id: string
  marketplace: Marketplace
  listing_ids: string[]
  item_count: number
  file_name: string | null
  created_at: string
}

async function requireUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser()
  if (error) throw error
  if (!data.user) throw new Error('catalog: an authenticated session is required')
  return data.user.id
}

export async function createProduct(
  fields: CatalogProductFields,
  client: SupabaseClient = createClient()
): Promise<string> {
  const ownerUserId = await requireUserId(client)

  const { data, error } = await client
    .from('catalog_products')
    .insert({
      owner_user_id: ownerUserId,
      brand_name: fields.brand_name,
      description: fields.description,
      category: fields.category,
      image_url: fields.image_url,
      client_id: fields.client_id ?? null
    })
    .select('id')
    .single()

  if (error) throw error
  return (data as { id: string }).id
}

export async function upsertListing(
  productId: string,
  marketplace: Marketplace,
  fields: CatalogListingFields,
  client: SupabaseClient = createClient()
): Promise<CatalogListingRow> {
  const ownerUserId = await requireUserId(client)

  const { data, error } = await client
    .from('catalog_listings')
    .upsert(
      {
        product_id: productId,
        owner_user_id: ownerUserId,
        marketplace,
        shaped_content: fields.shaped_content,
        generation_meta: fields.generation_meta,
        generation_error: fields.generation_error
      },
      { onConflict: 'product_id,marketplace' }
    )
    .select()
    .single()

  if (error) throw error
  return data as CatalogListingRow
}

export async function setApproval(
  listingId: string,
  approved: boolean,
  client: SupabaseClient = createClient()
): Promise<CatalogListingApprovalRow> {
  const ownerUserId = await requireUserId(client)

  const { data, error } = await client
    .from('catalog_listing_approvals')
    .upsert(
      {
        listing_id: listingId,
        owner_user_id: ownerUserId,
        approved,
        approved_by: ownerUserId,
        // Always stamped on every call, approve or unapprove — this records
        // "when this row was last decided," not exclusively "when it first
        // became approved." Revisit if the eventual UI (Step C3) wants the
        // narrower "only set while approved === true" meaning instead.
        approved_at: new Date().toISOString()
      },
      { onConflict: 'listing_id' }
    )
    .select()
    .single()

  if (error) throw error
  return data as CatalogListingApprovalRow
}

export type CatalogSnapshot = {
  products: CatalogProductRow[]
  listings: CatalogListingRow[]
  approvals: CatalogListingApprovalRow[]
}

// Milestone 26 (Step C4) — the one read function this module has, additive
// to the four existing write functions (unchanged). Selects with no explicit
// owner filter on purpose: RLS already scopes every one of these tables to
// auth.uid() = owner_user_id, so adding a client-side filter here would be
// redundant at best and a false sense of security at worst — ownership
// enforcement lives in the database, not in this function.
export async function getCatalog(client: SupabaseClient = createClient()): Promise<CatalogSnapshot> {
  await requireUserId(client)

  const [productsRes, listingsRes, approvalsRes] = await Promise.all([
    client.from('catalog_products').select('*'),
    client.from('catalog_listings').select('*'),
    client.from('catalog_listing_approvals').select('*')
  ])

  if (productsRes.error) throw productsRes.error
  if (listingsRes.error) throw listingsRes.error
  if (approvalsRes.error) throw approvalsRes.error

  return {
    products: (productsRes.data ?? []) as CatalogProductRow[],
    listings: (listingsRes.data ?? []) as CatalogListingRow[],
    approvals: (approvalsRes.data ?? []) as CatalogListingApprovalRow[]
  }
}

export async function recordExport(
  marketplace: Marketplace,
  listingIds: string[],
  fileName: string | null,
  client: SupabaseClient = createClient()
): Promise<CatalogExportRow> {
  const ownerUserId = await requireUserId(client)

  const { data, error } = await client
    .from('catalog_exports')
    .insert({
      owner_user_id: ownerUserId,
      marketplace,
      listing_ids: listingIds,
      item_count: listingIds.length,
      file_name: fileName
    })
    .select()
    .single()

  if (error) throw error
  return data as CatalogExportRow
}

// Milestone 29 (C7) — same shape as getCatalog above: session-gated via
// requireUserId, no explicit owner_user_id filter (RLS on catalog_exports
// already scopes every row to auth.uid() = owner_user_id — see
// supabase/migrations/20260810_02_catalog_foundation.sql, unchanged by this
// milestone). Ordered newest-first since this only ever backs a history
// display; that's a display-order concern, not an ownership one.
export async function getExportHistory(client: SupabaseClient = createClient()): Promise<CatalogExportRow[]> {
  await requireUserId(client)

  const { data, error } = await client
    .from('catalog_exports')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as CatalogExportRow[]
}
