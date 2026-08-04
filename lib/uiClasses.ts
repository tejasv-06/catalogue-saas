// Shared Tailwind class strings for the workspace UI — one definition per
// element type so buttons/inputs/cards/headings stay visually consistent
// instead of each call site inventing its own padding/radius/focus treatment.

const focusRing = 'focus:outline-none focus:ring-2 focus:ring-offset-2'

export const buttonPrimaryClass =
  `bg-black text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-800 ${focusRing} focus:ring-black disabled:opacity-50 disabled:cursor-not-allowed transition-colors`

export const buttonSecondaryClass =
  `border border-gray-300 text-gray-700 px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-50 ${focusRing} focus:ring-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors`

export const buttonDestructiveClass =
  `bg-red-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-red-700 ${focusRing} focus:ring-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors`

export const buttonSuccessClass =
  `bg-green-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-green-700 ${focusRing} focus:ring-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors`

export const buttonWarningClass =
  `bg-yellow-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-yellow-700 ${focusRing} focus:ring-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors`

// Small footprint variant of buttonPrimaryClass/buttonSecondaryClass, for
// dense contexts like table rows where px-3 py-2 buttons would be too tall.
export const buttonPrimarySmallClass =
  `bg-black text-white px-2 py-1 rounded-md text-xs font-medium hover:bg-gray-800 ${focusRing} focus:ring-black disabled:opacity-50 disabled:cursor-not-allowed transition-colors`

export const buttonSecondarySmallClass =
  `border border-gray-300 text-gray-700 px-2 py-1 rounded-md text-xs font-medium hover:bg-gray-50 ${focusRing} focus:ring-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors`

export const buttonDestructiveSmallClass =
  `bg-red-600 text-white px-2 py-1 rounded-md text-xs font-medium hover:bg-red-700 ${focusRing} focus:ring-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors`

// Text-only link-style action (View/Edit/Delete/Cancel) — underlined, no border/background.
export const linkButtonClass =
  `text-sm text-gray-600 underline hover:text-black ${focusRing} focus:ring-black/50 rounded transition-colors`

export const linkButtonDestructiveClass =
  `text-sm text-red-600 underline hover:text-red-800 ${focusRing} focus:ring-red-500 rounded transition-colors`

// Used by the two brand-voice-mismatch warning boxes (manual add + CSV upload) —
// amber isn't one of the primary/secondary/destructive variants, but the same
// pairing shows up in two places so it's still worth sharing.
export const buttonAmberOutlineClass =
  `bg-white border border-amber-400 text-amber-800 px-3 py-1 rounded-md text-sm font-medium hover:bg-amber-50 ${focusRing} focus:ring-amber-500 transition-colors`

export const buttonAmberSolidClass =
  `bg-amber-600 text-white px-3 py-1 rounded-md text-sm font-medium hover:bg-amber-700 ${focusRing} focus:ring-amber-600 transition-colors`

export const inputClass =
  `border border-gray-300 rounded-md p-2 text-sm ${focusRing} focus:ring-black/70 focus:border-black transition-colors`

export const cardClass = 'border border-gray-200 rounded-lg bg-white'

export const pageHeadingClass = 'text-2xl font-bold text-gray-900'
export const sectionHeadingClass = 'text-base font-semibold text-gray-900'
export const bodyTextClass = 'text-sm text-gray-700'
export const labelClass = 'text-xs font-medium text-gray-500 uppercase tracking-wide'
