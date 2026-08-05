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

// service_role key is read ONLY here, inside this server-only module — same
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

// Called only after a generation has already succeeded. Uses the
// deduct_credits RPC (atomic UPDATE ... SET credits_remaining =
// credits_remaining - amount) instead of a read-modify-write in application
// code, so two concurrent deductions for the same user can't lose an update.
export async function deductCredits(userId: string, amount: number): Promise<void> {
  const admin = getSupabaseAdminClient()
  const { error } = await admin.rpc('deduct_credits', { p_user_id: userId, p_amount: amount })
  if (error) throw error
}
