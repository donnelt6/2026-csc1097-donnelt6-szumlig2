'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { XMarkIcon, PencilSquareIcon, TrashIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { createReminder, updateReminder, deleteReminder } from '../../lib/api';
import { formatLocal } from '../../lib/dateUtils';
import { DatePicker } from './DatePicker';
import { TimePicker } from './TimePicker';
import type { Reminder } from '../../lib/types';

/* ---- Helpers ---- */

function pad2(n: number) {
  return n.toString().padStart(2, '0');
}

function buildIso(dateStr: string, hour: number, minute: number): string {
  const d = new Date(dateStr);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function parseTime(iso: string): { hour: number; minute: number } {
  const d = new Date(iso);
  return { hour: d.getHours(), minute: d.getMinutes() };
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isToday(d: Date): boolean {
  const now = new Date();
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function defaultTime(d: Date): { hour: number; minute: number } {
  if (!isToday(d)) return { hour: 9, minute: 0 };
  const now = new Date();
  /* Round up to next 5-minute slot */
  let m = Math.ceil(now.getMinutes() / 5) * 5;
  let h = now.getHours();
  if (m >= 60) { m = 0; h = (h + 1) % 24; }
  return { hour: h, minute: m };
}

/* ---- Types ---- */

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

/* ================================================================== */
/*  Day Modal (clicked a calendar day)                                 */
/* ================================================================== */

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
          <XMarkIcon style={{ width: 20, height: 20 }} />
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

/* ---- Day reminders list ---- */

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
            <span className="hdash__modal-reminder-time">{formatLocal(r.due_at)}</span>
          </div>
          <div className="hdash__modal-reminder-meta">
            <span className={`hdash__status hdash__status--${r.status}`}>{r.status}</span>
            <PencilSquareIcon className="hdash__modal-reminder-edit" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---- Day create form (time + message only, date from context) ---- */

function DayCreateForm({ hubId, date, onSaved }: { hubId: string; date: Date; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const defaults = useMemo(() => defaultTime(date), [date]);
  const [hour, setHour] = useState(defaults.hour);
  const [minute, setMinute] = useState(defaults.minute);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: createReminder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reminders', hubId] });
      setTitle('');
      setMessage('');
      setHour(9);
      setMinute(0);
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
    });
  };

  return (
    <form className="hdash__modal-body hdash__modal-form" onSubmit={handleSubmit}>
      <div className="hdash__form-label">
        <span className="hdash__form-label-text">Time</span>
        <TimePicker hour={hour} minute={minute} onHourChange={setHour} onMinuteChange={setMinute} selectedDate={toDateStr(date)} />
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
      <label className="hdash__form-label">
        <span className="hdash__form-label-text">Note <span className="hdash__form-optional">(optional)</span></span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Any extra details..."
          rows={2}
          className="hdash__form-input hdash__form-textarea"
        />
      </label>
      {error && <p className="hdash__modal-error">{error}</p>}
      <div className="modal__footer">
        <button className="button button--primary" type="submit" disabled={createMut.isPending}>
          {createMut.isPending ? 'Creating...' : 'Create Reminder'}
        </button>
      </div>
    </form>
  );
}

/* ================================================================== */
/*  Create Modal (sidebar button — date + time + message)              */
/* ================================================================== */

function CreateModal({ hubId, onClose, onSaved }: CreateModalProps) {
  const queryClient = useQueryClient();
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const defaults = useMemo(() => defaultTime(new Date()), []);
  const [date, setDate] = useState(() => toDateStr(new Date()));
  const [hour, setHour] = useState(defaults.hour);
  const [minute, setMinute] = useState(defaults.minute);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
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
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal hdash__modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal__close" type="button" onClick={onClose}>
          <XMarkIcon style={{ width: 20, height: 20 }} />
        </button>

        <div className="modal__header">
          <div>
            <h3 className="modal__title">Create Reminder</h3>
            <p className="modal__subtitle">Set a date, time, and title for your reminder.</p>
          </div>
        </div>

        <form className="hdash__modal-body hdash__modal-form" onSubmit={handleSubmit}>
          <div className="hdash__form-row">
            <div className="hdash__form-label hdash__form-label--grow">
              <span className="hdash__form-label-text">Date</span>
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
          <label className="hdash__form-label">
            <span className="hdash__form-label-text">Note <span className="hdash__form-optional">(optional)</span></span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Any extra details..."
              rows={2}
              className="hdash__form-input hdash__form-textarea"
            />
          </label>
          {error && <p className="hdash__modal-error">{error}</p>}
          <div className="modal__footer">
            <button className="button button--primary" type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? 'Creating...' : 'Create Reminder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Edit Modal                                                         */
/* ================================================================== */

function EditModal({ hubId, reminder, onClose, onSaved }: EditModalProps) {
  const queryClient = useQueryClient();
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const initial = parseTime(reminder.due_at);
  const [date, setDate] = useState(() => toDateStr(new Date(reminder.due_at)));
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [title, setTitle] = useState(reminder.title ?? '');
  const [message, setMessage] = useState(reminder.message ?? '');
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['reminders', hubId] });
    onSaved();
  };

  const updateMut = useMutation({
    mutationFn: (data: Parameters<typeof updateReminder>[1]) => updateReminder(reminder.id, data),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteReminder(reminder.id),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) { setError('Please select a date.'); return; }
    setError(null);
    const iso = buildIso(date, hour, minute);
    updateMut.mutate({ due_at: iso, timezone, title: title.trim() || undefined, message: message.trim() || undefined });
  };

  const busy = updateMut.isPending || deleteMut.isPending;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal hdash__modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal__close" type="button" onClick={onClose}>
          <XMarkIcon style={{ width: 20, height: 20 }} />
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
              <span className="hdash__form-label-text">Date</span>
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
          <label className="hdash__form-label">
            <span className="hdash__form-label-text">Note <span className="hdash__form-optional">(optional)</span></span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Any extra details..."
              rows={2}
              className="hdash__form-input hdash__form-textarea"
            />
          </label>
          {error && <p className="hdash__modal-error">{error}</p>}
          <div className="modal__footer modal__footer--split">
            {reminder.status === 'scheduled' && (
              <button
                className="button button--small"
                type="button"
                onClick={() => { setError(null); updateMut.mutate({ action: 'complete' }); }}
                disabled={busy}
              >
                <CheckCircleIcon style={{ width: 16, height: 16 }} />
                Complete
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button
              className="button button--danger button--small"
              type="button"
              onClick={() => { setError(null); deleteMut.mutate(); }}
              disabled={busy}
            >
              <TrashIcon style={{ width: 16, height: 16 }} />
              Delete
            </button>
            <button
              className="button button--primary button--small"
              type="submit"
              disabled={busy}
            >
              {updateMut.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
