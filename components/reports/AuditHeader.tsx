import { pageHeadingClass } from '@/lib/uiClasses'

// Logo, credits balance, theme toggle, and logout all moved into AppSidebar
// (shared with /workspace): this is just the page heading now.
export default function AuditHeader() {
  return (
    <div className="mb-6">
      <h1 className={pageHeadingClass}>Account Audit &amp; Insights</h1>
    </div>
  )
}
