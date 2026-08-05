"use client"

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'

export type WorkspaceDestination = 'csv' | 'manual' | 'image'
type Destination = WorkspaceDestination | 'audit'

function UploadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  )
}

function AuditIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  )
}

const DESTINATIONS: { id: Destination; label: string; icon: ReactNode }[] = [
  { id: 'csv', label: 'Bulk Upload', icon: <UploadIcon /> },
  { id: 'manual', label: 'Manual Entry', icon: <PencilIcon /> },
  { id: 'image', label: 'Image-Only Generate', icon: <ImageIcon /> },
  { id: 'audit', label: 'Account Audit', icon: <AuditIcon /> }
]

const itemBaseClass =
  'flex items-center gap-3 shrink-0 px-3 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--card-bg)] focus:ring-blue-500'
const itemActiveClass = 'bg-blue-600 text-white shadow-sm'
const itemInactiveClass = 'text-[var(--muted-text)] hover:text-[var(--heading-text)] hover:bg-[var(--secondary-btn-bg-hover)]'

// Shared nav, rendered on both /workspace and /audit, anchored directly
// beneath TopHeader (top-16, not top-0) and stretching to the bottom of the
// screen. Just the four destinations now — logo, credits, theme, and logout
// all live in TopHeader instead. The three generation destinations
// (csv/manual/image) live inside /workspace as client-side panel state, not
// separate routes — so clicking one while already on /workspace just swaps
// local state (no navigation), but clicking one from /audit (or anywhere
// else) is a real navigation to /workspace?tab=<id>, which CatalogueWorkspace
// reads on mount to land on the right panel. "Account Audit" is always a
// plain Link to /audit — that route's own server-side auth check (redirect
// to /login?next=/audit) already handles the logged-out case identically
// whether you arrive via this link or by typing the URL directly; nothing
// sidebar-specific needed there.
export default function AppSidebar({
  activeDestination,
  onDestinationChange
}: {
  activeDestination?: WorkspaceDestination
  onDestinationChange?: (destination: WorkspaceDestination) => void
}) {
  const pathname = usePathname()
  const isWorkspacePage = pathname === '/workspace'
  const isAuditPage = pathname === '/audit'

  function renderItem(destination: (typeof DESTINATIONS)[number], compactLabel: boolean) {
    const isActive = destination.id === 'audit' ? isAuditPage : isWorkspacePage && activeDestination === destination.id
    // Centered while actually collapsed; reverts to normal left-alignment
    // once the rail expands (hover or focus-within) and the label reappears
    // — without the group-hover override this would stay centered even at
    // full width, since it doesn't otherwise know the rail has expanded.
    const className = `${itemBaseClass} ${isActive ? itemActiveClass : itemInactiveClass} ${
      compactLabel ? 'lg:justify-center lg:group-hover:justify-start lg:group-focus-within:justify-start' : ''
    }`

    const content = (
      <>
        {destination.icon}
        <span className={compactLabel ? 'hidden group-hover:inline group-focus-within:inline' : ''}>{destination.label}</span>
      </>
    )

    if (destination.id !== 'audit' && isWorkspacePage) {
      return (
        <button
          key={destination.id}
          type="button"
          onClick={() => onDestinationChange?.(destination.id as WorkspaceDestination)}
          aria-current={isActive ? 'page' : undefined}
          title={compactLabel ? destination.label : undefined}
          className={className}
        >
          {content}
        </button>
      )
    }

    const href = destination.id === 'audit' ? '/audit' : `/workspace?tab=${destination.id}`
    return (
      <Link key={destination.id} href={href} aria-current={isActive ? 'page' : undefined} title={compactLabel ? destination.label : undefined} className={className}>
        {content}
      </Link>
    )
  }

  return (
    <>
      {/* Desktop: fixed-left icon rail anchored below TopHeader (top-16, not
          top-0), stretching to the bottom of the screen. Collapsed 56px by
          default, expands to 256px on hover/focus (pure CSS — no JS state,
          no persisted "pinned" preference). Overlays the content area rather
          than pushing it, so hovering never reflows the page underneath. */}
      <nav
        aria-label="Main navigation"
        className="group hidden lg:flex fixed left-0 top-16 h-[calc(100vh-4rem)] w-14 hover:w-64 focus-within:w-64 z-40 flex-col bg-[var(--card-bg)] border-r border-[var(--card-border)] overflow-hidden hover:overflow-visible focus-within:overflow-visible hover:shadow-2xl transition-[width] duration-200"
      >
        <div className="flex-1 flex flex-col gap-1 px-2 py-2 overflow-y-auto">{DESTINATIONS.map((d) => renderItem(d, true))}</div>
      </nav>

      {/* Mobile / tablet: normal-flow horizontal bar — hover has no
          equivalent on touch, so this is a plain always-visible bar rather
          than a collapsed/expand-on-interact rail. */}
      <nav aria-label="Main navigation" className="flex lg:hidden items-center gap-1 p-2 overflow-x-auto bg-[var(--card-bg)] border-b border-[var(--card-border)]">
        {DESTINATIONS.map((d) => renderItem(d, false))}
      </nav>
    </>
  )
}
