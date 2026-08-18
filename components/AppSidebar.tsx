"use client"

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'

// Bulk Upload / Manual Entry / Image-Only used to live here as three
// top-level nav destinations. They're input methods into the one Listings
// workspace, not separate destinations: CatalogueWorkspace now owns that
// switch as an in-panel tab-strip (see its 'Add Products' section) using
// this same state type, which is why it's still exported from here rather
// than moved: the smallest change that keeps that import working.
export type WorkspaceDestination = 'csv' | 'manual' | 'image'

type SidebarItemId = 'listings' | 'audit'

const COLLAPSE_STORAGE_KEY = 'workspace-sidebar-collapsed'

function ListingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <rect x="3" y="10" width="18" height="4" rx="1" />
      <rect x="3" y="16" width="18" height="4" rx="1" />
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

// Points at the panel edge it collapses toward: left-facing chevron means
// "collapse" (content retreats left), right-facing means "expand." Exported
// so any other collapsible-to-a-narrow-rail panel (e.g. CatalogueWorkspace's
// Add Products panel) reuses this exact icon instead of a second copy.
export function ChevronIcon({ pointingRight }: { pointingRight: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform ${pointingRight ? 'rotate-180' : ''}`}
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

// Two real destinations now, each its own group: Listings under Catalog,
// Account Audit under Tools. Account Audit was previously one divider away
// from Bulk Upload/Manual Entry/Image-Only in a single flat list; grouping
// makes it explicit that it's a separate tool, not a peer input method.
const NAV_ITEMS: { id: SidebarItemId; label: string; groupLabel: string; href: string; icon: ReactNode }[] = [
  { id: 'listings', label: 'Listings', groupLabel: 'Catalog', href: '/workspace', icon: <ListingsIcon /> },
  { id: 'audit', label: 'Account Audit', groupLabel: 'Tools', href: '/audit', icon: <AuditIcon /> }
]

const itemBaseClass =
  'flex items-center gap-3 shrink-0 px-3 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--card-bg)] focus:ring-blue-500'
const itemActiveClass = 'bg-blue-600 text-white shadow-sm'
const itemInactiveClass = 'text-[var(--muted-text)] hover:text-[var(--heading-text)] hover:bg-[var(--secondary-btn-bg-hover)]'
const groupLabelClass = 'px-3 pt-1 pb-1 text-[10px] font-semibold tracking-wider text-[var(--muted-text)] uppercase'

// Shared nav, rendered on both /workspace and /audit, anchored directly
// beneath TopHeader (top-16, not top-0) and stretching to the bottom of the
// screen. Just the two destinations now: logo, credits, theme, and logout
// all live in TopHeader instead. Both are plain Links (no client-side panel
// switching happens at this level anymore): Listings always goes to
// /workspace, Account Audit always goes to /audit. That route's own
// server-side auth check (redirect to /login?next=/audit) already handles
// the logged-out case identically whether you arrive via this link or by
// typing the URL directly; nothing sidebar-specific needed there.
export default function AppSidebar({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const isWorkspacePage = pathname === '/workspace'
  const isAuditPage = pathname === '/audit'

  // Expanded by default on a first visit (no stored preference yet): nav
  // should be immediately visible and discoverable without relying on the
  // user finding a hover trigger. Collapsing is an explicit, persisted
  // choice via the toggle button below, not the default.
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true') {
      setCollapsed(true)
    }
  }, [])

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next))
      return next
    })
  }

  function renderItem(item: (typeof NAV_ITEMS)[number], compactLabel: boolean) {
    const isActive = item.id === 'audit' ? isAuditPage : isWorkspacePage
    // Only the desktop rail (compactLabel=true) ever collapses: the mobile
    // bar (compactLabel=false) always shows full labels regardless of this
    // state, since collapse is a desktop-only concept here.
    const isIconOnly = compactLabel && collapsed
    const className = `${itemBaseClass} ${isActive ? itemActiveClass : itemInactiveClass} ${isIconOnly ? 'justify-center' : ''}`

    return (
      <Link key={item.id} href={item.href} aria-current={isActive ? 'page' : undefined} title={isIconOnly ? item.label : undefined} className={className}>
        {item.icon}
        {!isIconOnly && <span>{item.label}</span>}
      </Link>
    )
  }

  const [listingsItem, auditItem] = NAV_ITEMS

  return (
    <>
      {/* Desktop: fixed-left icon rail anchored below TopHeader (top-16, not
          top-0), stretching to the bottom of the screen. Expanded (256px) by
          default; the toggle button below collapses it to 56px icon-only,
          click-driven and persisted via localStorage: no hover behavior.
          Expanded is now the persistent default rather than a transient
          hover preview, so it PUSHES the content area (see the padding on
          the wrapper below) instead of overlaying on top of it: an overlay
          would otherwise permanently cover the leftmost ~200px of page
          content (e.g. the marketplace chips) for every first-time visitor. */}
      <nav
        aria-label="Main navigation"
        className={`hidden lg:flex fixed left-0 top-16 h-[calc(100vh-4rem)] z-40 flex-col bg-[var(--card-bg)] border-r border-[var(--card-border)] overflow-hidden transition-[width] duration-200 ${
          collapsed ? 'w-14' : 'w-64'
        }`}
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`flex items-center shrink-0 px-3 py-2 mt-2 mx-2 rounded-lg text-[var(--muted-text)] hover:text-[var(--heading-text)] hover:bg-[var(--secondary-btn-bg-hover)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--card-bg)] focus:ring-blue-500 transition-colors ${
            collapsed ? 'justify-center' : 'justify-end'
          }`}
        >
          <ChevronIcon pointingRight={collapsed} />
        </button>

        <div className="flex-1 flex flex-col gap-1 px-2 py-2 overflow-y-auto">
          {!collapsed && <p className={groupLabelClass}>{listingsItem.groupLabel}</p>}
          {renderItem(listingsItem, true)}
          <div className="my-2 border-t border-[var(--card-border)]" />
          {!collapsed && <p className={groupLabelClass}>{auditItem.groupLabel}</p>}
          {renderItem(auditItem, true)}
        </div>
      </nav>

      {/* Mobile / tablet: normal-flow horizontal bar: no collapse concept
          here, always shows full labels. Same grouping as the desktop rail,
          via a vertical divider instead of a label (no room for both). */}
      <nav aria-label="Main navigation" className="flex lg:hidden items-center gap-1 p-2 overflow-x-auto bg-[var(--card-bg)] border-b border-[var(--card-border)]">
        {renderItem(listingsItem, false)}
        <div className="self-stretch w-px mx-1 bg-[var(--card-border)]" />
        {renderItem(auditItem, false)}
      </nav>

      {/* flex-1 min-h-0: this and the mobile nav bar above are siblings
          inside the parent's own flex-col: this claims whatever height is
          left over after that bar's real rendered height, rather than a
          fixed height that doesn't know the bar is even there. */}
      <div
        className={`flex-1 min-h-0 flex flex-col transition-[padding] duration-200 ${collapsed ? 'lg:pl-14' : 'lg:pl-64'}`}
      >
        {children}
      </div>
    </>
  )
}
