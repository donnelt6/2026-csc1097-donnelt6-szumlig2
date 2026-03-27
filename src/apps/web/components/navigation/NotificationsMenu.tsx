'use client';

import { useMemo, useState, useRef, useEffect } from "react";
import { BellIcon } from "@heroicons/react/24/solid";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { acceptInvite, listInvites, listReminderNotifications } from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";
import type { NotificationEvent } from "../../lib/types";

function formatTimeAgo(value?: string | null) {
  if (!value) return "recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSeconds < 60) return "just now";
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

function truncateLabel(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trimEnd()}...`;
}

function formatLocalDate(value?: string | null) {
  if (!value) return "unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatIrelandDateTime(date);
}

export function NotificationsMenu() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dismissedInvites, setDismissedInvites] = useState<string[]>([]);
  const [dismissedReminders, setDismissedReminders] = useState<string[]>([]);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["invites"],
    queryFn: listInvites,
    enabled: !!user,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const {
    data: reminderNotifications,
    isLoading: remindersLoading,
    error: remindersError,
  } = useQuery({
    queryKey: ["reminder-notifications"],
    queryFn: () => listReminderNotifications(),
    enabled: !!user,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const acceptMutation = useMutation({
    mutationFn: (hubId: string) => acceptInvite(hubId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invites"] });
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
    },
  });

  const visibleInvites = useMemo(() => {
    if (!data?.length) return [];
    return data.filter((invite) => !dismissedInvites.includes(invite.hub.id));
  }, [data, dismissedInvites]);

  const visibleReminders = useMemo(() => {
    if (!reminderNotifications?.length) return [];
    return reminderNotifications.filter((notice) => !dismissedReminders.includes(notice.id));
  }, [reminderNotifications, dismissedReminders]);

  const count = visibleInvites.length + visibleReminders.length;
  const summaryLabel = useMemo(() => {
    if (!count) return "Notifications";
    return `${count} new notification${count === 1 ? "" : "s"}`;
  }, [count]);

  const dismissInvite = (hubId: string) => {
    setDismissedInvites((prev) => (prev.includes(hubId) ? prev : [...prev, hubId]));
  };

  const dismissReminder = (notificationId: string) => {
    setDismissedReminders((prev) => (prev.includes(notificationId) ? prev : [...prev, notificationId]));
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (detailsRef.current && !detailsRef.current.contains(event.target as Node)) {
        detailsRef.current.open = false;
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && detailsRef.current?.open) {
        detailsRef.current.open = false;
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  if (!user) return null;

  return (
    <details className="notifications-menu" ref={detailsRef}>
      <summary className="notifications-trigger" aria-label={summaryLabel}>
        <span className="notifications-icon" aria-hidden="true">
          <BellIcon />
        </span>
        {count > 0 && <span className="notifications-badge">{count}</span>}
      </summary>
      <div className="notifications-panel">
        <div className="notifications-header">
          <p className="notifications-title">Notifications</p>
          <p className="notifications-subtitle">{count ? `${count} new` : "All caught up"}</p>
        </div>
        <div className="notifications-list">
          {isLoading && <p className="notifications-empty">Loading invites...</p>}
          {error && <p className="notifications-error">Failed to load invites: {(error as Error).message}</p>}
          {remindersLoading && <p className="notifications-empty">Loading reminders...</p>}
          {remindersError && <p className="notifications-error">Failed to load reminders: {(remindersError as Error).message}</p>}
          {!isLoading && !error && !remindersLoading && !remindersError && count === 0 && (
            <p className="notifications-empty">No new notifications</p>
          )}
          {visibleReminders.map((notice) => (
            <ReminderNotificationCard key={notice.id} notice={notice} onDismiss={dismissReminder} />
          ))}
          {visibleInvites.map((invite) => {
            const hubLabel = truncateLabel(invite.hub.name, 25);
            return (
              <div key={invite.hub.id} className="notification-card">
                <div className="notification-content">
                  <div className="notification-icon" aria-hidden="true">
                    !
                  </div>
                  <div className="notification-body">
                    <p className="notification-title">You have a new hub invite</p>
                    <div className="notification-meta-row">
                      <span className="notification-hub" title={invite.hub.name}>
                        {hubLabel}
                      </span>
                    </div>
                    <div className="notification-meta-row">
                      <span className="notification-meta-right">
                        <span className="notification-time">{formatTimeAgo(invite.invited_at)}</span>
                        <span className="notification-role">{invite.role}</span>
                      </span>
                    </div>
                  </div>
                </div>
                <div className="notification-actions">
                  <button
                    className="notification-accept"
                    type="button"
                    onClick={() => acceptMutation.mutate(invite.hub.id)}
                    disabled={acceptMutation.isPending}
                  >
                    {acceptMutation.isPending ? "Accepting..." : "Accept"}
                  </button>
                  <button className="notification-dismiss" type="button" onClick={() => dismissInvite(invite.hub.id)}>
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}

function ReminderNotificationCard({
  notice,
  onDismiss,
}: {
  notice: NotificationEvent;
  onDismiss: (notificationId: string) => void;
}) {
  const title = notice.reminder.message || "Reminder alert";
  const dueLabel = formatLocalDate(notice.reminder.due_at);
  const sentLabel = formatTimeAgo(notice.sent_at ?? notice.scheduled_for);

  return (
    <div className="notification-card">
      <div className="notification-content">
        <div className="notification-icon" aria-hidden="true">
          R
        </div>
        <div className="notification-body">
          <p className="notification-title">{title}</p>
          <div className="notification-meta-row">
            <span className="notification-hub">Due {dueLabel}</span>
          </div>
          <div className="notification-meta-row">
            <span className="notification-meta-right">
              <span className="notification-time">{sentLabel}</span>
              <span className="notification-role">{notice.channel.replace("_", " ")}</span>
            </span>
          </div>
        </div>
      </div>
      <div className="notification-actions">
        <button className="notification-dismiss" type="button" onClick={() => onDismiss(notice.id)}>
          Dismiss
        </button>
      </div>
    </div>
  );
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
