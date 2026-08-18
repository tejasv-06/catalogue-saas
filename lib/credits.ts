import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js'

export { CREDIT_COSTS } from '@/lib/creditCosts'

export class InsufficientCreditsError extends Error {
  constructor(
    public required: number,
    public available: number
  ) {
    super(`Insufficient credits: this action costs ${required}, you have ${available} remaining.`)
  }
}

// service_role key is read ONLY here, inside this server-only module: same
// discipline as the admin-client helpers in app/api/generate-single/route.ts
// and app/api/upload-image/route.ts.
function getSupabaseAdminClient() {
  return createSupabaseAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// First-time check: a signed-in user with no user_credits row yet gets one
// created here with the starting balance, rather than requiring a separate
// signup-time provisioning step.
export async function getOrCreateCreditBalance(userId: string): Promise<number> {
  const admin = getSupabaseAdminClient()

  const { data, error } = await admin
    .from('user_credits')
    .select('credits_remaining')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  if (data) return data.credits_remaining

  const { data: inserted, error: insertError } = await admin
    .from('user_credits')
    .insert({ user_id: userId })
    .select('credits_remaining')
    .single()

  if (insertError) throw insertError
  return inserted.credits_remaining
}

// Called before doing any Groq/Claude work. Throws InsufficientCreditsError
// (caught by the route and turned into a 403) rather than a boolean, so the
// route can report exactly how many credits were needed vs. available.
export async function assertSufficientCredits(userId: string, cost: number): Promise<number> {
  const balance = await getOrCreateCreditBalance(userId)
  if (balance < cost) {
    throw new InsufficientCreditsError(cost, balance)
  }
  return balance
}

// Milestone 27 (C5): the ledger this records into (credit_transactions)
// only accepts these values, enforced by a CHECK constraint (not a Postgres
// enum/type: 'reason' is a plain text column) originally added in
// supabase/migrations/20260810_04_credit_transaction_ledger.sql and widened
// in supabase/migrations/20260819_01_credit_transaction_reason_image_grouping.sql
// to add 'image_grouping' (Milestone C18: the 1-credit "Group Into
// Multiple Products" charge in app/api/group-product-images/route.ts).
// 'refund' is defined here because the schema/type already accounts for it
//: no refund trigger or UI exists yet, and building one is explicitly out
// of scope for this milestone.
export type CreditTransactionReason = 'generation' | 'account_audit' | 'refund' | 'image_grouping'

// Called only after a generation has already succeeded. Uses the
// deduct_credits RPC (atomic UPDATE ... SET credits_remaining =
// credits_remaining - amount, guarded by credits_remaining >= p_amount)
// instead of a read-modify-write in application code, so two concurrent
// deductions for the same user can't lose an update or drive the balance
// negative. As of Milestone 27, the same RPC call also inserts one
// credit_transactions row (delta = -amount, reason = the value passed
// here) atomically alongside the balance update: both happen in the same
// database function call, so there is no separate insert on this side to
// keep in sync, and no way for one to succeed without the other.
//
// The RPC returns zero rows (data === null) when the guard fails: e.g. a
// race where a concurrent request already spent the balance between this
// request's earlier assertSufficientCredits check and this call. That must
// be treated as a failed deduction, not a successful one: checking only
// `error` here would silently swallow that case, since a guard-clause
// no-op is not a Postgres error. Deliberately `=== null`/`=== undefined`,
// not a falsy check: a deduction that lands exactly on a balance of 0 is
// a valid success (`data === 0`), and `0` is falsy in JS. A rejected guard
// also means no ledger row was inserted (see the migration's `deducted`/
// `logged` CTEs): a failed deduction never produces a ledger entry.
export async function deductCredits(
  userId: string,
  amount: number,
  reason: CreditTransactionReason
): Promise<number> {
  const admin = getSupabaseAdminClient()
  const { data, error } = await admin.rpc('deduct_credits', { p_user_id: userId, p_amount: amount, p_reason: reason })
  if (error) throw error
  if (data === null || data === undefined) {
    throw new InsufficientCreditsError(amount, 0)
  }
  return data as number
}
