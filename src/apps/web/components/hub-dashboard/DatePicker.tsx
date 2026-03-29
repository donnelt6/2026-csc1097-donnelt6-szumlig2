'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, CalendarIcon } from '@heroicons/react/24/outline';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function pad2(n: number) {
  return n.toString().padStart(2, '0');
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function getDaysInMonth(month: number, year: number) {
  return new Date(year, month + 1, 0).getDate();
}

const YEAR_START = 2025;
const YEAR_END = 2032;
const YEARS = Array.from({ length: YEAR_END - YEAR_START + 1 }, (_, i) => YEAR_START + i);

type OpenSegment = 'closed' | 'day' | 'month' | 'year' | 'calendar';

interface DatePickerProps {
  value: string; /* YYYY-MM-DD */
  onChange: (value: string) => void;
}

export function DatePicker({ value, onChange }: DatePickerProps) {
  const [openSeg, setOpenSeg] = useState<OpenSegment>('closed');
  const wrapRef = useRef<HTMLDivElement>(null);
  const activeListRef = useRef<HTMLDivElement>(null);

  const parsedRaw = value ? new Date(value) : new Date();
  const parsed = isNaN(parsedRaw.getTime()) ? new Date() : parsedRaw;
  const day = parsed.getDate();
  const month = parsed.getMonth();
  const year = parsed.getFullYear();

  const [viewMonth, setViewMonth] = useState(month);
  const [viewYear, setViewYear] = useState(year);

  const now = new Date();
  const todayDay = now.getDate();
  const todayMonth = now.getMonth();
  const todayYear = now.getFullYear();

  const emit = (d: number, m: number, y: number) => {
    const maxDay = getDaysInMonth(m, y);
    const clamped = clamp(d, 1, maxDay);
    onChange(`${y}-${pad2(m + 1)}-${pad2(clamped)}`);
  };

  /* Close on click outside */
  useEffect(() => {
    if (openSeg === 'closed') return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpenSeg('closed');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openSeg]);

  /* Scroll active item into view */
  useEffect(() => {
    if (openSeg === 'closed' || openSeg === 'calendar' || !activeListRef.current) return;
    const el = activeListRef.current.querySelector('.hdash__seg-option--active');
    if (el) el.scrollIntoView({ block: 'center' });
  }, [openSeg]);

  /* ---- Filtered options (no past dates) ---- */
  const maxDay = getDaysInMonth(month, year);
  const minDay = (year === todayYear && month === todayMonth) ? todayDay : 1;
  const DAYS = Array.from({ length: maxDay - minDay + 1 }, (_, i) => minDay + i);

  const minMonth = (year === todayYear) ? todayMonth : 0;
  const MONTHS = SHORT_MONTHS.map((name, i) => ({ name, index: i })).filter(m => m.index >= minMonth);

  const filteredYears = YEARS.filter(y => y >= todayYear);

  /* ---- Calendar grid ---- */
  const selectedCalDay = (() => {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.getMonth() === viewMonth && d.getFullYear() === viewYear ? d.getDate() : null;
  })();

  const isCurrentMonth = now.getMonth() === viewMonth && now.getFullYear() === viewYear;
  const todayDate = isCurrentMonth ? todayDay : -1;

  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const totalDays = getDaysInMonth(viewMonth, viewYear);
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const isCalDayPast = (d: number) => {
    if (viewYear < todayYear) return true;
    if (viewYear === todayYear && viewMonth < todayMonth) return true;
    if (viewYear === todayYear && viewMonth === todayMonth && d < todayDay) return true;
    return false;
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const selectCalDay = (d: number) => {
    if (isCalDayPast(d)) return;
    onChange(`${viewYear}-${pad2(viewMonth + 1)}-${pad2(d)}`);
    setOpenSeg('closed');
  };

  const toggleSeg = (seg: OpenSegment) => {
    setOpenSeg(openSeg === seg ? 'closed' : seg);
  };

  return (
    <div className="hdash__datepicker" ref={wrapRef}>
      <div className="hdash__datepicker-trigger">
        <button
          type="button"
          className="hdash__datepicker-cal-btn"
          onClick={() => {
            if (openSeg !== 'calendar') {
              setViewMonth(month);
              setViewYear(year);
              setOpenSeg('calendar');
            } else {
              setOpenSeg('closed');
            }
          }}
          aria-label="Open calendar"
        >
          <CalendarIcon className="hdash__datepicker-icon" />
        </button>

        {/* Day segment */}
        <div className="hdash__seg-wrap">
          <button type="button" className="hdash__datepicker-seg" onClick={() => toggleSeg('day')}>
            {pad2(day)}
          </button>
          {openSeg === 'day' && (
            <div className="hdash__seg-dropdown" ref={activeListRef}>
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`hdash__seg-option${d === day ? ' hdash__seg-option--active' : ''}`}
                  onClick={() => { emit(d, month, year); setOpenSeg('closed'); }}
                >
                  {pad2(d)}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="hdash__datepicker-sep">/</span>

        {/* Month segment */}
        <div className="hdash__seg-wrap">
          <button type="button" className="hdash__datepicker-seg" onClick={() => toggleSeg('month')}>
            {SHORT_MONTHS[month]}
          </button>
          {openSeg === 'month' && (
            <div className="hdash__seg-dropdown" ref={activeListRef}>
              {MONTHS.map(({ name, index }) => (
                <button
                  key={index}
                  type="button"
                  className={`hdash__seg-option${index === month ? ' hdash__seg-option--active' : ''}`}
                  onClick={() => { emit(day, index, year); setOpenSeg('closed'); }}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="hdash__datepicker-sep">/</span>

        {/* Year segment */}
        <div className="hdash__seg-wrap">
          <button type="button" className="hdash__datepicker-seg" onClick={() => toggleSeg('year')}>
            {year}
          </button>
          {openSeg === 'year' && (
            <div className="hdash__seg-dropdown" ref={activeListRef}>
              {filteredYears.map((y) => (
                <button
                  key={y}
                  type="button"
                  className={`hdash__seg-option${y === year ? ' hdash__seg-option--active' : ''}`}
                  onClick={() => { emit(day, month, y); setOpenSeg('closed'); }}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Calendar grid dropdown */}
      {openSeg === 'calendar' && (
        <div className="hdash__datepicker-dropdown">
          <div className="hdash__datepicker-header">
            <button type="button" className="hdash__datepicker-nav" onClick={prevMonth} aria-label="Previous month">
              <ChevronLeftIcon />
            </button>
            <span className="hdash__datepicker-month">{MONTH_NAMES[viewMonth]} {viewYear}</span>
            <button type="button" className="hdash__datepicker-nav" onClick={nextMonth} aria-label="Next month">
              <ChevronRightIcon />
            </button>
          </div>
          <div className="hdash__datepicker-grid">
            {WEEKDAYS.map((d, i) => (
              <div key={i} className="hdash__datepicker-weekday">{d}</div>
            ))}
            {cells.map((d, i) => {
              const past = d !== null && isCalDayPast(d);
              return (
                <button
                  key={i}
                  type="button"
                  className={[
                    'hdash__datepicker-day',
                    d === null ? 'hdash__datepicker-day--empty' : '',
                    d === todayDate ? 'hdash__datepicker-day--today' : '',
                    d === selectedCalDay ? 'hdash__datepicker-day--selected' : '',
                    past ? 'hdash__datepicker-day--past' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => d !== null && selectCalDay(d)}
                  disabled={d === null || past}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
