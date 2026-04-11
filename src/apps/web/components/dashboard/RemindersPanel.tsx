'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PlusIcon,
  ChevronDownIcon,
  ClockIcon,
  BellIcon,
} from '@heroicons/react/24/outline';
import { createReminder, listHubs, listReminders } from '../../lib/api';
import { MiniCalendar } from './MiniCalendar';
import { buildHubNameMap } from './dashboardUtils';
import type { Reminder } from '../../lib/types';

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

interface RemindersPanelProps {
  variant: 'sidebar' | 'page';
}

export function RemindersPanel({ variant }: RemindersPanelProps) {
  const queryClient = useQueryClient();
  const now = new Date();
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formMessage, setFormMessage] = useState('');
  const [formHour, setFormHour] = useState('09');
  const [formMinute, setFormMinute] = useState('00');
  const [formHubId, setFormHubId] = useState('');
  const [formError, setFormError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const timeRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const hourColRef = useRef<HTMLDivElement>(null);
  const minuteColRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!timeOpen && !hubOpen) return;
    function handleClick(e: MouseEvent) {
      if (timeOpen && timeRef.current && !timeRef.current.contains(e.target as Node)) setTimeOpen(false);
      if (hubOpen && hubRef.current && !hubRef.current.contains(e.target as Node)) setHubOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [timeOpen, hubOpen]);

  useEffect(() => {
    if (!timeOpen) return;
    const hourIdx = HOURS.indexOf(formHour);
    const minIdx = MINUTES.indexOf(formMinute);
    if (hourColRef.current && hourIdx > 0) hourColRef.current.scrollTop = hourIdx * 32 - 32;
    if (minuteColRef.current && minIdx > 0) minuteColRef.current.scrollTop = minIdx * 32 - 32;
  }, [timeOpen]);

  const { data: hubs } = useQuery({
    queryKey: ['hubs'],
    queryFn: listHubs,
  });

  const { data: reminders, isLoading: remindersLoading } = useQuery({
    queryKey: ['dashboard-reminders'],
    queryFn: () => listReminders({}),
    staleTime: 0,
  });

  const hubNameMap = buildHubNameMap(hubs);

  const monthReminders = reminders?.filter((r) => {
    const d = new Date(r.due_at);
    return d.getMonth() === calMonth && d.getFullYear() === calYear;
  }) ?? [];

  const reminderDays = new Set(monthReminders.map((r) => new Date(r.due_at).getDate()));

  const dayReminders = selectedDay !== null
    ? monthReminders.filter((r) => new Date(r.due_at).getDate() === selectedDay)
    : [];

  // Sidebar fallback: closest reminders to "now" when no day is selected
  const sortedReminders = [...(reminders ?? [])].sort((a, b) => {
    const aTime = Math.abs(new Date(a.due_at).getTime() - Date.now());
    const bTime = Math.abs(new Date(b.due_at).getTime() - Date.now());
    return aTime - bTime;
  });
  const closestReminders = sortedReminders.slice(0, 4);

  const handleDayClick = (day: number) => {
    setSelectedDay(selectedDay === day ? null : day);
    setShowForm(false);
  };

  const handleMonthChange = (m: number, y: number) => {
    setCalMonth(m);
    setCalYear(y);
    setSelectedDay(null);
    setShowForm(false);
  };

  const handleCreateReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formHubId) { setFormError('Select a hub'); return; }
    if (!formMessage.trim()) { setFormError('Enter a message'); return; }
    if (selectedDay === null) return;

    setIsCreating(true);
    setFormError('');
    try {
      const dueDate = new Date(calYear, calMonth, selectedDay, parseInt(formHour), parseInt(formMinute));
      await createReminder({
        hub_id: formHubId,
        due_at: dueDate.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        message: formMessage.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-reminders'] });
      setFormMessage('');
      setFormHour('09');
      setFormMinute('00');
      setShowForm(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create reminder');
    } finally {
      setIsCreating(false);
    }
  };

  const renderReminderItem = (r: Reminder) => {
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
  };

  const renderAddForm = () => (
    !showForm ? (
      <button
        type="button"
        className="dash-cal-add-btn"
        onClick={() => {
          setShowForm(true);
          setFormError('');
          if (!formHubId && hubs?.length) setFormHubId(hubs[0].id);
        }}
      >
        <PlusIcon className="dash-cal-add-btn-icon" />
        Add reminder
      </button>
    ) : (
      <form className="dash-cal-form" onSubmit={handleCreateReminder}>
        <input
          type="text"
          className="dash-cal-form-input"
          placeholder="Reminder message..."
          value={formMessage}
          onChange={(e) => setFormMessage(e.target.value)}
          autoFocus
        />
        <div className="dash-cal-form-row">
          <div className="dash-cal-picker" ref={timeRef}>
            <button
              type="button"
              className="dash-cal-picker-btn"
              onClick={() => { setTimeOpen((v) => !v); setHubOpen(false); }}
            >
              <ClockIcon className="dash-cal-picker-icon" />
              <span>{formHour}:{formMinute}</span>
            </button>
            {timeOpen && (
              <div className="dash-cal-picker-menu dash-cal-time-menu">
                <div className="dash-cal-time-col" ref={hourColRef}>
                  {HOURS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      className={`dash-cal-time-item${h === formHour ? ' dash-cal-time-item--active' : ''}`}
                      onClick={() => setFormHour(h)}
                    >
                      {h}
                    </button>
                  ))}
                </div>
                <div className="dash-cal-time-col" ref={minuteColRef}>
                  {MINUTES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`dash-cal-time-item${m === formMinute ? ' dash-cal-time-item--active' : ''}`}
                      onClick={() => setFormMinute(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="dash-cal-picker dash-cal-picker--hub" ref={hubRef}>
            <button
              type="button"
              className="dash-cal-picker-btn"
              onClick={() => { setHubOpen((v) => !v); setTimeOpen(false); }}
            >
              <span className="dash-cal-picker-label">
                {hubs?.find((h) => h.id === formHubId)?.name ?? 'Select hub'}
              </span>
              <ChevronDownIcon className="dash-cal-picker-chevron" />
            </button>
            {hubOpen && (
              <div className="dash-cal-picker-menu dash-cal-hub-menu">
                {hubs?.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    className={`dash-cal-hub-item${formHubId === h.id ? ' dash-cal-hub-item--active' : ''}`}
                    onClick={() => { setFormHubId(h.id); setHubOpen(false); }}
                  >
                    {h.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {formError && <p className="dash-cal-form-error">{formError}</p>}
        <div className="dash-cal-form-actions">
          <button type="button" className="dash-cal-form-cancel" onClick={() => setShowForm(false)}>
            Cancel
          </button>
          <button type="submit" className="dash-cal-form-submit" disabled={isCreating}>
            {isCreating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    )
  );

  const renderDayDetail = () => (
    <>
      <h3 className="dash-calendar-detail-title">
        {new Date(calYear, calMonth, selectedDay!).toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}
      </h3>
      {dayReminders.length > 0 ? (
        <div className="dash-reminder-list">
          {dayReminders.map(renderReminderItem)}
        </div>
      ) : (
        <p className="muted">No reminders for this day.</p>
      )}
      {renderAddForm()}
    </>
  );

  if (variant === 'page') {
    return (
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
          {selectedDay !== null ? renderDayDetail() : (
            <div className="dash-calendar-empty">
              <p className="muted">Select a day to view reminders.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // sidebar variant
  return (
    <div className="dash-reminders-card">
      <h2 className="dash-reminders-title">Reminders</h2>
      <MiniCalendar
        month={calMonth}
        year={calYear}
        onMonthChange={handleMonthChange}
        reminderDays={reminderDays}
        onDayClick={handleDayClick}
        selectedDay={selectedDay}
      />
      {selectedDay !== null ? (
        renderDayDetail()
      ) : (
        <>
          {closestReminders.length > 0 && (
            <>
              <hr className="dash-reminders-divider" />
              <div className="dash-reminder-list">
                {closestReminders.map(renderReminderItem)}
              </div>
            </>
          )}
          {closestReminders.length === 0 && remindersLoading && (
            <div
              className="dash-empty-state dash-empty-state--compact dash-empty-state--skeleton"
              aria-hidden="true"
              data-testid="dashboard-reminder-empty-skeleton"
            >
              <span className="dash-skeleton dash-skeleton--reminder-empty-icon" />
              <span className="dash-skeleton dash-skeleton--reminder-empty-line" />
              <span className="dash-skeleton dash-skeleton--reminder-empty-line dash-skeleton--reminder-empty-line-short" />
            </div>
          )}
          {closestReminders.length === 0 && !remindersLoading && (
            <div className="dash-empty-state dash-empty-state--compact">
              <BellIcon className="dash-empty-state-icon" />
              <p className="dash-empty-state-text">Set up reminders in any hub to see them here</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
