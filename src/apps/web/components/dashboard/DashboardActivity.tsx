'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  MagnifyingGlassIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import { listHubs } from '../../lib/api';
import { formatRelativeTime } from '../../lib/utils';

export function DashboardActivity() {
  const [filterQuery, setFilterQuery] = useState('');

  const { data: hubs } = useQuery({
    queryKey: ['hubs'],
    queryFn: listHubs,
  });

  // Build activity items from hub access data (placeholder approach)
  const activityItems = (hubs ?? [])
    .filter((h) => h.last_accessed_at)
    .sort((a, b) => new Date(b.last_accessed_at!).getTime() - new Date(a.last_accessed_at!).getTime())
    .slice(0, 10)
    .map((hub) => ({
      id: hub.id,
      text: `You accessed **${hub.name}**`,
      hubName: hub.name,
      time: hub.last_accessed_at!,
      initial: hub.member_emails?.[0]?.charAt(0).toUpperCase() ?? 'Y',
    }));

  const filtered = filterQuery.trim()
    ? activityItems.filter((item) => item.hubName.toLowerCase().includes(filterQuery.toLowerCase()))
    : activityItems;

  return (
    <div className="dash-activity-page">
      <h1 className="dash-page-title">Activity</h1>
      <p className="dash-page-subtitle">Recent activity across all your hubs.</p>

      <div className="dash-search-bar">
        <MagnifyingGlassIcon className="dash-search-bar-icon" />
        <input
          type="text"
          className="dash-search-bar-input"
          placeholder="Filter activity..."
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
        />
      </div>

      <div className="dash-activity-list dash-activity-list--full">
        {filtered.length > 0 ? (
          filtered.map((item) => (
            <div key={item.id} className="dash-activity-item">
              <div className="dash-activity-avatar">{item.initial}</div>
              <div className="dash-activity-content">
                <p className="dash-activity-text">
                  You accessed <strong>{item.hubName}</strong>
                </p>
                <span className="dash-activity-time">{formatRelativeTime(item.time)}</span>
              </div>
              <CheckIcon className="dash-activity-check" />
            </div>
          ))
        ) : (
          <p className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>
            {filterQuery ? 'No activity matches your filter.' : 'No recent activity yet.'}
          </p>
        )}
      </div>
    </div>
  );
}
