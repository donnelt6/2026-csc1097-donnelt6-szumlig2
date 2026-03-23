'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import {
  MagnifyingGlassIcon,
  RectangleStackIcon,
  DocumentIcon,
  DocumentMinusIcon,
  SparklesIcon,
  UserPlusIcon,
  UserMinusIcon,
  UserIcon,
  BellIcon,
  BellSlashIcon,
  QuestionMarkCircleIcon,
  BookOpenIcon,
  ChatBubbleLeftIcon,
} from '@heroicons/react/24/outline';
import { listActivity, listHubs, listReminders } from '../../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { describeEventParts, formatRelativeTime, getEventTone } from '../../lib/utils';
import { MiniCalendar } from './MiniCalendar';
import type { ActivityEvent } from '../../lib/types';

function getEventIcon(event: ActivityEvent): React.ComponentType<React.SVGProps<SVGSVGElement>> {
  if (event.resource_type === 'source') return event.action === 'deleted' ? DocumentMinusIcon : DocumentIcon;
  if (event.resource_type === 'member') return event.action === 'removed' ? UserMinusIcon : UserPlusIcon;
  if (event.resource_type === 'reminder' && (event.action === 'cancel')) return BellSlashIcon;
  const map: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
    hub: RectangleStackIcon, reminder: BellIcon, faq: QuestionMarkCircleIcon,
    guide: BookOpenIcon, chat: ChatBubbleLeftIcon,
  };
  return map[event.resource_type] || RectangleStackIcon;
}

export function DashboardHome() {
  const { user } = useAuth();
  const router = useRouter();
  const [heroSearch, setHeroSearch] = useState('');

  const now = new Date();
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [calYear, setCalYear] = useState(now.getFullYear());

  const { data: hubs } = useQuery({
    queryKey: ['hubs'],
    queryFn: listHubs,
    staleTime: 0,
  });

  // Fetch ALL reminders (no status filter) so calendar shows everything
  const { data: reminders } = useQuery({
    queryKey: ['dashboard-reminders'],
    queryFn: () => listReminders({}),
    staleTime: 0,
  });

  const recentHubs = hubs?.slice(0, 2) ?? [];

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

  const { data: activityEvents } = useQuery({
    queryKey: ['dashboard-activity'],
    queryFn: () => listActivity(undefined, 10),
    staleTime: 0,
  });

  const activityItems = activityEvents ?? [];

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
              {recentHubs.length > 0 && <Link href="/" className="dash-section-link">View all hubs</Link>}
            </div>
            <div className="dash-recent-hubs">
              {recentHubs.length > 0 ? (
                recentHubs.map((hub) => (
                  <Link key={hub.id} href={`/hubs/${hub.id}`} className="hub-card">
                    <div className="hub-card-top">
                      <div className="hub-card-icon">
                        <RectangleStackIcon />
                      </div>
                    </div>
                    <h3 className="hub-card-title">{hub.name}</h3>
                    <p className="hub-card-description">{hub.description || 'No description'}</p>
                    <div className="hub-card-footer">
                      <div className="hub-card-stats">
                        <span className="hub-stat">
                          <DocumentIcon className="hub-stat-icon" aria-hidden="true" />
                          <span className="hub-stat-value">{hub.sources_count ?? 0} {(hub.sources_count ?? 0) === 1 ? 'Doc' : 'Docs'}</span>
                        </span>
                        <span className="hub-stat">
                          <UserIcon className="hub-stat-icon" aria-hidden="true" />
                          <span className="hub-stat-value">{hub.members_count ?? 0} {(hub.members_count ?? 0) === 1 ? 'Member' : 'Members'}</span>
                        </span>
                      </div>
                      <div className="hub-card-footer-bottom">
                        <span className="hub-card-time">
                          Modified {formatRelativeTime(hub.last_accessed_at)}
                        </span>
                        {(hub.member_emails?.length ?? 0) > 0 && (
                          <div className="hub-card-avatars">
                            {hub.member_emails!.slice(0, 2).map((email, i) => (
                              <div key={i} className="hub-avatar hub-avatar--initials" title={email}>
                                {email.charAt(0).toUpperCase()}
                              </div>
                            ))}
                            {hub.member_emails!.length > 2 && (
                              <div className="hub-avatar hub-avatar--count">
                                +{hub.member_emails!.length - 2}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="dash-activity-card">
                  <div className="dash-empty-state">
                    <RectangleStackIcon className="dash-empty-state-icon" />
                    <p className="dash-empty-state-text">Create your first hub to get started</p>
                    <Link href="/" className="dash-empty-state-btn">Go to Hubs</Link>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Recent Activity Feed */}
          <div className="dash-section">
            <div className="dash-section-header">
              <h2 className="dash-section-title">Recent Activity Feed</h2>
              {activityItems.length > 0 && <Link href="/dashboard?tab=activity" className="dash-section-link">View all activity</Link>}
            </div>
            <div className="dash-activity-card">
              <div className="dash-activity-list">
                {activityItems.length > 0 ? (
                  activityItems.slice(0, 5).map((event) => {
                    const Icon = getEventIcon(event);
                    const tone = getEventTone(event);
                    return (
                      <Link key={event.id} href={`/hubs/${event.hub_id}`} className="dash-activity-item">
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
                  })
                ) : (
                  <div className="dash-empty-state">
                    <ChatBubbleLeftIcon className="dash-empty-state-icon" />
                    <p className="dash-empty-state-text">Activity will appear here as you use your hubs</p>
                  </div>
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
                <div className="dash-empty-state dash-empty-state--compact">
                  <BellIcon className="dash-empty-state-icon" />
                  <p className="dash-empty-state-text">Set up reminders in any hub to see them here</p>
                </div>
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
                    <span className="dash-prompt-hub-badge">{hubNameMap.get(prompt.hubId!) ?? 'Hub'}</span>
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
