'use client';

// DashboardCalendar.tsx: Calendar tab combining the mini calendar with a reminders sidebar.

import { DashboardRemindersPanel } from './DashboardRemindersPanel';

export function DashboardCalendar() {
  return (
    <div className="dash-calendar-page">
      <h1 className="dash-page-title">Calendar</h1>
      <p className="dash-page-subtitle">View and manage your reminders across all hubs.</p>
      <DashboardRemindersPanel variant="page" />
    </div>
  );
}
