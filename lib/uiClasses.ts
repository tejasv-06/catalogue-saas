// Shared Tailwind class strings for the workspace and marketing/auth pages —
// one definition per element type so buttons/inputs/cards/headings stay
// visually consistent instead of each call site inventing its own treatment.
// Theme-sensitive colors (surfaces, borders, text, semantic tints) read CSS
// custom properties defined in app/globals.css, which flip between dark
// ("Night", default) and light ("Day") based on the data-theme attribute
// ThemeToggle manages — see that file for the full variable set. Primary
// (blue-600), destructive (red-600), and warning-solid (amber-600) fills are
// deliberately NOT theme-sensitive — they're brand/semantic accent colors,
// constant across both themes by design.

// Most buttons using these shared classes sit on the card surface, not the
// bare page, so the focus-ring offset matches that.
const focusRing = 'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--card-bg)]'

// Disabled state: explicit neutral colors instead of opacity-dimming the
// button's own fill — reads more clearly as "not actionable" than a faded
// blue/red/amber, in both themes.
const disabledState = 'disabled:bg-[var(--disabled-bg)] disabled:text-[var(--disabled-text)] disabled:cursor-not-allowed'

// ring-white/15: blue-600's own fill already clears 3:1 against the dark-mode
// card background on its own — this ring is a safety margin, not a fix for a
// failing ratio. In light mode blue-600 against a white card has enormous
// contrast headroom regardless, so the same ring stays purely decorative
// there too — harmless either way.
export const buttonPrimaryClass =
  `bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm px-5 py-3 rounded-xl shadow-lg shadow-blue-500/20 ring-1 ring-white/15 ${focusRing} focus:ring-blue-500 ${disabledState} transition`

export const buttonSecondaryClass =
  `bg-[var(--secondary-btn-bg)] hover:bg-[var(--secondary-btn-bg-hover)] text-[var(--secondary-btn-text)] border border-[var(--secondary-btn-border)] rounded-xl px-4 py-2.5 text-sm font-medium ${focusRing} focus:ring-slate-500 ${disabledState} transition`

export const buttonDestructiveClass =
  `bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-4 py-2.5 rounded-xl shadow-lg shadow-red-500/20 ${focusRing} focus:ring-red-500 ${disabledState} transition`

export const buttonWarningClass =
  `bg-amber-600 hover:bg-amber-500 text-white font-medium text-sm px-4 py-2.5 rounded-xl shadow-lg shadow-amber-500/20 ${focusRing} focus:ring-amber-500 ${disabledState} transition`

// Small footprint variants, for dense contexts like table rows where the
// full-size buttons would be too tall.
export const buttonPrimarySmallClass =
  `bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded-lg text-xs font-medium ring-1 ring-white/15 ${focusRing} focus:ring-blue-500 ${disabledState} transition`

export const buttonSecondarySmallClass =
  `bg-[var(--secondary-btn-bg)] hover:bg-[var(--secondary-btn-bg-hover)] text-[var(--secondary-btn-text)] border border-[var(--secondary-btn-border)] px-2 py-1 rounded-lg text-xs font-medium ${focusRing} focus:ring-slate-500 ${disabledState} transition`

export const buttonDestructiveSmallClass =
  `bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded-lg text-xs font-medium ${focusRing} focus:ring-red-500 ${disabledState} transition`

// Text-only link-style action (View/Edit/Delete/Cancel) — underlined, no border/background.
export const linkButtonClass =
  `text-sm text-[var(--link-text)] underline hover:text-[var(--link-text-hover)] ${focusRing} focus:ring-blue-500/40 rounded transition`

export const linkButtonDestructiveClass =
  `text-sm text-[var(--danger-link-text)] underline hover:opacity-80 ${focusRing} focus:ring-red-500 rounded transition`

// Used by the two brand-voice-mismatch warning boxes (manual add + CSV upload).
export const buttonAmberOutlineClass =
  `bg-[var(--warn-bg)] border border-[var(--warn-border)] text-[var(--warn-text)] px-3 py-1.5 rounded-xl text-sm font-medium hover:bg-[var(--warn-bg-hover)] ${focusRing} focus:ring-amber-500 transition`

export const buttonAmberSolidClass =
  `bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-xl text-sm font-medium ${focusRing} focus:ring-amber-500 transition`

export const inputClass =
  `bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--heading-text)] placeholder-[var(--muted-text)] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition`

// Dropdown-specific treatment (marketplace/brand selects) — same input
// background, with its own hover state as a select-specific affordance.
export const selectClass =
  `bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--heading-text)] rounded-xl px-4 py-3 text-sm font-medium hover:bg-[var(--secondary-btn-bg-hover)] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition`

// No padding baked in on cardClass — callers apply p-6 uniformly. Every
// elevated surface (cards, drawer, modal) shares this one definition.
export const cardClass = 'bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl shadow-xl'

// Shared amber/red banner shells (brand-mismatch warnings, restore-session
// banner, generation-error box) — same shape everywhere, only the semantic
// color varies.
export const warningBannerClass = 'p-4 rounded-xl border border-[var(--warn-border)] bg-[var(--warn-bg)]'
export const warningTextClass = 'text-sm text-[var(--warn-text)]'
export const dangerBannerClass = 'p-4 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)]'
export const dangerTextClass = 'text-sm text-[var(--danger-text)]'

export const pageHeadingClass = 'text-2xl font-bold text-[var(--heading-text)]'
export const sectionHeadingClass = 'text-base font-semibold text-[var(--heading-text)]'
export const bodyTextClass = 'text-sm text-[var(--body-text)]'
export const labelClass = 'text-xs font-medium text-[var(--label-text)] uppercase tracking-wide'
