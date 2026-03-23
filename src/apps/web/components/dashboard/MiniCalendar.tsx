'use client';

import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface MiniCalendarProps {
  month: number;
  year: number;
  onMonthChange: (month: number, year: number) => void;
  reminderDays: Set<number>;
  onDayClick?: (day: number) => void;
  selectedDay?: number | null;
}

export function MiniCalendar({ month, year, onMonthChange, reminderDays, onDayClick, selectedDay }: MiniCalendarProps) {
  const today = new Date();
  const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;
  const todayDate = isCurrentMonth ? today.getDate() : -1;

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonth = () => {
    if (month === 0) {
      onMonthChange(11, year - 1);
    } else {
      onMonthChange(month - 1, year);
    }
  };

  const nextMonth = () => {
    if (month === 11) {
      onMonthChange(0, year + 1);
    } else {
      onMonthChange(month + 1, year);
    }
  };

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="mini-cal">
      <div className="mini-cal-header">
        <span className="mini-cal-month">{MONTH_NAMES[month]} {year}</span>
        <div className="mini-cal-nav">
          <button className="mini-cal-nav-btn" onClick={prevMonth} aria-label="Previous month">
            <ChevronLeftIcon className="mini-cal-nav-icon" />
          </button>
          <button className="mini-cal-nav-btn" onClick={nextMonth} aria-label="Next month">
            <ChevronRightIcon className="mini-cal-nav-icon" />
          </button>
        </div>
      </div>

      <div className="mini-cal-grid">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="mini-cal-weekday">{d}</div>
        ))}
        {cells.map((day, i) => (
          <button
            key={i}
            className={[
              'mini-cal-day',
              day === null ? 'mini-cal-day--empty' : '',
              day === todayDate ? 'mini-cal-day--today' : '',
              day !== null && reminderDays.has(day) ? 'mini-cal-day--has-reminder' : '',
              day === selectedDay ? 'mini-cal-day--selected' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => day !== null && onDayClick?.(day)}
            disabled={day === null}
            type="button"
          >
            {day}
            {day !== null && reminderDays.has(day) && (
              <span className="mini-cal-dot" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
