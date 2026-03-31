'use client';

import { useEffect, useMemo, useRef } from "react";
import { BellIcon } from "@heroicons/react/24/solid";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptInvite,
  dismissInviteNotification,
  dismissReminderNotification,
  listInviteNotifications,
  listReminderNotifications,
  updateReminder,
} from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";
import type { NotificationEvent, PendingInvite, Reminder } from "../../lib/types";

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
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["invite-notifications"],
    queryFn: listInviteNotifications,
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
      queryClient.invalidateQueries({ queryKey: ["invite-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["invites"] });
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
    },
  });

  const dismissInviteMutation = useMutation({
    mutationFn: (hubId: string) => dismissInviteNotification(hubId),
    onMutate: async (hubId: string) => {
      await queryClient.cancelQueries({ queryKey: ["invite-notifications"] });
      const previousInvites = queryClient.getQueryData<PendingInvite[]>(["invite-notifications"]);
      queryClient.setQueryData<PendingInvite[]>(["invite-notifications"], (current = []) =>
        current.filter((invite) => invite.hub.id !== hubId)
      );
      return { previousInvites };
    },
    onError: (_error, _hubId, context) => {
      if (context?.previousInvites) {
        queryClient.setQueryData(["invite-notifications"], context.previousInvites);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["invite-notifications"] });
    },
  });

  const dismissReminderMutation = useMutation({
    mutationFn: (notificationId: string) => dismissReminderNotification(notificationId),
    onMutate: async (notificationId: string) => {
      await queryClient.cancelQueries({ queryKey: ["reminder-notifications"] });
      const previousNotifications = queryClient.getQueryData<NotificationEvent[]>(["reminder-notifications"]);
      queryClient.setQueryData<NotificationEvent[]>(["reminder-notifications"], (current = []) =>
        current.filter((notice) => notice.id !== notificationId)
      );
      return { previousNotifications };
    },
    onError: (_error, _notificationId, context) => {
      if (context?.previousNotifications) {
        queryClient.setQueryData(["reminder-notifications"], context.previousNotifications);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["reminder-notifications"] });
    },
  });

  const completeReminderMutation = useMutation({
    mutationFn: ({ reminderId }: { reminderId: string }) => updateReminder(reminderId, { action: "complete" }),
    onMutate: async ({ reminderId }: { reminderId: string }) => {
      await queryClient.cancelQueries({ queryKey: ["reminder-notifications"] });
      const previousNotifications = queryClient.getQueryData<NotificationEvent[]>(["reminder-notifications"]);
      queryClient.setQueryData<NotificationEvent[]>(["reminder-notifications"], (current = []) =>
        current.filter((notice) => notice.reminder_id !== reminderId)
      );
      return { previousNotifications };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousNotifications) {
        queryClient.setQueryData(["reminder-notifications"], context.previousNotifications);
      }
    },
    onSuccess: (updatedReminder) => {
      queryClient.setQueriesData(
        { queryKey: ["reminders"] },
        (current: Reminder[] | undefined) =>
          current?.map((reminder) => (reminder.id === updatedReminder.id ? updatedReminder : reminder))
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["reminder-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["reminders"] });
    },
  });

  const visibleInvites = useMemo(() => data ?? [], [data]);
  const visibleReminders = useMemo(
    () => (reminderNotifications ?? []).filter((notice) => !["completed", "cancelled"].includes(notice.reminder.status)),
    [reminderNotifications]
  );

  const count = visibleInvites.length + visibleReminders.length;
  const summaryLabel = useMemo(() => {
    if (!count) return "Notifications";
    return `${count} new notification${count === 1 ? "" : "s"}`;
  }, [count]);

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
            <ReminderNotificationCard
              key={notice.id}
              notice={notice}
              onDismiss={(notificationId) => dismissReminderMutation.mutate(notificationId)}
              onComplete={(reminderId) => completeReminderMutation.mutate({ reminderId })}
              isDismissing={dismissReminderMutation.variables === notice.id}
              isCompleting={completeReminderMutation.variables?.reminderId === notice.reminder_id}
            />
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
                    disabled={acceptMutation.isPending || dismissInviteMutation.variables === invite.hub.id}
                  >
                    {acceptMutation.isPending ? "Accepting..." : "Accept"}
                  </button>
                  <button
                    className="notification-dismiss"
                    type="button"
                    onClick={() => dismissInviteMutation.mutate(invite.hub.id)}
                    disabled={acceptMutation.isPending || dismissInviteMutation.variables === invite.hub.id}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })}
          {(dismissInviteMutation.error || dismissReminderMutation.error || completeReminderMutation.error) && (
            <p className="notifications-error">
              Failed to update notification: {((dismissInviteMutation.error || dismissReminderMutation.error || completeReminderMutation.error) as Error).message}
            </p>
          )}
        </div>
      </div>
    </details>
  );
}

function ReminderNotificationCard({
  notice,
  onDismiss,
  onComplete,
  isDismissing,
  isCompleting,
}: {
  notice: NotificationEvent;
  onDismiss: (notificationId: string) => void;
  onComplete: (reminderId: string) => void;
  isDismissing: boolean;
  isCompleting: boolean;
}) {
  const title = notice.reminder.message || "Reminder alert";
  const dueLabel = formatLocalDate(notice.reminder.due_at);
  const sentLabel = formatTimeAgo(notice.sent_at ?? notice.scheduled_for);
  const hubLabel = notice.reminder.hub_name?.trim() || "Unknown hub";

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
              <span className="notification-role notification-role--hub" title={hubLabel}>{hubLabel}</span>
            </span>
          </div>
        </div>
      </div>
      <div className="notification-actions">
        {notice.reminder.status !== "completed" && (
          <button
            className="notification-accept"
            type="button"
            onClick={() => onComplete(notice.reminder_id)}
            disabled={isDismissing || isCompleting}
          >
            {isCompleting ? "Completing..." : "Complete"}
          </button>
        )}
        <button
          className="notification-dismiss"
          type="button"
          onClick={() => onDismiss(notice.id)}
          disabled={isDismissing || isCompleting}
        >
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
