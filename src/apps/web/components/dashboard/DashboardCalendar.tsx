'use client';

import { RemindersPanel } from './RemindersPanel';

export function DashboardCalendar() {
  return (
    <div className="dash-calendar-page">
      <h1 className="dash-page-title">Calendar</h1>
      <p className="dash-page-subtitle">View and manage your reminders across all hubs.</p>
      <RemindersPanel variant="page" />
    </div>
  );
}
