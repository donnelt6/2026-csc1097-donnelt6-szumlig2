'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import {
  MagnifyingGlassIcon,
  RectangleStackIcon,
  DocumentIcon,
  FunnelIcon,
  CheckIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { listHubs, listReminders } from '../../lib/api';
import { formatRelativeTime } from '../../lib/utils';
import { MiniCalendar } from './MiniCalendar';

export function DashboardHome() {
  const router = useRouter();
  const [heroSearch, setHeroSearch] = useState('');

  const now = new Date();
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [calYear, setCalYear] = useState(now.getFullYear());

  const { data: hubs } = useQuery({
    queryKey: ['hubs'],
    queryFn: listHubs,
  });

  // Fetch ALL reminders (no status filter) so calendar shows everything
  const { data: reminders } = useQuery({
    queryKey: ['dashboard-reminders'],
    queryFn: () => listReminders({}),
  });

  const recentHubs = hubs?.slice(0, 4) ?? [];

  const hubNameMap = new Map<string, string>();
  hubs?.forEach((h) => hubNameMap.set(h.id, h.name));

  // Reminders for the selected calendar month
  const monthReminders = reminders?.filter((r) => {
    const d = new Date(r.due_at);
    return d.getMonth() === calMonth && d.getFullYear() === calYear;
  }) ?? [];

  const reminderDays = new Set(monthReminders.map((r) => new Date(r.due_at).getDate()));

  // Show closest reminders (upcoming first, then recent past)
  const sortedReminders = [...(reminders ?? [])].sort((a, b) => {
    const aTime = Math.abs(new Date(a.due_at).getTime() - Date.now());
    const bTime = Math.abs(new Date(b.due_at).getTime() - Date.now());
    return aTime - bTime;
  });
  const closestReminders = sortedReminders.slice(0, 4);

  const handleHeroSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (heroSearch.trim()) {
      router.push(`/?search=${encodeURIComponent(heroSearch.trim())}`);
    }
  };

  // Build activity items from all hubs with last_accessed_at
  const activityItems = (hubs ?? [])
    .filter((h) => h.last_accessed_at)
    .sort((a, b) => new Date(b.last_accessed_at!).getTime() - new Date(a.last_accessed_at!).getTime())
    .slice(0, 5);

  // Suggested prompts
  const suggestedPrompts = [
    {
      text: 'Summarize the key takeaways from your most recent documents',
      hubId: recentHubs[0]?.id,
    },
    {
      text: 'What are the main action items across your hubs?',
      hubId: recentHubs[1]?.id ?? recentHubs[0]?.id,
    },
  ].filter((p) => p.hubId);

  return (
    <div className="dash-home">
      {/* Hero */}
      <div className="dash-hero">
        <h1 className="dash-hero-title">Discover your knowledge archive.</h1>
        <form className="dash-hero-search-form" onSubmit={handleHeroSearch}>
          <MagnifyingGlassIcon className="dash-hero-search-icon" />
          <input
            type="text"
            className="dash-hero-search-input"
            placeholder="Search across all document hubs, sources, and teams..."
            value={heroSearch}
            onChange={(e) => setHeroSearch(e.target.value)}
          />
        </form>
      </div>

      {/* Two-column layout */}
      <div className="dash-grid">
        <div className="dash-col-main">
          {/* Recent Hubs */}
          <div className="dash-section">
            <span className="dash-section-label">JUMP BACK IN</span>
            <div className="dash-section-header">
              <h2 className="dash-section-title">Recent Hubs</h2>
              <Link href="/" className="dash-section-link">View all hubs</Link>
            </div>
            <div className="dash-recent-hubs">
              {recentHubs.map((hub) => (
                <Link key={hub.id} href={`/hubs/${hub.id}`} className="dash-hub-card">
                  <div className="dash-hub-card-icon">
                    <RectangleStackIcon />
                  </div>
                  <div className="dash-hub-card-info">
                    <div className="dash-hub-card-top-row">
                      <h3 className="dash-hub-card-name">{hub.name}</h3>
                      {(hub.member_emails?.length ?? 0) > 0 && (
                        <div className="dash-hub-card-avatars">
                          {hub.member_emails!.slice(0, 3).map((email, i) => (
                            <div key={i} className="hub-avatar hub-avatar--initials" title={email}>
                              {email.charAt(0).toUpperCase()}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="dash-hub-card-bottom-row">
                      <span className="dash-hub-card-badge">
                        <DocumentIcon className="dash-hub-card-badge-icon" />
                        {hub.sources_count ?? 0} DOCS
                      </span>
                      <span className="dash-hub-card-time">
                        Updated {formatRelativeTime(hub.last_accessed_at)}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Recent Activity Feed */}
          <div className="dash-section">
            <div className="dash-section-header">
              <h2 className="dash-section-title">Recent Activity Feed</h2>
              <button className="dash-filter-btn" type="button" aria-label="Filter activity">
                <FunnelIcon className="dash-filter-icon" />
              </button>
            </div>
            <div className="dash-activity-card">
              <div className="dash-activity-list">
                {activityItems.length > 0 ? (
                  activityItems.map((hub) => (
                    <Link key={hub.id} href={`/hubs/${hub.id}`} className="dash-activity-item">
                      <div className="dash-activity-avatar">
                        {hub.member_emails?.[0]?.charAt(0).toUpperCase() ?? hub.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="dash-activity-content">
                        <p className="dash-activity-text">
                          You accessed <strong>{hub.name}</strong>
                        </p>
                      </div>
                      <span className="dash-activity-time">{formatRelativeTime(hub.last_accessed_at)}</span>
                      <CheckIcon className="dash-activity-check" />
                    </Link>
                  ))
                ) : (
                  <p className="muted" style={{ padding: '16px 0' }}>No recent activity yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="dash-col-side">
          {/* Reminders */}
          <div className="dash-reminders-card">
            <h2 className="dash-reminders-title">Reminders</h2>
            <MiniCalendar
                month={calMonth}
                year={calYear}
                onMonthChange={(m, y) => { setCalMonth(m); setCalYear(y); }}
                reminderDays={reminderDays}
              />
              {closestReminders.length > 0 && (
                <>
                  <hr className="dash-reminders-divider" />
                  <div className="dash-reminder-list">
                    {closestReminders.map((r) => {
                      const dueDate = new Date(r.due_at);
                      return (
                        <Link key={r.id} href={`/hubs/${r.hub_id}`} className="dash-reminder-item">
                          <div className={`dash-reminder-dot-wrap dash-reminder-dot-wrap--${r.status}`}>
                            <span className="dash-reminder-dot-inner" />
                          </div>
                          <div className="dash-reminder-info">
                            <p className="dash-reminder-title">{r.message || 'Reminder'}</p>
                            <p className="dash-reminder-meta">
                              {hubNameMap.get(r.hub_id) ?? 'Hub'} &middot; {dueDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} &middot; {dueDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                            </p>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </>
              )}
              {closestReminders.length === 0 && (
                <p className="muted" style={{ padding: '12px 0 0', fontSize: '0.8rem' }}>No reminders yet.</p>
              )}
          </div>

          {/* Suggested Prompts */}
          {suggestedPrompts.length > 0 && (
            <div className="dash-prompts-section">
              <div className="dash-prompts-header">
                <SparklesIcon className="dash-sparkle-icon" />
                <h3 className="dash-prompts-title">Suggested Caddie Prompts</h3>
              </div>
              <div className="dash-prompt-list">
                {suggestedPrompts.map((prompt, i) => (
                  <button
                    key={i}
                    className="dash-prompt-card"
                    onClick={() => {
                      if (prompt.hubId) {
                        router.push(`/hubs/${prompt.hubId}?tab=chat&prompt=${encodeURIComponent(prompt.text)}`);
                      }
                    }}
                    type="button"
                  >
                    <p className="dash-prompt-text">&ldquo;{prompt.text}&rdquo;</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
