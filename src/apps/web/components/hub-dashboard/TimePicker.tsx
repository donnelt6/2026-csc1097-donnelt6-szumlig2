'use client';

// TimePicker.tsx: Time picker component with hour and minute selection.

import { useEffect, useRef, useState } from 'react';
import { ClockIcon } from '@heroicons/react/24/outline';
import { pad2 } from '../../lib/dateUtils';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

type OpenSegment = 'closed' | 'hour' | 'minute';

interface TimePickerProps {
  hour: number;
  minute: number;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
  /** YYYY-MM-DD string — used to filter out past times when date is today */
  selectedDate?: string;
  maxHour?: number;
  maxMinute?: number;
}

export function TimePicker({ hour, minute, onHourChange, onMinuteChange, selectedDate, maxHour, maxMinute }: TimePickerProps) {
  const [openSeg, setOpenSeg] = useState<OpenSegment>('closed');
  const wrapRef = useRef<HTMLDivElement>(null);
  const activeListRef = useRef<HTMLDivElement>(null);

  const now = new Date();
  const isToday = selectedDate === `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  let filteredHours = isToday ? HOURS.filter(h => h >= currentHour) : HOURS;
  if (maxHour != null) {
    const maxH = (maxMinute != null && maxMinute === 0) ? Math.max(0, maxHour - 1) : maxHour;
    filteredHours = filteredHours.filter(h => h <= maxH);
  }

  let filteredMinutes = (isToday && hour === currentHour)
    ? MINUTES.filter(m => m >= currentMinute)
    : MINUTES;
  if (maxHour != null && maxMinute != null && hour === maxHour)
    filteredMinutes = filteredMinutes.filter(m => m < maxMinute);

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
    if (openSeg === 'closed' || !activeListRef.current) return;
    const el = activeListRef.current.querySelector('.hdash__seg-option--active');
    if (el) el.scrollIntoView({ block: 'center' });
  }, [openSeg]);

  const toggleSeg = (seg: OpenSegment) => {
    setOpenSeg(openSeg === seg ? 'closed' : seg);
  };

  return (
    <div className="hdash__tp" ref={wrapRef}>
      <div className="hdash__tp-trigger">
        <ClockIcon className="hdash__tp-icon" />

        {/* Hour segment */}
        <div className="hdash__seg-wrap">
          <button type="button" className="hdash__tp-seg" onClick={() => toggleSeg('hour')}>
            {pad2(hour)}
          </button>
          {openSeg === 'hour' && (
            <div className="hdash__seg-dropdown" ref={activeListRef}>
              {filteredHours.map((h) => (
                <button
                  key={h}
                  type="button"
                  className={`hdash__seg-option${h === hour ? ' hdash__seg-option--active' : ''}`}
                  onClick={() => { onHourChange(h); setOpenSeg('closed'); }}
                >
                  {pad2(h)}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="hdash__tp-colon">:</span>

        {/* Minute segment */}
        <div className="hdash__seg-wrap">
          <button type="button" className="hdash__tp-seg" onClick={() => toggleSeg('minute')}>
            {pad2(minute)}
          </button>
          {openSeg === 'minute' && (
            <div className="hdash__seg-dropdown" ref={activeListRef}>
              {filteredMinutes.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`hdash__seg-option${m === minute ? ' hdash__seg-option--active' : ''}`}
                  onClick={() => { onMinuteChange(m); setOpenSeg('closed'); }}
                >
                  {pad2(m)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
