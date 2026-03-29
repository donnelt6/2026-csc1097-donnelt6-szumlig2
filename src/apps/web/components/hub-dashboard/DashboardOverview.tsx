'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightIcon } from '@heroicons/react/24/outline';
import { MiniCalendar } from '../dashboard/MiniCalendar';
import { GuidePanel } from '../GuidePanel';
import { FaqPanel } from '../FaqPanel';
import { ReminderModal } from './ReminderModal';
import { listReminders } from '../../lib/api';
import { formatLocal } from '../../lib/dateUtils';
import type { HubDashboardTab } from '../../lib/HubDashboardTabContext';
import type { Reminder } from '../../lib/types';

type ModalState =
  | { mode: 'closed' }
  | { mode: 'day'; date: Date }
  | { mode: 'edit'; reminder: Reminder };

interface DashboardOverviewProps {
  hubId: string;
  chatSourceIds: string[];
  completeSourceIds: string[];
  canEdit: boolean;
  onSwitchTab: (tab: HubDashboardTab) => void;
}

export function DashboardOverview({
  hubId,
  chatSourceIds,
  completeSourceIds,
  canEdit,
  onSwitchTab,
}: DashboardOverviewProps) {
  const now = new Date();
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [modal, setModal] = useState<ModalState>({ mode: 'closed' });

  /* Fetch all upcoming reminders (from today onwards) */
  const { data: upcoming = [] } = useQuery({
    queryKey: ['reminders', hubId, 'upcoming'],
    queryFn: () => listReminders({ hubId, dueFrom: new Date().toISOString(), status: 'scheduled' }),
    staleTime: 0,
  });

  /* Fetch reminders for the visible calendar month (for dots) */
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

  /* Reminders for the selected day modal */
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

  /* Sort upcoming by date, show max 5 */
  const upcomingList = useMemo(
    () => [...upcoming].sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()).slice(0, 5),
    [upcoming]
  );

  const closeModal = () => setModal({ mode: 'closed' });

  return (
    <div className="hdash__overview">
      {/* Left column — Guides + FAQs previews */}
      <div className="hdash__overview-main">
        <section className="hub-dashboard__section">
          <div className="hdash__overview-section-header">
            <h3 className="hub-dashboard__section-title">Guides</h3>
            <button
              className="hdash__overview-link"
              type="button"
              onClick={() => onSwitchTab('guides')}
            >
              View all <ArrowRightIcon className="hdash__overview-link-icon" />
            </button>
          </div>
          <GuidePanel
            hubId={hubId}
            selectedSourceIds={chatSourceIds}
            hasSelectableSources={completeSourceIds.length > 0}
            canEdit={canEdit}
          />
        </section>

        <section className="hub-dashboard__section">
          <div className="hdash__overview-section-header">
            <h3 className="hub-dashboard__section-title">FAQs</h3>
            <button
              className="hdash__overview-link"
              type="button"
              onClick={() => onSwitchTab('faqs')}
            >
              View all <ArrowRightIcon className="hdash__overview-link-icon" />
            </button>
          </div>
          <FaqPanel
            hubId={hubId}
            selectedSourceIds={chatSourceIds}
            hasSelectableSources={completeSourceIds.length > 0}
            canEdit={canEdit}
          />
        </section>
      </div>

      {/* Right column — Mini calendar + upcoming reminders */}
      <div className="hdash__overview-aside">
        <div className="hdash__overview-section-header">
          <h3 className="hub-dashboard__section-title">Reminders</h3>
          <button
            className="hdash__overview-link"
            type="button"
            onClick={() => onSwitchTab('reminders')}
          >
            View all <ArrowRightIcon className="hdash__overview-link-icon" />
          </button>
        </div>

        <div className="hdash__overview-cal-wrap">
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
