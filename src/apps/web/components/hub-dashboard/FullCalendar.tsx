'use client';

// FullCalendar.tsx: Full-size calendar view for browsing reminders by month.

import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import type { Reminder, ReminderCandidate } from '@shared/index';
import { getHubColorOption } from '../../lib/hubAppearance';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MAX_VISIBLE_EVENTS = 2;

interface FullCalendarProps {
  month: number;
  year: number;
  onMonthChange: (month: number, year: number) => void;
  reminders: Reminder[];
  candidates: ReminderCandidate[];
  selectedDate: Date | null;
  onDateClick: (date: Date) => void;
}

type CalendarEvent =
  | { type: 'reminder'; data: Reminder }
  | { type: 'candidate'; data: ReminderCandidate };

function getReminderEventStyle(reminder: Reminder): CSSProperties {
  const color = getHubColorOption(reminder.color_key).value;
  return {
    '--reminder-accent-color': color,
  } as CSSProperties;
}

export function FullCalendar({
  month,
  year,
  onMonthChange,
  reminders,
  candidates,
  selectedDate,
  onDateClick,
}: FullCalendarProps) {
  const today = new Date();
  const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;
  const todayDate = isCurrentMonth ? today.getDate() : -1;

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const selectedDay =
    selectedDate &&
    selectedDate.getMonth() === month &&
    selectedDate.getFullYear() === year
      ? selectedDate.getDate()
      : null;

  const eventsByDay = useMemo(() => {
    const map = new Map<number, CalendarEvent[]>();

    for (const r of reminders) {
      const d = new Date(r.due_at);
      if (d.getMonth() === month && d.getFullYear() === year) {
        const day = d.getDate();
        if (!map.has(day)) map.set(day, []);
        map.get(day)!.push({ type: 'reminder', data: r });
      }
    }

    for (const c of candidates) {
      const d = new Date(c.due_at);
      if (d.getMonth() === month && d.getFullYear() === year) {
        const day = d.getDate();
        if (!map.has(day)) map.set(day, []);
        map.get(day)!.push({ type: 'candidate', data: c });
      }
    }

    return map;
  }, [reminders, candidates, month, year]);

  const prevMonth = () => {
    if (month === 0) onMonthChange(11, year - 1);
    else onMonthChange(month - 1, year);
  };

  const nextMonth = () => {
    if (month === 11) onMonthChange(0, year + 1);
    else onMonthChange(month + 1, year);
  };

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  /* Pad trailing cells to complete the last row */
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="hdash__cal">
      <div className="hdash__cal-header">
        <h2 className="hdash__cal-title">
          {MONTH_NAMES[month]} {year}
        </h2>
        <div className="hdash__cal-nav">
          <button className="hdash__cal-nav-btn" onClick={prevMonth} aria-label="Previous month">
            <ChevronLeftIcon />
          </button>
          <button className="hdash__cal-nav-btn" onClick={nextMonth} aria-label="Next month">
            <ChevronRightIcon />
          </button>
        </div>
      </div>

      <div className="hdash__cal-grid">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="hdash__cal-weekday">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`empty-${i}`} className="hdash__cal-cell hdash__cal-cell--empty" />;
          }

          const events = eventsByDay.get(day) ?? [];
          const isToday = day === todayDate;
          const isSelected = day === selectedDay;

          const cellClasses = [
            'hdash__cal-cell',
            isToday ? 'hdash__cal-cell--today' : '',
            isSelected ? 'hdash__cal-cell--selected' : '',
            events.length > 0 ? 'hdash__cal-cell--has-events' : '',
          ].filter(Boolean).join(' ');

          return (
            <div
              key={`day-${day}`}
              className={cellClasses}
              onClick={() => onDateClick(new Date(year, month, day))}
            >
              <div className="hdash__cal-date">{day}</div>
              <div className="hdash__cal-events">
                {events.slice(0, MAX_VISIBLE_EVENTS).map((evt) => {
                  if (evt.type === 'reminder') {
                    return (
                      <div
                        key={`r-${evt.data.id}`}
                        className={`hdash__cal-event hdash__cal-event--${evt.data.status}`}
                        style={getReminderEventStyle(evt.data)}
                        title={evt.data.title || evt.data.message || 'Reminder'}
                      >
                        {evt.data.title || evt.data.message || 'Reminder'}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={`c-${evt.data.id}`}
                      className="hdash__cal-event hdash__cal-event--candidate"
                      title={evt.data.title_suggestion || evt.data.snippet}
                    >
                      {evt.data.title_suggestion || evt.data.snippet}
                    </div>
                  );
                })}
                {events.length > MAX_VISIBLE_EVENTS && (
                  <div className="hdash__cal-overflow">
                    +{events.length - MAX_VISIBLE_EVENTS} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
