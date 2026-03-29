'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { createReminder, updateReminder, deleteReminder } from '../../lib/api';
import { toLocalInputValue, toIsoFromLocalInput } from '../../lib/dateUtils';
import type { Reminder } from '../../lib/types';

interface ReminderModalProps {
  mode: 'create' | 'edit';
  hubId: string;
  initialDate?: Date;
  reminder?: Reminder;
  onClose: () => void;
  onSaved: () => void;
}

export function ReminderModal({
  mode,
  hubId,
  initialDate,
  reminder,
  onClose,
  onSaved,
}: ReminderModalProps) {
  const queryClient = useQueryClient();
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const defaultDateTime = () => {
    if (mode === 'edit' && reminder) {
      return toLocalInputValue(reminder.due_at);
    }
    if (initialDate) {
      /* Default to 09:00 on the selected date */
      const d = new Date(initialDate);
      d.setHours(9, 0, 0, 0);
      return toLocalInputValue(d.toISOString());
    }
    return '';
  };

  const [dueAt, setDueAt] = useState(defaultDateTime);
  const [message, setMessage] = useState(
    mode === 'edit' ? (reminder?.message ?? '') : ''
  );
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['reminders', hubId] });
    onSaved();
  };

  const createMut = useMutation({
    mutationFn: createReminder,
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });

  const updateMut = useMutation({
    mutationFn: (data: Parameters<typeof updateReminder>[1]) =>
      updateReminder(reminder!.id, data),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteReminder(reminder!.id),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });

  const handleSubmit = () => {
    const iso = toIsoFromLocalInput(dueAt);
    if (!iso) {
      setError('Please select a valid date and time.');
      return;
    }
    setError(null);

    if (mode === 'create') {
      createMut.mutate({
        hub_id: hubId,
        due_at: iso,
        timezone,
        message: message.trim() || undefined,
      });
    } else {
      updateMut.mutate({
        due_at: iso,
        timezone,
        message: message.trim() || undefined,
      });
    }
  };

  const handleComplete = () => {
    setError(null);
    updateMut.mutate({ action: 'complete' });
  };

  const handleDelete = () => {
    setError(null);
    deleteMut.mutate();
  };

  const busy = createMut.isPending || updateMut.isPending || deleteMut.isPending;
  const isEditing = mode === 'edit';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">
              {isEditing ? 'Edit Reminder' : 'Create Reminder'}
            </h3>
            <p className="modal-subtitle">
              {isEditing
                ? 'Update the reminder details below.'
                : 'Set a date, time, and message for your reminder.'}
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <XMarkIcon />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="modal-label" style={{ display: 'block', marginBottom: 6, fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Date &amp; Time
            </label>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="modal-input"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg-secondary)',
                color: 'var(--text)',
                fontSize: '0.875rem',
                fontFamily: 'inherit',
              }}
            />
          </div>
          <div>
            <label className="modal-label" style={{ display: 'block', marginBottom: 6, fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What should you be reminded about?"
              rows={3}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg-secondary)',
                color: 'var(--text)',
                fontSize: '0.875rem',
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />
          </div>

          {error && (
            <p style={{ color: 'var(--danger)', fontSize: '0.8125rem', margin: 0 }}>{error}</p>
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
          {isEditing && reminder?.status === 'scheduled' && (
            <button
              className="button button--small"
              onClick={handleComplete}
              disabled={busy}
              style={{ marginRight: 'auto' }}
            >
              Complete
            </button>
          )}
          {isEditing && (
            <button
              className="button button--danger button--small"
              onClick={handleDelete}
              disabled={busy}
            >
              Delete
            </button>
          )}
          <button className="button button--small" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="button button--primary button--small"
            onClick={handleSubmit}
            disabled={busy || !dueAt}
          >
            {busy ? 'Saving...' : isEditing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
