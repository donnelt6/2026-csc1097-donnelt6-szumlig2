'use client';

import { CalendarIcon, ClipboardDocumentListIcon } from '@heroicons/react/24/outline';

export default function DashboardPage() {
  return (
    <main className="page-content page-content--hubs">
      <div className="content-inner">
        <div className="placeholder-page">
          <div className="placeholder-page-icons">
            <CalendarIcon className="placeholder-page-icon" />
            <ClipboardDocumentListIcon className="placeholder-page-icon" />
          </div>
          <h2 className="placeholder-page-title">Dashboard</h2>
          <p className="placeholder-page-desc">
            Coming soon: Your reminders calendar, guides overview, and activity feed across all hubs.
          </p>
        </div>
      </div>
    </main>
  );
}
