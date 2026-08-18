import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import type { Marketplace } from '@/lib/types'

// Milestone C12 (Phase 10M): session-aware Supabase wrapper for the
// clients/Brand table, following lib/catalog.ts's exact established
// pattern (Milestone 21/C1): every exported function derives ownership
// from the authenticated session via requireUserId(client) ->
// client.auth.getUser(), never from a parameter; every function takes an
// optional trailing `client`, defaulting to the real browser client, as
// the seam brands.test.ts uses to inject a mock. A separate file from
// lib/catalog.ts on purpose: clients/brands is a distinct domain from
// catalog_products/listings, the same reasoning lib/credits.ts and
// lib/productIntelligence.ts already split on.

export type MarketplacePreference = {
  enabled: boolean
  notes: string
}

export type MarketplacePreferences = Partial<Record<Marketplace, MarketplacePreference>>

export type BrandFields = {
  client_name: string
  brand_guidelines?: string | null
  brand_identity?: string | null
  brand_voice?: string | null
  target_audience?: string | null
  product_categories?: string[] | null
  positioning?: string | null
  marketplace_preferences?: MarketplacePreferences | null
}

export type BrandRow = {
  id: string
  user_id: string
  client_name: string
  brand_guidelines: string | null
  brand_identity: string | null
  brand_voice: string | null
  target_audience: string | null
  product_categories: string[] | null
  positioning: string | null
  marketplace_preferences: MarketplacePreferences | null
  created_at: string
  updated_at: string
}

async function requireUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser()
  if (error) throw error
  if (!data.user) throw new Error('brands: an authenticated session is required')
  return data.user.id
}

// No explicit owner filter: same RLS-only reasoning as lib/catalog.ts's
// getCatalog/getExportHistory: clients' existing SELECT policy
// (auth.uid() = user_id, unchanged by this migration) already returns only
// this session's own rows.
export async function listBrands(client: SupabaseClient = createClient()): Promise<BrandRow[]> {
  await requireUserId(client)

  const { data, error } = await client.from('clients').select('*').order('client_name')

  if (error) throw error
  return (data ?? []) as BrandRow[]
}

// RLS makes "doesn't exist" and "exists but isn't yours" the same result
// (null): callers must not try to distinguish them, same convention as
// lib/catalog.ts's getProductById.
export async function getBrand(id: string, client: SupabaseClient = createClient()): Promise<BrandRow | null> {
  await requireUserId(client)

  const { data, error } = await client.from('clients').select('*').eq('id', id).maybeSingle()

  if (error) throw error
  return data as BrandRow | null
}

// user_id is derived here, from the session, and is the only ownership
// value ever sent: fields never includes it (BrandFields has no such key),
// so there is no caller-suppliable ownership field to spoof.
export async function createBrand(fields: BrandFields, client: SupabaseClient = createClient()): Promise<BrandRow> {
  const userId = await requireUserId(client)

  const { data, error } = await client
    .from('clients')
    .insert({ ...fields, user_id: userId })
    .select()
    .single()

  if (error) throw error
  return data as BrandRow
}

// Ownership is enforced by RLS's existing UPDATE policy (USING + WITH
// CHECK auth.uid() = user_id): this function never receives or checks an
// owner id itself, and `fields` has no user_id key to strip or trust. If
// the row isn't owned by the session, RLS returns zero rows updated and
// .single() throws, which the caller's try/catch must treat as failure.
export async function updateBrand(
  id: string,
  fields: Partial<BrandFields>,
  client: SupabaseClient = createClient()
): Promise<BrandRow> {
  await requireUserId(client)

  const { data, error } = await client.from('clients').update(fields).eq('id', id).select().single()

  if (error) throw error
  return data as BrandRow
}
