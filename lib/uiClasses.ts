// Shared Tailwind class strings for the workspace and marketing/auth pages —
// one definition per element type so buttons/inputs/cards/headings stay
// visually consistent instead of each call site inventing its own treatment.
// Dark glass system: slate-950/900 translucent surfaces with backdrop-blur,
// blue-600 primary actions (brighten to blue-500 on hover, not darken — the
// dark-mode convention), red/amber kept for destructive/warning semantics
// but recolored for a dark background instead of the light one they
// originally assumed.

const focusRing = 'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950'

export const buttonPrimaryClass =
  `bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm px-5 py-3 rounded-xl shadow-lg shadow-blue-500/20 ${focusRing} focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition`

export const buttonSecondaryClass =
  `bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm font-medium ${focusRing} focus:ring-slate-500 disabled:opacity-50 disabled:cursor-not-allowed transition`

export const buttonDestructiveClass =
  `bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-4 py-2.5 rounded-xl shadow-lg shadow-red-500/20 ${focusRing} focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition`

export const buttonWarningClass =
  `bg-amber-600 hover:bg-amber-500 text-white font-medium text-sm px-4 py-2.5 rounded-xl shadow-lg shadow-amber-500/20 ${focusRing} focus:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition`

// Small footprint variants, for dense contexts like table rows where the
// full-size buttons would be too tall.
export const buttonPrimarySmallClass =
  `bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded-lg text-xs font-medium ${focusRing} focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition`

export const buttonSecondarySmallClass =
  `bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700/80 px-2 py-1 rounded-lg text-xs font-medium ${focusRing} focus:ring-slate-500 disabled:opacity-50 disabled:cursor-not-allowed transition`

export const buttonDestructiveSmallClass =
  `bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded-lg text-xs font-medium ${focusRing} focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition`

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
  'bg-slate-950/70 border border-slate-800 text-slate-100 placeholder-slate-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition'

// Dropdown-specific treatment (marketplace/brand selects) — same dark glass
// as inputClass, with its own hover state as a select-specific affordance.
export const selectClass =
  'bg-slate-950/70 border border-slate-800 text-slate-100 rounded-xl px-4 py-3 text-sm font-medium hover:bg-slate-900/70 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition'

// No padding baked in on cardClass — callers apply p-6 uniformly per the
// dark-glass spec.
export const cardClass = 'bg-slate-900/70 border border-slate-800/80 rounded-2xl shadow-xl backdrop-blur-sm'

export const pageHeadingClass = 'text-2xl font-bold text-slate-100'
export const sectionHeadingClass = 'text-base font-semibold text-slate-100'
export const bodyTextClass = 'text-sm text-slate-300'
export const labelClass = 'text-xs font-medium text-slate-400 uppercase tracking-wide'
