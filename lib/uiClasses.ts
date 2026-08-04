// Shared Tailwind class strings for the workspace and marketing/auth pages —
// one definition per element type so buttons/inputs/cards/headings stay
// visually consistent instead of each call site inventing its own treatment.
// Two-tier flat color system: page bg #0b1726 (outermost canvas), card bg
// #112236 (every elevated panel — cards, headers, drawer, modal), input bg
// #080f1a (darkest, for maximum text contrast on typed content). blue-600
// primary actions (brighten to blue-500 on hover, not darken — the dark-mode
// convention), red/amber kept for destructive/warning semantics.

// Most buttons using these shared classes sit on the card surface (#112236),
// not the bare page, so the focus-ring offset matches that.
const focusRing = 'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#112236]'

// Disabled state: explicit neutral colors instead of opacity-dimming the
// button's own fill — reads more clearly as "not actionable" than a faded
// blue/red/amber. text-slate-500 (not slate-600) on bg-slate-900/40 checked
// at ~3.52:1 against the card background — comfortably legible while still
// clearly muted.
const disabledState = 'disabled:bg-slate-900/40 disabled:text-slate-500 disabled:cursor-not-allowed'

// ring-white/15: blue-600's own fill already clears 3:1 against the card
// background on its own (~3.11:1, checked fresh) — this ring is a safety
// margin against that thin gap, not a fix for a failing ratio (unlike the
// /40–/50 needed against the two earlier, darker-adjacent backgrounds).
export const buttonPrimaryClass =
  `bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm px-5 py-3 rounded-xl shadow-lg shadow-blue-500/20 ring-1 ring-white/15 ${focusRing} focus:ring-blue-500 ${disabledState} transition`

export const buttonSecondaryClass =
  `bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm font-medium ${focusRing} focus:ring-slate-500 ${disabledState} transition`

export const buttonDestructiveClass =
  `bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-4 py-2.5 rounded-xl shadow-lg shadow-red-500/20 ${focusRing} focus:ring-red-500 ${disabledState} transition`

export const buttonWarningClass =
  `bg-amber-600 hover:bg-amber-500 text-white font-medium text-sm px-4 py-2.5 rounded-xl shadow-lg shadow-amber-500/20 ${focusRing} focus:ring-amber-500 ${disabledState} transition`

// Small footprint variants, for dense contexts like table rows where the
// full-size buttons would be too tall.
export const buttonPrimarySmallClass =
  `bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded-lg text-xs font-medium ring-1 ring-white/15 ${focusRing} focus:ring-blue-500 ${disabledState} transition`

export const buttonSecondarySmallClass =
  `bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700/80 px-2 py-1 rounded-lg text-xs font-medium ${focusRing} focus:ring-slate-500 ${disabledState} transition`

export const buttonDestructiveSmallClass =
  `bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded-lg text-xs font-medium ${focusRing} focus:ring-red-500 ${disabledState} transition`

// Text-only link-style action (View/Edit/Delete/Cancel) — underlined, no border/background.
export const linkButtonClass =
  `text-sm text-slate-400 underline hover:text-slate-100 ${focusRing} focus:ring-blue-500/40 rounded transition`

export const linkButtonDestructiveClass =
  `text-sm text-red-400 underline hover:text-red-300 ${focusRing} focus:ring-red-500 rounded transition`

// Used by the two brand-voice-mismatch warning boxes (manual add + CSV upload) —
// dark-glass amber tint instead of a solid light background.
export const buttonAmberOutlineClass =
  `bg-amber-950/40 border border-amber-700/60 text-amber-300 px-3 py-1.5 rounded-xl text-sm font-medium hover:bg-amber-900/50 ${focusRing} focus:ring-amber-500 transition`

export const buttonAmberSolidClass =
  `bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-xl text-sm font-medium ${focusRing} focus:ring-amber-500 transition`

export const inputClass =
  'bg-[#080f1a] border border-slate-800 text-slate-100 placeholder-slate-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition'

// Dropdown-specific treatment (marketplace/brand selects) — same flat input
// background, with its own hover state as a select-specific affordance.
export const selectClass =
  'bg-[#080f1a] border border-slate-800 text-slate-100 rounded-xl px-4 py-3 text-sm font-medium hover:bg-slate-900/70 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition'

// No padding baked in on cardClass — callers apply p-6 uniformly. Flat
// #112236 now (not translucent) — every elevated surface (cards, headers,
// drawer, modal) shares this exact color, distinct from the page's #0b1726.
export const cardClass = 'bg-[#112236] border border-slate-800/80 rounded-2xl shadow-xl'

export const pageHeadingClass = 'text-2xl font-bold text-slate-100'
export const sectionHeadingClass = 'text-base font-semibold text-slate-100'
export const bodyTextClass = 'text-sm text-slate-300'
export const labelClass = 'text-xs font-medium text-slate-400 uppercase tracking-wide'
