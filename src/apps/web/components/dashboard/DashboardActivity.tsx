'use client';

// DashboardActivity.tsx: Global activity feed tab showing recent events across all hubs.

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { listActivity, listHubs } from '../../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { describeEventParts, formatRelativeTime, getEventTone, getTimeGroup } from '../../lib/utils';
import { HubDropdown } from './HubDropdown';
import { getEventIcon, buildHubNameMap } from './dashboardUtils';
import type { ActivityEvent } from '@shared/index';

const TIME_GROUP_ORDER = ['Today', 'Yesterday', 'This Week', 'Earlier'];

export function DashboardActivity() {
  const { user } = useAuth();
  const [filterQuery, setFilterQuery] = useState('');
  const [hubFilter, setHubFilter] = useState('');

  const { data: hubs } = useQuery({
    queryKey: ['hubs'],
    queryFn: listHubs,
    staleTime: 0,
  });

  const { data: activityEvents, isLoading } = useQuery({
    queryKey: ['activity', hubFilter],
    queryFn: () => listActivity(hubFilter || undefined, 50),
    staleTime: 0,
  });

  const hubNameMap = buildHubNameMap(hubs);

  const items = activityEvents ?? [];
  const filtered = filterQuery.trim()
    ? items.filter((event) => {
        const { action, subject } = describeEventParts(event, user?.id);
        const text = `${action} ${subject}`.toLowerCase();
        const hubName = (hubNameMap.get(event.hub_id) ?? '').toLowerCase();
        const q = filterQuery.toLowerCase();
        return text.includes(q) || hubName.includes(q);
      })
    : items;

  // Group by time
  const groups = new Map<string, ActivityEvent[]>();
  for (const event of filtered) {
    const group = getTimeGroup(event.created_at);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(event);
  }

  return (
    <div className="dash-activity-page">
      <h1 className="dash-page-title">Activity</h1>
      <p className="dash-page-subtitle">Recent activity across all your hubs.</p>

      <div className="dash-activity-toolbar">
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
        <HubDropdown
          hubs={hubs ?? []}
          value={hubFilter}
          onChange={setHubFilter}
          allOption="All Hubs"
        />
      </div>

      <div className="dash-activity-card">
        <div className="dash-activity-list dash-activity-list--full">
          {filtered.length > 0 ? (
            TIME_GROUP_ORDER.filter((g) => groups.has(g)).map((group) => (
              <div key={group}>
                <h3 className="dash-activity-group-label">{group}</h3>
                {groups.get(group)!.map((event) => {
                  const Icon = getEventIcon(event);
                  const tone = getEventTone(event);
                  const tabMap: Record<string, string> = {
                    reminder: '?tab=dashboard&dashTab=reminders',
                    faq: '?tab=dashboard&dashTab=faqs',
                    guide: '?tab=dashboard&dashTab=guides',
                    source: '?tab=sources',
                    member: '?tab=members',
                    chat: '?tab=chat',
                  };
                  const suffix = tabMap[event.resource_type] ?? '';
                  return (
                    <Link key={event.id} href={`/hubs/${event.hub_id}${suffix}`} className="dash-activity-item">
                      <div className={`dash-activity-avatar${tone !== 'neutral' ? ` dash-activity-avatar--${tone}` : ''}`}>
                        <Icon className="dash-activity-type-icon" />
                      </div>
                      <div className="dash-activity-content">
                        <p className="dash-activity-text">
                          {(() => { const { action, subject } = describeEventParts(event, user?.id); return <>{action}{subject && <> <strong>{subject}</strong></>}</>; })()}
                        </p>
                        <p className="dash-activity-hub">{hubNameMap.get(event.hub_id) ?? 'Hub'}</p>
                      </div>
                      <span className="dash-activity-time">{formatRelativeTime(event.created_at)}</span>
                    </Link>
                  );
                })}
              </div>
            ))
          ) : (
            <p className="dash-activity-empty">
              {isLoading ? 'Loading activity...' : filterQuery || hubFilter ? 'No activity matches your filter.' : 'No recent activity yet.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
