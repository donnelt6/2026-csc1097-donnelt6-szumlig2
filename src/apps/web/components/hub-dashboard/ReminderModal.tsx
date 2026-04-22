'use client';

// ReminderModal.tsx: Modal for creating and editing reminders with date and time pickers.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { XMarkIcon, TrashIcon, CheckCircleIcon, ArrowPathIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { createReminder, updateReminder, deleteReminder } from '../../lib/api';
import { formatLocal, pad2 } from '../../lib/dateUtils';
import { DatePicker } from './DatePicker';
import { TimePicker } from './TimePicker';
import type { Reminder } from '@shared/index';

const NOTE_MAX = 500;

const NOTIFY_PRESETS: { value: string; label: string }[] = [
  { value: '1440', label: '1 day before' },
  { value: '60', label: '1 hour before' },
  { value: '15', label: '15 minutes before' },
  { value: '5', label: '5 minutes before' },
  { value: '0', label: 'At deadline' },
  { value: 'none', label: 'No notification' },
  { value: 'custom', label: 'Custom...' },
];

function getPresetKey(notifyBefore: number | null | undefined): string {
  if (notifyBefore == null) return 'none';
  const match = NOTIFY_PRESETS.find((p) => p.value !== 'custom' && p.value !== 'none' && p.value === String(notifyBefore));
  return match ? match.value : 'custom';
}

function NotifyPicker({ value, onChange, onValidChange, deadlineDate, deadlineHour, deadlineMinute }: {
  value: number | null;
  onChange: (v: number | null) => void;
  onValidChange: (valid: boolean) => void;
  deadlineDate: string;
  deadlineHour: number;
  deadlineMinute: number;
}) {
  const preset = getPresetKey(value);
  const deadlineIso = buildIso(deadlineDate, deadlineHour, deadlineMinute);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Close dropdown on click outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  // For custom mode, derive the notification datetime from the deadline minus stored minutes
  const customDefault = useMemo(() => {
    if (preset === 'custom' && value != null) {
      const d = new Date(deadlineIso);
      d.setMinutes(d.getMinutes() - value);
      return { date: toDateStr(d), hour: d.getHours(), minute: d.getMinutes() };
    }
    // Default custom to 1 hour before
    const d = new Date(deadlineIso);
    d.setHours(d.getHours() - 1);
    return { date: toDateStr(d), hour: d.getHours(), minute: d.getMinutes() };
  }, [preset, value, deadlineIso]);

  const [customDate, setCustomDate] = useState(customDefault.date);
  const [customHour, setCustomHour] = useState(customDefault.hour);
  const [customMinute, setCustomMinute] = useState(customDefault.minute);
  const [showCustom, setShowCustom] = useState(preset === 'custom');

  const [customError, setCustomError] = useState(false);

  // Recalculate custom minutes when custom pickers change
  const commitCustom = (d: string, h: number, m: number) => {
    const deadline = new Date(deadlineIso);
    const [ny, nm, nd] = d.split('-').map(Number);
    const notify = new Date(ny, nm - 1, nd, h, m, 0, 0);
    const diffMs = deadline.getTime() - notify.getTime();
    if (diffMs <= 0) {
      setCustomError(true);
      onValidChange(false);
      return;
    }
    setCustomError(false);
    onValidChange(true);
    const diffMin = Math.round(diffMs / 60000);
    onChange(diffMin);
  };

  const handlePresetChange = (key: string) => {
    setDropdownOpen(false);
    if (key === 'none') {
      setShowCustom(false);
      onValidChange(true);
      onChange(null);
    } else if (key === 'custom') {
      setShowCustom(true);
      commitCustom(customDate, customHour, customMinute);
    } else {
      setShowCustom(false);
      onValidChange(true);
      onChange(Number(key));
    }
  };

  // Filter presets: only show time-based ones where notification is still in the future
  const [dY, dM, dD] = deadlineDate.split('-').map(Number);
  const deadlineTime = new Date(dY, dM - 1, dD, deadlineHour, deadlineMinute, 0, 0);
  const deadlineMs = deadlineTime.getTime();
  const availablePresets = useMemo(() => {
    const now = Date.now();
    return NOTIFY_PRESETS.filter((o) => {
      if (o.value === 'none' || o.value === 'custom') return true;
      const notifyMs = deadlineMs - Number(o.value) * 60000;
      return notifyMs > now;
    });
  }, [deadlineMs]);

  // Auto-correct if current selection was filtered out
  const currentKey = showCustom ? 'custom' : (value == null ? 'none' : String(value));
  const isValid = availablePresets.some((o) => o.value === currentKey);
  useEffect(() => {
    if (!isValid && !showCustom) {
      const best = availablePresets.find((o) => o.value !== 'none' && o.value !== 'custom');
      onChange(best ? Number(best.value) : null);
    }
  }, [isValid, showCustom, availablePresets, onChange]);

  const selectedLabel = availablePresets.find((o) => o.value === currentKey)?.label ?? 'Select...';

  return (
    <>
      <div className="hdash__form-label">
        <span className="hdash__form-label-text">Remind me</span>
        <div className="hdash__notify-dropdown" ref={dropdownRef}>
          <button
            type="button"
            className="hdash__notify-dropdown-btn"
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            <span>{selectedLabel}</span>
            <ChevronDownIcon className="hdash__notify-dropdown-chevron" />
          </button>
          {dropdownOpen && (
            <div className="hdash__notify-dropdown-menu">
              {availablePresets.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`hdash__notify-dropdown-item${o.value === currentKey ? ' hdash__notify-dropdown-item--active' : ''}`}
                  onClick={() => handlePresetChange(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {showCustom && (
        <div className="hdash__form-row">
          <div className="hdash__form-label hdash__form-label--grow">
            <span className="hdash__form-label-text">Notification date</span>
            <DatePicker
              value={customDate}
              onChange={(d) => { setCustomDate(d); commitCustom(d, customHour, customMinute); }}
              maxDate={deadlineDate}
            />
          </div>
          <div className="hdash__form-label">
            <span className="hdash__form-label-text">Time</span>
            <TimePicker
              hour={customHour}
              minute={customMinute}
              onHourChange={(h) => { setCustomHour(h); commitCustom(customDate, h, customMinute); }}
              onMinuteChange={(m) => { setCustomMinute(m); commitCustom(customDate, customHour, m); }}
              selectedDate={customDate}
              maxHour={customDate === deadlineDate ? deadlineHour : undefined}
              maxMinute={customDate === deadlineDate ? deadlineMinute : undefined}
            />
          </div>
        </div>
      )}
      {showCustom && customError && (
        <p className="hdash__modal-error">Notification must be before the deadline.</p>
      )}
    </>
  );
}

function buildIso(dateStr: string, hour: number, minute: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d, hour, minute, 0, 0);
  return date.toISOString();
}

function parseTime(iso: string): { hour: number; minute: number } {
  const d = new Date(iso);
  return { hour: d.getHours(), minute: d.getMinutes() };
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function defaultTime(d: Date): { hour: number; minute: number } {
  const now = new Date();
  const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (!isToday) return { hour: 9, minute: 0 };
  /* Round up to next 5-minute slot */
  let m = Math.ceil(now.getMinutes() / 5) * 5;
  let h = now.getHours();
  if (m >= 60) { m = 0; h = (h + 1) % 24; }
  return { hour: h, minute: m };
}

interface DayModalProps {
  mode: 'day';
  hubId: string;
  date: Date;
  reminders: Reminder[];
  onClose: () => void;
  onSaved: () => void;
  onEditReminder: (reminder: Reminder) => void;
}

interface CreateModalProps {
  mode: 'create';
  hubId: string;
  onClose: () => void;
  onSaved: () => void;
}

interface EditModalProps {
  mode: 'edit';
  hubId: string;
  reminder: Reminder;
  onClose: () => void;
  onSaved: () => void;
}

export type ReminderModalProps = DayModalProps | CreateModalProps | EditModalProps;

export function ReminderModal(props: ReminderModalProps) {
  if (props.mode === 'day') return <DayModal {...props} />;
  if (props.mode === 'create') return <CreateModal {...props} />;
  return <EditModal {...props} />;
}

function DayModal({ hubId, date, reminders, onClose, onSaved, onEditReminder }: DayModalProps) {
  const [tab, setTab] = useState<'view' | 'create'>(reminders.length > 0 ? 'view' : 'create');

  const dateLabel = date.toLocaleDateString('en-IE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal hdash__modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal__close" type="button" onClick={onClose}>
          <XMarkIcon className="hdash__icon--xl" />
        </button>

        <div className="modal__header">
          <div>
            <h3 className="modal__title">{dateLabel}</h3>
            <p className="modal__subtitle">
              {reminders.length === 0
                ? 'No reminders on this day.'
                : `${reminders.length} reminder${reminders.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        <div className="hdash__modal-tabs">
          <button
            className={`hdash__modal-tab${tab === 'view' ? ' hdash__modal-tab--active' : ''}`}
            onClick={() => setTab('view')}
          >
            Reminders
          </button>
          <button
            className={`hdash__modal-tab${tab === 'create' ? ' hdash__modal-tab--active' : ''}`}
            onClick={() => setTab('create')}
          >
            Create
          </button>
        </div>

        {tab === 'view' ? (
          <DayRemindersList reminders={reminders} onEdit={onEditReminder} />
        ) : (
          <DayCreateForm hubId={hubId} date={date} onSaved={onSaved} />
        )}
      </div>
    </div>
  );
}

function DayRemindersList({ reminders, onEdit }: { reminders: Reminder[]; onEdit: (r: Reminder) => void }) {
  const sorted = useMemo(
    () => [...reminders].sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()),
    [reminders]
  );

  if (sorted.length === 0) {
    return (
      <div className="hdash__modal-body">
        <p className="hdash__modal-empty">No reminders on this day yet. Switch to the Create tab to add one.</p>
      </div>
    );
  }

  return (
    <div className="hdash__modal-body">
      {sorted.map((r) => (
        <div key={r.id} className="hdash__modal-reminder" onClick={() => onEdit(r)}>
          <div className="hdash__modal-reminder-info">
            <span className="hdash__modal-reminder-msg">{r.title || r.message || 'Reminder'}</span>
            {r.title && r.message && (
              <span className="hdash__modal-reminder-note">{r.message}</span>
            )}
            <span className="hdash__modal-reminder-time">{formatLocal(r.due_at)}</span>
          </div>
          <div className="hdash__modal-reminder-meta">
            <span className={`hdash__status hdash__status--${r.status}`}>{r.status}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function DayCreateForm({ hubId, date, onSaved }: { hubId: string; date: Date; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const defaults = useMemo(() => defaultTime(date), [date]);
  const [hour, setHour] = useState(defaults.hour);
  const [minute, setMinute] = useState(defaults.minute);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [notifyBefore, setNotifyBefore] = useState<number | null>(1440);
  const [notifyValid, setNotifyValid] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: createReminder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reminders', hubId] });
      setTitle('');
      setMessage('');
      setHour(9);
      setMinute(0);
      setNotifyBefore(1440);
      setNotifyValid(true);
      setError(null);
      onSaved();
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const iso = buildIso(toDateStr(date), hour, minute);
    createMut.mutate({
      hub_id: hubId,
      due_at: iso,
      timezone,
      title: title.trim() || undefined,
      message: message.trim() || undefined,
      notify_before: notifyBefore ?? undefined,
    });
  };

  return (
    <form className="hdash__modal-body hdash__modal-form" onSubmit={handleSubmit}>
      <div className="hdash__form-label">
        <span className="hdash__form-label-text">Time</span>
        <TimePicker hour={hour} minute={minute} onHourChange={setHour} onMinuteChange={setMinute} selectedDate={toDateStr(date)} />
      </div>
      <NotifyPicker value={notifyBefore} onChange={setNotifyBefore} onValidChange={setNotifyValid} deadlineDate={toDateStr(date)} deadlineHour={hour} deadlineMinute={minute} />
      <label className="hdash__form-label">
        <span className="hdash__form-label-text">Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Assignment deadline"
          className="hdash__form-input"
          maxLength={100}
        />
      </label>
      <label className="hdash__form-label">
        <span className="hdash__form-label-text">Note <span className="hdash__form-optional">(optional)</span></span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Any extra details..."
          rows={6}
          className={`hdash__form-input hdash__form-textarea${message.length > NOTE_MAX ? ' hdash__form-textarea--over' : ''}`}
        />
        <span className={`hdash__char-count${message.length > NOTE_MAX ? ' hdash__char-count--over' : ''}`}>
          {message.length}/{NOTE_MAX}
        </span>
      </label>
      {error && <p className="hdash__modal-error">{error}</p>}
      <div className="modal__footer">
        <button className="button button--primary" type="submit" disabled={createMut.isPending || message.length > NOTE_MAX || !notifyValid}>
          {createMut.isPending ? 'Creating...' : 'Create Reminder'}
        </button>
      </div>
    </form>
  );
}

function CreateModal({ hubId, onClose, onSaved }: CreateModalProps) {
  const queryClient = useQueryClient();
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const defaults = useMemo(() => defaultTime(new Date()), []);
  const [date, setDate] = useState(() => toDateStr(new Date()));
  const [hour, setHour] = useState(defaults.hour);
  const [minute, setMinute] = useState(defaults.minute);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [notifyBefore, setNotifyBefore] = useState<number | null>(1440);
  const [notifyValid, setNotifyValid] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: createReminder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reminders', hubId] });
      onSaved();
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) { setError('Please select a date.'); return; }
    setError(null);
    const iso = buildIso(date, hour, minute);
    createMut.mutate({
      hub_id: hubId,
      due_at: iso,
      timezone,
      title: title.trim() || undefined,
      message: message.trim() || undefined,
      notify_before: notifyBefore ?? undefined,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal hdash__modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal__close" type="button" onClick={onClose}>
          <XMarkIcon className="hdash__icon--xl" />
        </button>

        <div className="modal__header">
          <div>
            <h3 className="modal__title">Create Reminder</h3>
            <p className="modal__subtitle">Set a deadline, notification time, and title for your reminder.</p>
          </div>
        </div>

        <form className="hdash__modal-body hdash__modal-form" onSubmit={handleSubmit}>
          <div className="hdash__form-row">
            <div className="hdash__form-label hdash__form-label--grow">
              <span className="hdash__form-label-text">Deadline</span>
              <DatePicker value={date} onChange={setDate} />
            </div>
            <div className="hdash__form-label">
              <span className="hdash__form-label-text">Time</span>
              <TimePicker hour={hour} minute={minute} onHourChange={setHour} onMinuteChange={setMinute} selectedDate={date} />
            </div>
          </div>
          <label className="hdash__form-label">
            <span className="hdash__form-label-text">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Assignment deadline"
              className="hdash__form-input"
              maxLength={100}
            />
          </label>
          <NotifyPicker value={notifyBefore} onChange={setNotifyBefore} onValidChange={setNotifyValid} deadlineDate={date} deadlineHour={hour} deadlineMinute={minute} />
          <label className="hdash__form-label">
            <span className="hdash__form-label-text">Note <span className="hdash__form-optional">(optional)</span></span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Any extra details..."
              rows={6}
              className={`hdash__form-input hdash__form-textarea${message.length > NOTE_MAX ? ' hdash__form-textarea--over' : ''}`}
            />
            <span className={`hdash__char-count${message.length > NOTE_MAX ? ' hdash__char-count--over' : ''}`}>
              {message.length}/{NOTE_MAX}
            </span>
          </label>
          {error && <p className="hdash__modal-error">{error}</p>}
          <div className="modal__footer">
            <button className="button button--primary" type="submit" disabled={createMut.isPending || message.length > NOTE_MAX || !notifyValid}>
              {createMut.isPending ? 'Creating...' : 'Create Reminder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditModal({ hubId, reminder, onClose, onSaved }: EditModalProps) {
  const queryClient = useQueryClient();
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const initial = parseTime(reminder.due_at);
  const [date, setDate] = useState(() => toDateStr(new Date(reminder.due_at)));
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [title, setTitle] = useState(reminder.title ?? '');
  const [message, setMessage] = useState(reminder.message ?? '');
  const [notifyBefore, setNotifyBefore] = useState<number | null>(reminder.notify_before ?? null);
  const [notifyValid, setNotifyValid] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const invalidateAndClose = () => {
    queryClient.invalidateQueries({ queryKey: ['reminders', hubId] });
    onSaved();
  };

  const invalidateOnly = () => {
    queryClient.invalidateQueries({ queryKey: ['reminders', hubId] });
  };

  const updateMut = useMutation({
    mutationFn: (data: Parameters<typeof updateReminder>[1]) => updateReminder(reminder.id, data),
    onSuccess: (_, variables) => {
      if (variables.action === 'reopen') {
        invalidateOnly();
      } else {
        invalidateAndClose();
      }
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteReminder(reminder.id),
    onSuccess: invalidateAndClose,
    onError: (err: Error) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) { setError('Please select a date.'); return; }
    setError(null);
    const iso = buildIso(date, hour, minute);
    updateMut.mutate({ due_at: iso, timezone, title: title.trim() || undefined, message: message.trim() || undefined, notify_before: notifyBefore });
  };

  const busy = updateMut.isPending || deleteMut.isPending;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal hdash__modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal__close" type="button" onClick={onClose}>
          <XMarkIcon className="hdash__icon--xl" />
        </button>

        <div className="modal__header">
          <div>
            <h3 className="modal__title">Edit Reminder</h3>
            <p className="modal__subtitle">Update the reminder details below.</p>
          </div>
        </div>

        <form className="hdash__modal-body hdash__modal-form" onSubmit={handleSubmit}>
          <div className="hdash__form-row">
            <div className="hdash__form-label hdash__form-label--grow">
              <span className="hdash__form-label-text">Deadline</span>
              <DatePicker value={date} onChange={setDate} />
            </div>
            <div className="hdash__form-label">
              <span className="hdash__form-label-text">Time</span>
              <TimePicker hour={hour} minute={minute} onHourChange={setHour} onMinuteChange={setMinute} selectedDate={date} />
            </div>
          </div>
          <label className="hdash__form-label">
            <span className="hdash__form-label-text">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Assignment deadline"
              className="hdash__form-input"
              maxLength={100}
            />
          </label>
          <NotifyPicker value={notifyBefore} onChange={setNotifyBefore} onValidChange={setNotifyValid} deadlineDate={date} deadlineHour={hour} deadlineMinute={minute} />
          <label className="hdash__form-label">
            <span className="hdash__form-label-text">Note <span className="hdash__form-optional">(optional)</span></span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Any extra details..."
              rows={6}
              className={`hdash__form-input hdash__form-textarea${message.length > NOTE_MAX ? ' hdash__form-textarea--over' : ''}`}
            />
            <span className={`hdash__char-count${message.length > NOTE_MAX ? ' hdash__char-count--over' : ''}`}>
              {message.length}/{NOTE_MAX}
            </span>
          </label>
          {error && <p className="hdash__modal-error">{error}</p>}
          <div className="modal__footer modal__footer--split">
            {(reminder.status === 'scheduled' || reminder.status === 'sent') && (
              <button
                className="button button--small"
                type="button"
                onClick={() => { setError(null); updateMut.mutate({ action: 'complete' }); }}
                disabled={busy}
              >
                <CheckCircleIcon className="hdash__icon--md" />
                Complete
              </button>
            )}
            {reminder.status === 'completed' && (
              <button
                className="button button--small"
                type="button"
                onClick={() => { setError(null); updateMut.mutate({ action: 'reopen' }); }}
                disabled={busy}
              >
                <ArrowPathIcon className="hdash__icon--md" />
                Reopen
              </button>
            )}
            <div className="hdash__spacer" />
            <button
              className="button button--danger button--small"
              type="button"
              onClick={() => { setError(null); deleteMut.mutate(); }}
              disabled={busy}
            >
              <TrashIcon className="hdash__icon--md" />
              Delete
            </button>
            <button
              className="button button--primary button--small"
              type="submit"
              disabled={busy || message.length > NOTE_MAX || !notifyValid}
            >
              {updateMut.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
