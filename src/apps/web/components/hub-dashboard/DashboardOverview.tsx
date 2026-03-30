'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import { MiniCalendar } from '../dashboard/MiniCalendar';
import { ReminderModal } from './ReminderModal';
import { listFaqs, listGuides, listReminders, updateGuideStepProgress } from '../../lib/api';
import { formatLocal } from '../../lib/dateUtils';
import type { HubDashboardTab } from '../../lib/HubDashboardTabContext';
import type { GuideEntry, Reminder } from '../../lib/types';

type ModalState =
  | { mode: 'closed' }
  | { mode: 'day'; date: Date }
  | { mode: 'edit'; reminder: Reminder };

type ContentTab = 'guides' | 'faqs';

interface DashboardOverviewProps {
  hubId: string;
  canEdit: boolean;
  onSwitchTab: (tab: HubDashboardTab) => void;
}

export function DashboardOverview({
  hubId,
  canEdit,
  onSwitchTab,
}: DashboardOverviewProps) {
  const queryClient = useQueryClient();
  const now = new Date();
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [modal, setModal] = useState<ModalState>({ mode: 'closed' });
  const [contentTab, setContentTab] = useState<ContentTab>('guides');
  const [guideIndex, setGuideIndex] = useState(0);

  /* ---- Guides ---- */
  const { data: guides = [] } = useQuery({
    queryKey: ['guides', hubId],
    queryFn: () => listGuides(hubId),
    staleTime: 0,
  });

  const activeGuides = useMemo(
    () => guides.filter((g: GuideEntry) => !g.archived_at),
    [guides]
  );

  /* ---- FAQs ---- */
  const { data: faqs = [] } = useQuery({
    queryKey: ['faqs', hubId],
    queryFn: () => listFaqs(hubId),
    staleTime: 0,
  });

  const previewFaqs = useMemo(
    () => faqs.slice(0, 3),
    [faqs]
  );

  const currentGuide = activeGuides[guideIndex] as GuideEntry | undefined;

  const progressMutation = useMutation({
    mutationFn: ({ stepId, isComplete }: { stepId: string; isComplete: boolean }) =>
      updateGuideStepProgress(stepId, { is_complete: isComplete }),
    onMutate: async ({ stepId, isComplete }) => {
      await queryClient.cancelQueries({ queryKey: ['guides', hubId] });
      const prev = queryClient.getQueryData<GuideEntry[]>(['guides', hubId]);
      queryClient.setQueryData<GuideEntry[]>(['guides', hubId], (old) =>
        old?.map((g) => ({
          ...g,
          steps: g.steps.map((s) =>
            s.id === stepId ? { ...s, is_complete: isComplete } : s
          ),
        }))
      );
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(['guides', hubId], context.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['guides', hubId] }),
  });

  /* ---- Reminders ---- */
  const { data: upcoming = [] } = useQuery({
    queryKey: ['reminders', hubId, 'upcoming'],
    queryFn: () => listReminders({ hubId, dueFrom: new Date().toISOString(), status: 'scheduled' }),
    staleTime: 0,
  });

  const dueFrom = new Date(calYear, calMonth, 1).toISOString();
  const dueTo = new Date(calYear, calMonth + 1, 0, 23, 59, 59).toISOString();

  const { data: monthReminders = [] } = useQuery({
    queryKey: ['reminders', hubId, dueFrom, dueTo],
    queryFn: () => listReminders({ hubId, dueFrom, dueTo }),
    staleTime: 0,
  });

  const reminderDays = new Set(
    monthReminders
      .filter((r) => {
        const d = new Date(r.due_at);
        return d.getMonth() === calMonth && d.getFullYear() === calYear;
      })
      .map((r) => new Date(r.due_at).getDate())
  );

  const dayReminders = useMemo(() => {
    if (modal.mode !== 'day') return [];
    const d = modal.date;
    return monthReminders.filter((r) => {
      const rd = new Date(r.due_at);
      return rd.getDate() === d.getDate()
        && rd.getMonth() === d.getMonth()
        && rd.getFullYear() === d.getFullYear();
    });
  }, [modal, monthReminders]);

  const upcomingList = useMemo(
    () => [...upcoming].sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()).slice(0, 5),
    [upcoming]
  );

  const closeModal = () => setModal({ mode: 'closed' });

  /* ---- Guide progress ---- */
  const guideTotal = currentGuide?.steps.length ?? 0;
  const guideCompleted = currentGuide?.steps.filter((s) => s.is_complete).length ?? 0;
  const guidePct = guideTotal > 0 ? Math.round((guideCompleted / guideTotal) * 100) : 0;

  return (
    <div className="hdash__overview">
      {/* Left column — Guides / FAQs */}
      <div className="hdash__overview-main">
        <div className="hdash__content-card">
          <div className="hdash__content-tabs">
            <button
              className={`hdash__content-tab${contentTab === 'guides' ? ' hdash__content-tab--active' : ''}`}
              type="button"
              onClick={() => setContentTab('guides')}
            >
              GUIDES
            </button>
            <button
              className={`hdash__content-tab${contentTab === 'faqs' ? ' hdash__content-tab--active' : ''}`}
              type="button"
              onClick={() => setContentTab('faqs')}
            >
              FAQS
            </button>

            <div className="hdash__content-tabs-actions">
              <button
                className="hdash__overview-link"
                type="button"
                onClick={() => onSwitchTab(contentTab === 'guides' ? 'guides' : 'faqs')}
              >
                View all <ArrowRightIcon className="hdash__overview-link-icon" />
              </button>
            </div>
          </div>

          {contentTab === 'guides' && (
            <div className="hdash__guide-preview">
              {activeGuides.length === 0 ? (
                <p className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>
                  No guides yet.{' '}
                  {canEdit && (
                    <button
                      className="hdash__overview-link"
                      type="button"
                      onClick={() => onSwitchTab('guides')}
                    >
                      Create one <ArrowRightIcon className="hdash__overview-link-icon" />
                    </button>
                  )}
                </p>
              ) : currentGuide && (
                <>
                  {/* Guide header */}
                  <div className="hdash__guide-header">
                    <div className="hdash__guide-header-left">
                      <div className="hdash__guide-icon">
                        <DocumentTextIcon />
                      </div>
                      <div>
                        <h4 className="hdash__guide-title">{currentGuide.title}</h4>
                        {currentGuide.topic && (
                          <p className="hdash__guide-topic">{currentGuide.topic}</p>
                        )}
                      </div>
                    </div>
                    <div className="hdash__guide-header-right">
                      <div className="hdash__guide-progress">
                        <span className="hdash__guide-progress-label">PROGRESS</span>
                        <div className="hdash__guide-progress-row">
                          <span className="hdash__guide-progress-pct">{guidePct}%</span>
                          <span className="hdash__guide-progress-text">Complete</span>
                        </div>
                        <div className="hdash__guide-progress-bar">
                          <div
                            className="hdash__guide-progress-fill"
                            style={{ width: `${guidePct}%` }}
                          />
                        </div>
                      </div>
                      {activeGuides.length > 1 && (
                        <div className="hdash__guide-pager">
                          <button
                            className="hdash__guide-pager-arrow"
                            type="button"
                            disabled={guideIndex === 0}
                            onClick={() => setGuideIndex(guideIndex - 1)}
                            aria-label="Previous guide"
                          >
                            <ChevronLeftIcon />
                          </button>
                          <span className="hdash__guide-pager-info">
                            {guideIndex + 1} of {activeGuides.length}
                          </span>
                          <button
                            className="hdash__guide-pager-arrow"
                            type="button"
                            disabled={guideIndex === activeGuides.length - 1}
                            onClick={() => setGuideIndex(guideIndex + 1)}
                            aria-label="Next guide"
                          >
                            <ChevronRightIcon />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Steps */}
                  <div className="hdash__guide-steps">
                    {currentGuide.steps.map((step, i) => (
                      <div
                        key={step.id}
                        className={`hdash__guide-step${step.is_complete ? ' hdash__guide-step--done' : ''}`}
                      >
                        <label className="hdash__guide-step-check">
                          <input
                            type="checkbox"
                            checked={!!step.is_complete}
                            onChange={() =>
                              progressMutation.mutate({
                                stepId: step.id,
                                isComplete: !step.is_complete,
                              })
                            }
                          />
                          <span className="hdash__guide-step-check-box">
                            {step.is_complete && (
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <path d="M2 5.5L4 7.5L8 3" />
                              </svg>
                            )}
                          </span>
                        </label>
                        <span className="hdash__guide-step-num">{i + 1}</span>
                        <div className="hdash__guide-step-content">
                          <span className="hdash__guide-step-title">
                            {step.title || `Step ${i + 1}`}
                          </span>
                          {step.instruction && (
                            <span className="hdash__guide-step-desc">{step.instruction}</span>
                          )}
                          {step.citations.length > 0 && (
                            <div className="hdash__guide-step-sources">
                              <span className="hdash__guide-step-sources-label">SOURCES:</span>
                              {step.citations.map((c, ci) => (
                                <span
                                  key={`${c.source_id}-${c.chunk_index ?? ci}`}
                                  className="hdash__guide-step-source-pill"
                                >
                                  {c.source_id.slice(0, 6)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                </>
              )}
            </div>
          )}

          {contentTab === 'faqs' && (
            <div className="hdash__guide-preview">
              {faqs.length === 0 ? (
                <p className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>
                  No FAQs yet.{' '}
                  {canEdit && (
                    <button
                      className="hdash__overview-link"
                      type="button"
                      onClick={() => onSwitchTab('faqs')}
                    >
                      Generate some <ArrowRightIcon className="hdash__overview-link-icon" />
                    </button>
                  )}
                </p>
              ) : (
                <div className="hdash__faq-list">
                  {previewFaqs.map((faq) => (
                    <div key={faq.id} className="hdash__faq-item">
                      <h4 className="hdash__faq-question">{faq.question}</h4>
                      <p className="hdash__faq-answer">
                        {faq.answer.length > 120 ? `${faq.answer.slice(0, 120)}...` : faq.answer}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right column — Mini calendar + upcoming reminders */}
      <div className="hdash__overview-aside">
        <div className="hdash__aside-card">
          <div className="hdash__aside-header">
            <h3 className="hdash__aside-title">REMINDERS &amp; MILESTONES</h3>
            <button
              className="hdash__overview-link"
              type="button"
              onClick={() => onSwitchTab('reminders')}
            >
              View all <ArrowRightIcon className="hdash__overview-link-icon" />
            </button>
          </div>

          <div className="hdash__aside-cal-wrap">
            <MiniCalendar
              month={calMonth}
              year={calYear}
              onMonthChange={(m, y) => { setCalMonth(m); setCalYear(y); }}
              reminderDays={reminderDays}
              onDayClick={(day) => setModal({ mode: 'day', date: new Date(calYear, calMonth, day) })}
            />
          </div>

          <div className="hdash__upcoming">
            <h4 className="hdash__upcoming-title">Upcoming</h4>
          {upcomingList.length === 0 ? (
            <p className="hdash__upcoming-empty">No upcoming reminders.</p>
          ) : (
            upcomingList.map((r) => (
              <div
                key={r.id}
                className="hdash__upcoming-item"
                onClick={() => setModal({ mode: 'day', date: new Date(r.due_at) })}
              >
                <div className={`hdash__manual-dot hdash__manual-dot--${r.status}`} />
                <div className="hdash__upcoming-info">
                  <span className="hdash__upcoming-msg">{r.title || r.message || 'Reminder'}</span>
                  <span className="hdash__upcoming-due">{formatLocal(r.due_at)}</span>
                </div>
              </div>
            ))
          )}
          {upcoming.length > 5 && (
            <button
              className="hdash__overview-link"
              type="button"
              onClick={() => onSwitchTab('reminders')}
              style={{ marginTop: 4 }}
            >
              +{upcoming.length - 5} more <ArrowRightIcon className="hdash__overview-link-icon" />
            </button>
          )}
        </div>
        </div>
      </div>

      {/* Day modal — opens on top of the dashboard overview */}
      {modal.mode === 'day' && (
        <ReminderModal
          mode="day"
          hubId={hubId}
          date={modal.date}
          reminders={dayReminders}
          onClose={closeModal}
          onSaved={closeModal}
          onEditReminder={(r) => setModal({ mode: 'edit', reminder: r })}
        />
      )}
      {modal.mode === 'edit' && (
        <ReminderModal
          mode="edit"
          hubId={hubId}
          reminder={modal.reminder}
          onClose={closeModal}
          onSaved={closeModal}
        />
      )}
    </div>
  );
}
