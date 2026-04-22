'use client';

// RemindersPage.tsx: Hub dashboard reminders page with calendar and list views.

import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { listReminders, listReminderCandidates } from '../../lib/api';
import { FullCalendar } from './FullCalendar';
import { ReminderModal } from './ReminderModal';
import { RemindersSidebar } from './RemindersSidebar';
import type { Reminder } from '@shared/index';

type ModalState =
  | { mode: 'closed' }
  | { mode: 'day'; date: Date }
  | { mode: 'create' }
  | { mode: 'edit'; reminder: Reminder };

export function RemindersPage({ hubId }: { hubId: string }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [modal, setModal] = useState<ModalState>({ mode: 'closed' });

  const handleMonthChange = (m: number, y: number) => {
    setMonth(m);
    setYear(y);
  };

  /* Query reminders scoped to the visible month (with a buffer either side) */
  const dueFrom = new Date(year, month - 1, 1).toISOString();
  const dueTo = new Date(year, month + 2, 0, 23, 59, 59).toISOString();

  const { data: reminders = [] } = useQuery({
    queryKey: ['reminders', hubId, dueFrom, dueTo],
    queryFn: () => listReminders({ hubId, dueFrom, dueTo }),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

  const { data: candidates = [] } = useQuery({
    queryKey: ['reminder-candidates', hubId],
    queryFn: () => listReminderCandidates({ hubId, status: 'pending' }),
    staleTime: 0,
  });

  /* Filter reminders for the day modal */
  const modalDateTs = modal.mode === 'day' ? modal.date.getTime() : 0;
  const dayReminders = useMemo(() => {
    if (modal.mode !== 'day') return [];
    const d = modal.date;
    return reminders.filter((r) => {
      const rd = new Date(r.due_at);
      return rd.getDate() === d.getDate()
        && rd.getMonth() === d.getMonth()
        && rd.getFullYear() === d.getFullYear();
    });
  }, [modal.mode, modalDateTs, reminders]);

  const handleDateClick = (date: Date) => {
    setSelectedDate(date);
    setModal({ mode: 'day', date });
  };

  const handleReminderClick = (reminder: Reminder) => {
    setModal({ mode: 'edit', reminder });
  };

  const closeModal = () => {
    setModal({ mode: 'closed' });
    setSelectedDate(null);
  };

  return (
    <div className="hdash__layout">
      <FullCalendar
        month={month}
        year={year}
        onMonthChange={handleMonthChange}
        reminders={reminders}
        candidates={candidates}
        selectedDate={selectedDate}
        onDateClick={handleDateClick}
      />
      <RemindersSidebar
        hubId={hubId}
        candidates={candidates}
        reminders={reminders}
        onReminderClick={handleReminderClick}
        onCreateClick={() => setModal({ mode: 'create' })}
      />

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
      {modal.mode === 'create' && (
        <ReminderModal
          mode="create"
          hubId={hubId}
          onClose={closeModal}
          onSaved={closeModal}
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
