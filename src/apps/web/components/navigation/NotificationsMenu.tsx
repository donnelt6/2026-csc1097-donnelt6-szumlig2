'use client';

import { useMemo, useState } from "react";

type InviteNotification = {
  id: string;
  sender: string;
  hub: string;
  timeAgo: string;
};

export function NotificationsMenu() {
  const [invites, setInvites] = useState<InviteNotification[]>([]);

  const count = invites.length;
  const summaryLabel = useMemo(() => {
    if (!count) return "Notifications";
    return `${count} new notification${count === 1 ? "" : "s"}`;
  }, [count]);

  const dismissInvite = (id: string) => {
    setInvites((prev) => prev.filter((invite) => invite.id !== id));
  };

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
          {count === 0 && <p className="notifications-empty">No new notifications</p>}
          {invites.map((invite) => (
            <div key={invite.id} className="notification-card">
              <div className="notification-icon" aria-hidden="true">
                !
              </div>
              <div className="notification-body">
                <p className="notification-title">You have a new hub invite</p>
                <p className="notification-meta">
                  {invite.sender} invited you to {invite.hub} - {invite.timeAgo}
                </p>
              </div>
              <button className="notification-dismiss" type="button" onClick={() => dismissInvite(invite.id)}>
                Dismiss
              </button>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
