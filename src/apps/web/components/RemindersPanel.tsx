'use client';

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createReminder, deleteReminder, listReminders, updateReminder } from "../lib/api";
import type { Reminder, ReminderStatus, ReminderUpdateAction } from "../lib/types";

interface Props {
  hubId: string;
}

type ReminderUpdatePayload = {
  due_at?: string;
  timezone?: string;
  message?: string;
  action?: ReminderUpdateAction;
  snooze_minutes?: number;
};

export function RemindersPanel({ hubId }: Props) {
  const queryClient = useQueryClient();
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const [dueAt, setDueAt] = useState("");
  const [message, setMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDueAt, setEditDueAt] = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [scheduleInputs, setScheduleInputs] = useState<Record<string, string>>({});
  const [busyAction, setBusyAction] = useState<{ id: string; action: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["reminders", hubId],
    queryFn: () => listReminders({ hubId }),
    refetchInterval: 5000,
  });

  const createMutation = useMutation({
    mutationFn: createReminder,
    onSuccess: () => {
      setDueAt("");
      setMessage("");
      setStatusMessage("Reminder scheduled.");
      queryClient.invalidateQueries({ queryKey: ["reminders", hubId] });
    },
    onError: (err) => setStatusMessage((err as Error).message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ reminderId, payload }: { reminderId: string; payload: ReminderUpdatePayload }) =>
      updateReminder(reminderId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reminders", hubId] });
      setEditingId(null);
      setBusyAction(null);
    },
    onError: (err) => {
      setStatusMessage((err as Error).message);
      setBusyAction(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteReminder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reminders", hubId] });
      setBusyAction(null);
    },
    onError: (err) => {
      setStatusMessage((err as Error).message);
      setBusyAction(null);
    },
  });

  const reminders = useMemo(
    () =>
      (data ?? []).slice().sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()),
    [data]
  );

  const handleCreate = () => {
    if (!dueAt) {
      setStatusMessage("Choose a due date and time.");
      return;
    }
    const dueIso = toIsoFromLocalInput(dueAt);
    if (!dueIso) {
      setStatusMessage("Invalid due date.");
      return;
    }
    createMutation.mutate({
      hub_id: hubId,
      due_at: dueIso,
      timezone,
      message: message.trim() || undefined,
    });
  };

  const handleSnooze = (reminderId: string, minutes: number) => {
    setBusyAction({ id: reminderId, action: `snooze-${minutes}` });
    updateMutation.mutate({ reminderId, payload: { action: "snooze", snooze_minutes: minutes } });
  };

  const handleComplete = (reminderId: string) => {
    setBusyAction({ id: reminderId, action: "complete" });
    updateMutation.mutate({ reminderId, payload: { action: "complete" } });
  };

  const handleDelete = (reminderId: string) => {
    setBusyAction({ id: reminderId, action: "delete" });
    deleteMutation.mutate(reminderId);
  };

  const startEdit = (reminder: Reminder) => {
    setEditingId(reminder.id);
    setEditDueAt(toLocalInputValue(reminder.due_at));
    setEditMessage(reminder.message ?? "");
  };

  const saveEdit = (reminderId: string) => {
    const dueIso = editDueAt ? toIsoFromLocalInput(editDueAt) : null;
    const payload: Record<string, unknown> = {};
    if (dueIso) payload.due_at = dueIso;
    if (editMessage.trim()) payload.message = editMessage.trim();
    if (!payload.due_at && !payload.message) {
      setStatusMessage("No changes to save.");
      return;
    }
    setBusyAction({ id: reminderId, action: "edit" });
    updateMutation.mutate({ reminderId, payload });
  };

  const toggleMenu = (reminderId: string) => {
    setOpenMenuId((prev) => (prev === reminderId ? null : reminderId));
  };

  const getScheduleValue = (reminder: Reminder) => {
    return scheduleInputs[reminder.id] ?? toLocalInputValue(reminder.due_at);
  };

  const handleSchedule = (reminder: Reminder) => {
    const value = getScheduleValue(reminder);
    if (!value) {
      setStatusMessage("Choose a date and time.");
      return;
    }
    const target = new Date(value);
    if (Number.isNaN(target.getTime())) {
      setStatusMessage("Invalid date and time.");
      return;
    }
    const now = Date.now();
    const diffMs = target.getTime() - now;
    if (diffMs <= 0) {
      setStatusMessage("Choose a future time.");
      return;
    }
    const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
    setOpenMenuId(null);
    setBusyAction({ id: reminder.id, action: "schedule" });
    updateMutation.mutate({ reminderId: reminder.id, payload: { action: "snooze", snooze_minutes: diffMinutes } });
  };

  return (
    <div className="card grid">
      <div>
        <h3 style={{ margin: 0 }}>Reminders</h3>
        <p className="muted">Create and manage due dates for this hub.</p>
      </div>
      <div className="grid" style={{ gap: "10px" }}>
        <label>
          <span className="muted">Due date</span>
          <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </label>
        <label>
          <span className="muted">Message</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Add a reminder message"
          />
        </label>
        <button className="button" type="button" onClick={handleCreate} disabled={createMutation.isPending}>
          {createMutation.isPending ? "Scheduling..." : "Create reminder"}
        </button>
        {statusMessage && <p className="muted">{statusMessage}</p>}
      </div>
      <div className="grid" style={{ gap: "12px" }}>
        {isLoading && <p className="muted">Loading reminders...</p>}
        {error && <p className="muted">Failed to load reminders: {(error as Error).message}</p>}
        {!isLoading && !error && reminders.length === 0 && (
          <p className="muted">No reminders yet. Create your first one above.</p>
        )}
        {reminders.map((reminder) => {
          const isEditing = editingId === reminder.id;
          const isBusy = busyAction?.id === reminder.id;
          const canPostpone = reminder.status === "scheduled";
          const canRetrigger = reminder.status === "sent";
          return (
            <div key={reminder.id} className="card" style={{ borderColor: "#25304a" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                <div>
                  <strong>{reminder.message || "Reminder"}</strong>
                  <p className="muted" style={{ marginTop: "4px" }}>
                    Due {formatLocal(reminder.due_at)}
                  </p>
                  {reminder.source_id && (
                    <p className="muted" style={{ marginTop: "4px" }}>
                      Source {reminder.source_id.slice(0, 8)}
                    </p>
                  )}
                </div>
                <ReminderStatusPill status={reminder.status} />
              </div>
              {isEditing && (
                <div className="grid" style={{ gap: "8px", marginTop: "10px" }}>
                  <label>
                    <span className="muted">Edit due date</span>
                    <input type="datetime-local" value={editDueAt} onChange={(e) => setEditDueAt(e.target.value)} />
                  </label>
                  <label>
                    <span className="muted">Edit message</span>
                    <textarea value={editMessage} onChange={(e) => setEditMessage(e.target.value)} />
                  </label>
                </div>
              )}
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
                {reminder.status !== "completed" && (
                  <button className="button" type="button" onClick={() => handleComplete(reminder.id)} disabled={isBusy}>
                    Complete
                  </button>
                )}
                <button
                  className="button"
                  type="button"
                  onClick={() => (isEditing ? saveEdit(reminder.id) : startEdit(reminder))}
                  disabled={isBusy}
                >
                  {isEditing ? "Save" : "Edit"}
                </button>
                {(canPostpone || canRetrigger) && (
                  <div style={{ position: "relative" }}>
                    <button className="button" type="button" onClick={() => toggleMenu(reminder.id)} disabled={isBusy}>
                      {canPostpone ? "Postpone" : "Retrigger"}
                    </button>
                    {openMenuId === reminder.id && (
                      <div
                        className="card"
                        style={{
                          position: "absolute",
                          right: 0,
                          top: "calc(100% + 8px)",
                          zIndex: 5,
                          minWidth: "160px",
                          padding: "10px",
                          display: "grid",
                          gap: "8px",
                        }}
                      >
                        <label style={{ display: "grid", gap: "6px" }}>
                          <span className="muted">Date &amp; time</span>
                          <input
                            type="datetime-local"
                            value={getScheduleValue(reminder)}
                            onChange={(e) =>
                              setScheduleInputs((prev) => ({ ...prev, [reminder.id]: e.target.value }))
                            }
                          />
                        </label>
                        <button className="button" type="button" onClick={() => handleSchedule(reminder)} disabled={isBusy}>
                          Set time
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <button className="button" type="button" onClick={() => handleDelete(reminder.id)} disabled={isBusy}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReminderStatusPill({ status }: { status: ReminderStatus }) {
  const colors: Record<ReminderStatus, string> = {
    scheduled: "#38bdf8",
    sent: "#34d399",
    completed: "#a3e635",
    cancelled: "#f87171",
  };
  return (
    <span
      style={{
        borderRadius: "999px",
        padding: "6px 10px",
        fontWeight: 700,
        fontSize: "0.75rem",
        background: colors[status],
        color: "#0b1221",
        height: "fit-content",
      }}
    >
      {status.toUpperCase()}
    </span>
  );
}

function formatLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatIrelandDateTime(date);
}

function toLocalInputValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function toIsoFromLocalInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function formatIrelandDateTime(date: Date) {
  const day = pad2(date.getDate());
  const month = pad2(date.getMonth() + 1);
  const year = date.getFullYear();
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}
