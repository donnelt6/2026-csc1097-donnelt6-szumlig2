'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listHubs, listReminders } from '../../lib/api';
import { MiniCalendar } from './MiniCalendar';

export function DashboardCalendar() {
  const now = new Date();
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const { data: hubs } = useQuery({
    queryKey: ['hubs'],
    queryFn: listHubs,
  });

  const { data: reminders } = useQuery({
    queryKey: ['dashboard-reminders'],
    queryFn: () => listReminders({}),
  });

  const hubNameMap = new Map<string, string>();
  hubs?.forEach((h) => hubNameMap.set(h.id, h.name));

  const monthReminders = reminders?.filter((r) => {
    const d = new Date(r.due_at);
    return d.getMonth() === calMonth && d.getFullYear() === calYear;
  }) ?? [];

  const reminderDays = new Set(monthReminders.map((r) => new Date(r.due_at).getDate()));

  const dayReminders = selectedDay !== null
    ? monthReminders.filter((r) => new Date(r.due_at).getDate() === selectedDay)
    : [];

  const handleDayClick = (day: number) => {
    setSelectedDay(selectedDay === day ? null : day);
  };

  const handleMonthChange = (m: number, y: number) => {
    setCalMonth(m);
    setCalYear(y);
    setSelectedDay(null);
  };

  return (
    <div className="dash-calendar-page">
      <h1 className="dash-page-title">Calendar</h1>
      <p className="dash-page-subtitle">View and manage your reminders across all hubs.</p>

      <div className="dash-calendar-layout">
        <div className="dash-calendar-main dash-reminders-card">
          <MiniCalendar
            month={calMonth}
            year={calYear}
            onMonthChange={handleMonthChange}
            reminderDays={reminderDays}
            onDayClick={handleDayClick}
            selectedDay={selectedDay}
          />
        </div>

        <div className="dash-calendar-detail">
          {selectedDay !== null ? (
            <>
              <h3 className="dash-calendar-detail-title">
                {new Date(calYear, calMonth, selectedDay).toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </h3>
              {dayReminders.length > 0 ? (
                <div className="dash-reminder-list">
                  {dayReminders.map((r) => {
                    const dueDate = new Date(r.due_at);
                    return (
                      <div key={r.id} className="dash-reminder-item">
                        <div className={`dash-reminder-dot-wrap dash-reminder-dot-wrap--${r.status}`}>
                          <span className="dash-reminder-dot-inner" />
                        </div>
                        <div className="dash-reminder-info">
                          <p className="dash-reminder-title">{r.message || 'Reminder'}</p>
                          <p className="dash-reminder-meta">
                            {hubNameMap.get(r.hub_id) ?? 'Hub'} &middot;{' '}
                            {dueDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} &middot;{' '}
                            {dueDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                          </p>
                        </div>
                        <span className={`dash-reminder-status dash-reminder-status--${r.status}`}>
                          {r.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="muted">No reminders for this day.</p>
              )}
            </>
          ) : (
            <div className="dash-calendar-empty">
              <p className="muted">Select a day to view reminders.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
