'use client';

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { acceptInvite, listInvites } from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";

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

export function NotificationsMenu() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dismissedInvites, setDismissedInvites] = useState<string[]>([]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["invites"],
    queryFn: listInvites,
    enabled: !!user,
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

  const count = visibleInvites.length;
  const summaryLabel = useMemo(() => {
    if (!count) return "Notifications";
    return `${count} new notification${count === 1 ? "" : "s"}`;
  }, [count]);

  const dismissInvite = (hubId: string) => {
    setDismissedInvites((prev) => (prev.includes(hubId) ? prev : [...prev, hubId]));
  };

  if (!user) return null;

  return (
    <details className="notifications-menu">
      <summary className="notifications-trigger" aria-label={summaryLabel}>
        <span className="notifications-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="presentation">
            <path
              d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm0 2v.01L12 12l8-4.99V7H4zm16 10V9.25l-7.4 4.63a1 1 0 0 1-1.2 0L4 9.25V17h16z"
              fill="currentColor"
            />
          </svg>
        </span>
        {count > 0 && <span className="notifications-badge">{count}</span>}
      </summary>
      <div className="notifications-panel">
        <div className="notifications-header">
          <p className="notifications-title">Invites</p>
          <p className="notifications-subtitle">{count ? `${count} new` : "All caught up"}</p>
        </div>
        <div className="notifications-list">
          {isLoading && <p className="notifications-empty">Loading invites...</p>}
          {error && <p className="notifications-error">Failed to load invites: {(error as Error).message}</p>}
          {!isLoading && !error && count === 0 && <p className="notifications-empty">No new notifications</p>}
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
