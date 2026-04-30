'use client';

// RemindersSidebar.tsx: Sidebar panel listing reminders for the selected calendar date.

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon } from '@heroicons/react/24/outline';
import { decideReminderCandidate } from '../../lib/api';
import { formatLocal, toLocalInputValue, toIsoFromLocalInput } from '../../lib/dateUtils';
import type { Reminder, ReminderCandidate } from '@shared/index';
import { getHubColorOption } from '../../lib/hubAppearance';

interface RemindersSidebarProps {
  hubId: string;
  candidates: ReminderCandidate[];
  onCreateClick: () => void;
}

const INSIGHTS_PER_PAGE = 3;

function getConfidenceTier(confidence: number): 'high' | 'medium' | 'low' {
  const pct = Math.round(confidence * 100);
  if (pct >= 80) return 'high';
  if (pct >= 60) return 'medium';
  return 'low';
}

function getConfidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}% confident`;
}

function getReminderDotStyle(colorKey?: string | null): CSSProperties {
  return { backgroundColor: getHubColorOption(colorKey).value };
}

export function RemindersSidebar({
  hubId,
  candidates,
  onCreateClick,
}: RemindersSidebarProps) {
  return (
    <div className="hdash__sidebar-col">
      <InsightsSection hubId={hubId} candidates={candidates} />
      <button className="hdash__create-btn" onClick={onCreateClick}>
        <PlusIcon />
        Create Manual Reminder
      </button>
    </div>
  );
}

function InsightsSection({ hubId, candidates }: { hubId: string; candidates: ReminderCandidate[] }) {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editDueAt, setEditDueAt] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(candidates.length / INSIGHTS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const visibleCandidates = candidates.slice((safePage - 1) * INSIGHTS_PER_PAGE, safePage * INSIGHTS_PER_PAGE);

  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(1, Math.ceil(candidates.length / INSIGHTS_PER_PAGE))));
    if (expandedId && !candidates.some((candidate) => candidate.id === expandedId)) {
      setExpandedId(null);
    }
  }, [candidates, expandedId]);

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
    <div className="hdash__sidebar-section hdash__sidebar-section--insights">
      <h4 className="hdash__sidebar-title">Suggested reminders</h4>
      {candidates.length === 0 ? (
        <p className="hdash__sidebar-empty">No pending suggestions.</p>
      ) : (
        <>
          {visibleCandidates.map((c) => (
            <div key={c.id} className="hdash__insights-card">
              <div className="hdash__insights-card-title">
                {c.title_suggestion || 'Suggested Reminder'}
              </div>
              <div className="hdash__insights-card-meta">
                <span>{formatLocal(c.due_at)}</span>
              </div>
              <div className={`hdash__confidence hdash__confidence--${getConfidenceTier(c.confidence)}`}>
                {getConfidenceLabel(c.confidence)}
              </div>

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
          ))}
          <div className="hdash__confidence-key" aria-label="Confidence key">
            <div className="hdash__confidence-key-title">Confidence key</div>
            <div className="hdash__confidence-key-list">
              <span className="hdash__confidence-key-item hdash__confidence-key-item--high">80%+ = high confidence</span>
              <span className="hdash__confidence-key-item hdash__confidence-key-item--medium">60-79% = medium</span>
              <span className="hdash__confidence-key-item hdash__confidence-key-item--low">below 60% = low</span>
            </div>
          </div>
          {totalPages > 1 && (
            <div className="hdash__insights-pagination" aria-label="AI insights pagination">
              <button
                type="button"
                className="hdash__insights-page-btn"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={safePage <= 1}
              >
                Prev
              </button>
              <span className="hdash__insights-page-info">Page {safePage} of {totalPages}</span>
              <button
                type="button"
                className="hdash__insights-page-btn"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={safePage >= totalPages}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ManualSection({
  reminders,
  onReminderClick,
  layout = 'sidebar',
}: {
  reminders: Reminder[];
  onReminderClick: (r: Reminder) => void;
  layout?: 'sidebar' | 'calendar';
}) {
  const sorted = useMemo(
    () =>
      [...reminders].sort(
        (a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
      ),
    [reminders]
  );

  return (
    <div className={`hdash__sidebar-section${layout === 'calendar' ? ' hdash__sidebar-section--calendar' : ''}`}>
      <h4 className="hdash__sidebar-title">Reminders</h4>
      {sorted.length === 0 ? (
        <p className="hdash__sidebar-empty">No reminders yet.</p>
      ) : (
        <div className={`hdash__manual-list${layout === 'calendar' ? ' hdash__manual-list--calendar' : ''}`}>
          {sorted.map((r) => (
            <div
              key={r.id}
              className={`hdash__manual-item${layout === 'calendar' ? ' hdash__manual-item--calendar' : ''}`}
              onClick={() => onReminderClick(r)}
            >
              <div className={`hdash__manual-dot hdash__manual-dot--${r.status}`} style={getReminderDotStyle(r.color_key)} />
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
