// Guest (not-signed-in) AI generation limit, enforced server-side against
// the anon_id cookie and the guest_usage table (see lib/guestId.ts and
// app/api/generate-single/route.ts). Shared here so marketing copy
// referencing this number (e.g. "10 Free Credits" CTAs) can't drift from
// what's actually enforced.
export const GUEST_GENERATION_LIMIT = 10
