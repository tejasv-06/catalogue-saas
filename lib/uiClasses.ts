// Shared Tailwind class strings for the workspace UI — one definition per
// element type so buttons/inputs/cards/headings stay visually consistent
// instead of each call site inventing its own padding/radius/focus treatment.
// Palette: brand blue (primary actions, extracted from the Tesolute logo
// gradient), emerald (approve/success), slate (neutral surfaces/text),
// red/amber kept for destructive/warning semantics.

const BRAND_BLUE = '#2563eb'
const BRAND_BLUE_HOVER = '#1d4ed8'

const focusRing = 'focus:outline-none focus:ring-2 focus:ring-offset-2'

export const buttonPrimaryClass =
  `bg-[${BRAND_BLUE}] hover:bg-[${BRAND_BLUE_HOVER}] text-white font-medium text-sm px-4 py-2.5 rounded-lg shadow-sm ${focusRing} focus:ring-[${BRAND_BLUE}] disabled:opacity-50 disabled:cursor-not-allowed transition`

export const buttonSecondaryClass =
  `border border-slate-300 text-slate-700 font-medium text-sm px-4 py-2.5 rounded-lg hover:bg-slate-50 ${focusRing} focus:ring-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition`

export const buttonDestructiveClass =
  `bg-red-600 hover:bg-red-700 text-white font-medium text-sm px-4 py-2.5 rounded-lg shadow-sm ${focusRing} focus:ring-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition`

// The "Secondary CTA" in the modern-dashboard spec (bulk approve etc.) — kept
// the buttonSuccessClass name since it's semantically success/approve, just
// recolored from green to emerald to match the new palette.
export const buttonSuccessClass =
  `bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm px-4 py-2 rounded-lg shadow-sm ${focusRing} focus:ring-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition`

export const buttonWarningClass =
  `bg-amber-600 hover:bg-amber-700 text-white font-medium text-sm px-4 py-2.5 rounded-lg shadow-sm ${focusRing} focus:ring-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition`

// Small footprint variant of buttonPrimaryClass/buttonSecondaryClass, for
// dense contexts like table rows where the full-size buttons would be too tall.
export const buttonPrimarySmallClass =
  `bg-[${BRAND_BLUE}] hover:bg-[${BRAND_BLUE_HOVER}] text-white px-2 py-1 rounded-lg text-xs font-medium ${focusRing} focus:ring-[${BRAND_BLUE}] disabled:opacity-50 disabled:cursor-not-allowed transition`

export const buttonSecondarySmallClass =
  `border border-slate-300 text-slate-700 px-2 py-1 rounded-lg text-xs font-medium hover:bg-slate-50 ${focusRing} focus:ring-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition`

export const buttonDestructiveSmallClass =
  `bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded-lg text-xs font-medium ${focusRing} focus:ring-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition`

// Text-only link-style action (View/Edit/Delete/Cancel) — underlined, no border/background.
export const linkButtonClass =
  `text-sm text-slate-600 underline hover:text-slate-900 ${focusRing} focus:ring-[${BRAND_BLUE}]/40 rounded transition`

export const linkButtonDestructiveClass =
  `text-sm text-red-600 underline hover:text-red-800 ${focusRing} focus:ring-red-500 rounded transition`

// Used by the two brand-voice-mismatch warning boxes (manual add + CSV upload) —
// amber isn't one of the primary/secondary/destructive variants, but the same
// pairing shows up in two places so it's still worth sharing.
export const buttonAmberOutlineClass =
  `bg-white border border-amber-400 text-amber-800 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-amber-50 ${focusRing} focus:ring-amber-500 transition`

export const buttonAmberSolidClass =
  `bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium ${focusRing} focus:ring-amber-600 transition`

export const inputClass =
  `border border-slate-300 rounded-lg p-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[${BRAND_BLUE}]/20 focus:border-[${BRAND_BLUE}] transition`

// Dropdown-specific treatment (marketplace/brand selects) — distinct from
// inputClass per the modern-dashboard spec: filled slate background instead
// of plain white, with its own hover state.
export const selectClass =
  `bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 font-medium hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[${BRAND_BLUE}]/20 focus:border-[${BRAND_BLUE}] transition`

// No padding baked in — callers apply their own (p-4, p-5, etc.) since cards
// range from dense sub-tables to full form panels.
export const cardClass = 'bg-white border border-slate-200/80 rounded-xl shadow-sm'

export const pageHeadingClass = 'text-2xl font-bold text-slate-900'
export const sectionHeadingClass = 'text-base font-semibold text-slate-900'
export const bodyTextClass = 'text-sm text-slate-700'
export const labelClass = 'text-xs font-medium text-slate-500 uppercase tracking-wide'
