'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon } from '@heroicons/react/24/outline';
import { decideReminderCandidate } from '../../lib/api';
import { formatLocal, toLocalInputValue, toIsoFromLocalInput } from '../../lib/dateUtils';
import type { Reminder, ReminderCandidate } from '../../lib/types';

interface RemindersSidebarProps {
  hubId: string;
  candidates: ReminderCandidate[];
  reminders: Reminder[];
  onReminderClick: (reminder: Reminder) => void;
  onCreateClick: () => void;
}

export function RemindersSidebar({
  hubId,
  candidates,
  reminders,
  onReminderClick,
  onCreateClick,
}: RemindersSidebarProps) {
  return (
    <div className="hdash__sidebar-col">
      <InsightsSection hubId={hubId} candidates={candidates} />
      <ManualSection reminders={reminders} onReminderClick={onReminderClick} />
      <button className="hdash__create-btn" onClick={onCreateClick}>
        <PlusIcon />
        Create Manual Reminder
      </button>
    </div>
  );
}

/* ---------- AI Insights Section ---------- */

function InsightsSection({ hubId, candidates }: { hubId: string; candidates: ReminderCandidate[] }) {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editDueAt, setEditDueAt] = useState('');
  const [editMessage, setEditMessage] = useState('');

  const decideMut = useMutation({
    mutationFn: (params: Parameters<typeof decideReminderCandidate>) =>
      decideReminderCandidate(...params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reminder-candidates', hubId] });
      queryClient.invalidateQueries({ queryKey: ['reminders', hubId] });
      setExpandedId(null);
    },
  });

  const handleAcceptClick = (c: ReminderCandidate) => {
    if (expandedId === c.id) {
      /* Already expanded — submit */
      const iso = toIsoFromLocalInput(editDueAt);
      decideMut.mutate([c.id, {
        action: 'accepted',
        edited_due_at: iso || undefined,
        edited_message: editMessage.trim() || undefined,
      }]);
    } else {
      /* Expand to edit before accepting */
      setExpandedId(c.id);
      setEditDueAt(toLocalInputValue(c.due_at));
      setEditMessage(c.title_suggestion || c.snippet);
    }
  };

  const handleDecline = (c: ReminderCandidate) => {
    decideMut.mutate([c.id, { action: 'declined' }]);
  };

  return (
    <div className="hdash__sidebar-section">
      <h4 className="hdash__sidebar-title">AI Insights</h4>
      {candidates.length === 0 ? (
        <p className="hdash__sidebar-empty">No pending suggestions.</p>
      ) : (
        candidates.map((c) => (
          <div key={c.id} className="hdash__insights-card">
            <div className="hdash__insights-card-title">
              {c.title_suggestion || 'Suggested Reminder'}
            </div>
            <div className="hdash__insights-card-meta">
              <span>{formatLocal(c.due_at)}</span>
              <span className="hdash__confidence">{Math.round(c.confidence * 100)}%</span>
            </div>
            {c.snippet && (
              <div className="hdash__insights-card-snippet">{c.snippet}</div>
            )}

            {expandedId === c.id && (
              <div className="hdash__insights-edit">
                <input
                  type="datetime-local"
                  value={editDueAt}
                  onChange={(e) => setEditDueAt(e.target.value)}
                />
                <textarea
                  value={editMessage}
                  onChange={(e) => setEditMessage(e.target.value)}
                  rows={2}
                />
              </div>
            )}

            <div className="hdash__insights-actions">
              <button
                className="hdash__insights-btn hdash__insights-btn--accept"
                onClick={() => handleAcceptClick(c)}
                disabled={decideMut.isPending}
              >
                {expandedId === c.id ? 'Confirm' : 'Accept'}
              </button>
              <button
                className="hdash__insights-btn hdash__insights-btn--reject"
                onClick={() => handleDecline(c)}
                disabled={decideMut.isPending}
              >
                Reject
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ---------- Manual Reminders Section ---------- */

function ManualSection({
  reminders,
  onReminderClick,
}: {
  reminders: Reminder[];
  onReminderClick: (r: Reminder) => void;
}) {
  const sorted = useMemo(
    () =>
      [...reminders].sort(
        (a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
      ),
    [reminders]
  );

  return (
    <div className="hdash__sidebar-section">
      <h4 className="hdash__sidebar-title">Reminders</h4>
      {sorted.length === 0 ? (
        <p className="hdash__sidebar-empty">No reminders yet.</p>
      ) : (
        <div className="hdash__manual-list">
          {sorted.map((r) => (
            <div
              key={r.id}
              className="hdash__manual-item"
              onClick={() => onReminderClick(r)}
            >
              <div className={`hdash__manual-dot hdash__manual-dot--${r.status}`} />
              <div className="hdash__manual-info">
                <div className="hdash__manual-msg">{r.title || r.message || 'Reminder'}</div>
                <div className="hdash__manual-due">{formatLocal(r.due_at)}</div>
              </div>
              <span className={`hdash__status hdash__status--${r.status}`}>
                {r.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
