'use client';

// DashboardHome.tsx: Dashboard home tab with recent hubs, reminders, activity, and prompts.

import { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueries } from '@tanstack/react-query';

import {
  MagnifyingGlassIcon,
  RectangleStackIcon,
  SparklesIcon,
  ChatBubbleLeftIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { DocumentIcon, UserIcon } from '@heroicons/react/24/solid';
import { listActivity, listHubs, listReminders, listChatSessions } from '../../lib/api';
import { resolveHubAppearance } from '../../lib/hubAppearance';
import type { ChatSessionSummary } from '@shared/index';
import { useAuth } from '../auth/AuthProvider';
import { describeEventParts, formatRelativeTime, getEventTone } from '../../lib/utils';
import { getEventIcon, buildHubNameMap } from './dashboardUtils';
import { selectDashboardPrompts } from './dashboardPromptRules';
import { ProfileAvatar } from '../profile/ProfileAvatar';
import { DashboardRemindersPanel } from './DashboardRemindersPanel';

function DashboardHomeHubSkeleton({ index }: { index: number }) {
  return (
    <div className="hub-card hub-card--skeleton" aria-hidden="true" data-testid={`dashboard-hub-skeleton-${index}`}>
      <div className="hub-card-top">
        <div className="hub-card-icon dash-skeleton dash-skeleton--hub-icon" />
      </div>
      <div className="dash-skeleton dash-skeleton--hub-title" />
      <div className="dash-skeleton dash-skeleton--hub-description" />
      <div className="dash-skeleton dash-skeleton--hub-description dash-skeleton--hub-description-short" />
      <div className="hub-card-footer">
        <div className="hub-card-stats">
          <span className="hub-stat">
            <span className="dash-skeleton dash-skeleton--hub-stat" />
          </span>
          <span className="hub-stat">
            <span className="dash-skeleton dash-skeleton--hub-stat" />
          </span>
        </div>
        <div className="hub-card-footer-bottom">
          <span className="dash-skeleton dash-skeleton--hub-time" />
          <div className="hub-card-avatars">
            <span className="dash-skeleton dash-skeleton--hub-avatar" />
            <span className="dash-skeleton dash-skeleton--hub-avatar" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardHomeActivitySkeleton({ index }: { index: number }) {
  return (
    <div className="dash-activity-item dash-activity-item--skeleton" aria-hidden="true" data-testid={`dashboard-activity-skeleton-${index}`}>
      <div className="dash-activity-avatar dash-skeleton dash-skeleton--activity-avatar" />
      <div className="dash-activity-content">
        <div className="dash-skeleton dash-skeleton--activity-line" />
        <div className="dash-skeleton dash-skeleton--activity-line dash-skeleton--activity-line-short" />
      </div>
      <span className="dash-skeleton dash-skeleton--activity-time" />
    </div>
  );
}

function DashboardHomePromptSkeleton({ index }: { index: number }) {
  return (
    <div className="dash-prompt-card dash-prompt-card--skeleton" aria-hidden="true" data-testid={`dashboard-prompt-skeleton-${index}`}>
      <div className="dash-skeleton dash-skeleton--prompt-line" />
      <div className="dash-skeleton dash-skeleton--prompt-line dash-skeleton--prompt-line-short" />
      <span className="dash-skeleton dash-skeleton--prompt-badge" />
    </div>
  );
}

export function DashboardHome() {
  const { user } = useAuth();
  const router = useRouter();
  const [heroSearch, setHeroSearch] = useState('');
  const [promptRefreshIndex, setPromptRefreshIndex] = useState(0);

  const { data: hubs, isLoading: hubsLoading } = useQuery({
    queryKey: ['hubs'],
    queryFn: listHubs,
    staleTime: 0,
  });

  // Fetch ALL reminders (no status filter) so suggested prompts can use them
  const { data: reminders, isLoading: remindersLoading } = useQuery({
    queryKey: ['dashboard-reminders'],
    queryFn: () => listReminders({}),
    staleTime: 0,
  });

  const recentHubs = hubs?.slice(0, 2) ?? [];

  const hubNameMap = buildHubNameMap(hubs);

  const searchRef = useRef<HTMLDivElement>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  // Fetch chat sessions for each hub
  const sessionQueries = useQueries({
    queries: (hubs ?? []).map((hub) => ({
      queryKey: ['chat-sessions', hub.id],
      queryFn: () => listChatSessions(hub.id),
      staleTime: 30_000,
    })),
  });

  const allChats = useMemo(() => {
    if (!hubs) return [];
    const chats: (ChatSessionSummary & { hubName: string })[] = [];
    sessionQueries.forEach((q, i) => {
      if (q.data) {
        q.data.forEach((session) => {
          chats.push({ ...session, hubName: hubs[i].name });
        });
      }
    });
    return chats;
  }, [hubs, sessionQueries]);

  const normalizedSearch = heroSearch.trim().toLowerCase();
  const searchWords = normalizedSearch.split(/\s+/).filter(Boolean);

  const hubResults = useMemo(() => {
    if (!searchWords.length || !hubs) return [];
    const scored = hubs.map((h) => {
      const text = `${h.name ?? ''} ${h.description ?? ''}`.toLowerCase();
      const matched = searchWords.filter((w) => text.includes(w)).length;
      return { hub: h, matched };
    }).filter((r) => r.matched > 0);
    scored.sort((a, b) => b.matched - a.matched);
    return scored.map((r) => r.hub).slice(0, 5);
  }, [searchWords.join(' '), hubs]);

  const chatResults = useMemo(() => {
    if (!searchWords.length) return [];
    const scored = allChats.map((c) => {
      const text = `${c.title ?? ''} ${c.hubName ?? ''}`.toLowerCase();
      const matched = searchWords.filter((w) => text.includes(w)).length;
      return { chat: c, matched };
    }).filter((r) => r.matched > 0);
    scored.sort((a, b) => b.matched - a.matched);
    return scored.map((r) => r.chat).slice(0, 5);
  }, [searchWords.join(' '), allChats]);

  const hasResults = hubResults.length > 0 || chatResults.length > 0;
  const showDropdown = searchFocused && searchWords.length > 0;

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const { data: activityEvents, isLoading: activityLoading } = useQuery({
    queryKey: ['dashboard-activity'],
    queryFn: () => listActivity(undefined, 10),
    staleTime: 0,
  });

  const activityItems = activityEvents ?? [];

  const suggestedPrompts = useMemo(
    () => selectDashboardPrompts(hubs, reminders, 2, promptRefreshIndex),
    [hubs, reminders, promptRefreshIndex],
  );
  const promptsLoading = hubsLoading || remindersLoading;

  return (
    <div className="dash-home">
      {/* Hero */}
      <div className="dash-hero">
        <h1 className="dash-hero-title">Discover your knowledge archive.</h1>
        <div className="dash-hero-search-wrap" ref={searchRef}>
          <div className="dash-hero-search-form">
            <MagnifyingGlassIcon className="dash-hero-search-icon" />
            <input
              type="text"
              className="dash-hero-search-input"
              placeholder="Search across all your hubs and chats..."
              value={heroSearch}
              onChange={(e) => setHeroSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)}
            />
          </div>
          {showDropdown && (
            <div className="dash-hero-search-dropdown">
              {hubResults.length > 0 && (
                <div className="dash-hero-search-group">
                  <span className="dash-hero-search-group-label">Hubs</span>
                  {hubResults.map((hub) => (
                    <Link
                      key={hub.id}
                      href={`/hubs/${hub.id}`}
                      className="dash-hero-search-item"
                      onClick={() => setSearchFocused(false)}
                    >
                      <RectangleStackIcon className="dash-hero-search-item-icon" />
                      <div className="dash-hero-search-item-info">
                        <span className="dash-hero-search-item-name">{hub.name}</span>
                        {hub.description && (
                          <span className="dash-hero-search-item-meta">{hub.description}</span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
              {chatResults.length > 0 && (
                <div className="dash-hero-search-group">
                  <span className="dash-hero-search-group-label">Chats</span>
                  {chatResults.map((chat) => (
                    <Link
                      key={chat.id}
                      href={`/hubs/${chat.hub_id}?tab=chat&session=${chat.id}`}
                      className="dash-hero-search-item"
                      onClick={() => setSearchFocused(false)}
                    >
                      <ChatBubbleLeftIcon className="dash-hero-search-item-icon" />
                      <div className="dash-hero-search-item-info">
                        <span className="dash-hero-search-item-name">{chat.title}</span>
                        <span className="dash-hero-search-item-meta">{chat.hubName}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
              {!hasResults && (
                <div className="dash-hero-search-empty">No results found.</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="dash-grid">
        <div className="dash-col-main">
          {/* Recent Hubs */}
          <div className="dash-section">
            <span className="dash-section-label">JUMP BACK IN</span>
            <div className="dash-section-header">
              <h2 className="dash-section-title">Recent Hubs</h2>
              {recentHubs.length > 0 && <Link href="/hubs" className="dash-section-link">View all hubs</Link>}
            </div>
            <div className="dash-recent-hubs">
              {hubsLoading ? (
                Array.from({ length: 2 }, (_, index) => <DashboardHomeHubSkeleton key={index} index={index} />)
              ) : recentHubs.length > 0 ? (
                recentHubs.map((hub) => {
                  const appearance = resolveHubAppearance(hub.icon_key, hub.color_key);
                  const HubIcon = appearance.icon.icon;
                  const memberProfiles = hub.member_profiles ?? [];
                  const memberEmails = hub.member_emails ?? [];
                  const memberCount = memberProfiles.length || memberEmails.length;

                  return (
                    <Link key={hub.id} href={`/hubs/${hub.id}`} className="hub-card">
                      <div className="hub-card-top">
                        <div
                          className="hub-card-icon"
                          style={appearance.badgeStyle}
                          data-testid={`dashboard-hub-icon-${hub.id}`}
                          data-icon-key={appearance.icon.key}
                          data-color-key={appearance.color.key}
                        >
                          <HubIcon />
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
                          {memberCount > 0 && (
                            <div className="hub-card-avatars">
                              {memberProfiles.slice(0, 2).map((member) => (
                                <ProfileAvatar
                                  key={member.user_id}
                                  className="hub-avatar"
                                  profile={member}
                                  title={member.display_name ?? member.email ?? "Profile"}
                                />
                              ))}
                              {memberProfiles.length === 0 && memberEmails.slice(0, 2).map((email, i) => (
                                <ProfileAvatar
                                  key={`${email}-${i}`}
                                  className="hub-avatar"
                                  profile={{ email }}
                                  title={email}
                                />
                              ))}
                              {memberCount > 2 && (
                                <div className="hub-avatar hub-avatar--count">
                                  +{memberCount - 2}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })
              ) : !hubsLoading ? (
                <div className="dash-activity-card">
                  <div className="dash-empty-state">
                    <RectangleStackIcon className="dash-empty-state-icon" />
                    <p className="dash-empty-state-text">Create your first hub to get started</p>
                    <Link href="/hubs" className="dash-empty-state-btn">Go to Hubs</Link>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Recent Activity Feed */}
          <div className="dash-section">
            <div className="dash-section-header">
              <h2 className="dash-section-title">Recent Activity Feed</h2>
              {activityItems.length > 0 && <Link href="/?tab=activity" className="dash-section-link">View all activity</Link>}
            </div>
            <div className="dash-activity-card">
              <div className="dash-activity-list">
                {activityLoading ? (
                  Array.from({ length: 5 }, (_, index) => <DashboardHomeActivitySkeleton key={index} index={index} />)
                ) : activityItems.length > 0 ? (
                  activityItems.slice(0, 5).map((event) => {
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
                  })
                ) : !activityLoading ? (
                  <div className="dash-empty-state">
                    <ChatBubbleLeftIcon className="dash-empty-state-icon" />
                    <p className="dash-empty-state-text">Activity will appear here as you use your hubs</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="dash-col-side">
          {/* Reminders */}
          <DashboardRemindersPanel variant="sidebar" />

          {/* Suggested Prompts */}
          {(promptsLoading || suggestedPrompts.length > 0) && (
            <div className="dash-prompts-section">
              <div className="dash-prompts-header">
                <div className="dash-prompts-heading">
                  <SparklesIcon className="dash-sparkle-icon" />
                  <h3 className="dash-prompts-title">Suggested Caddie Prompts</h3>
                </div>
                <button
                  type="button"
                  className="dash-prompts-refresh"
                  onClick={() => setPromptRefreshIndex((current) => current + 1)}
                  aria-label="Refresh suggested prompts"
                  title="Refresh suggested prompts"
                  disabled={promptsLoading}
                >
                  <ArrowPathIcon className="dash-prompts-refresh-icon" />
                </button>
              </div>
              <div className="dash-prompt-list">
                {promptsLoading ? (
                  Array.from({ length: 2 }, (_, index) => <DashboardHomePromptSkeleton key={index} index={index} />)
                ) : (
                  suggestedPrompts.map((prompt, i) => (
                    <button
                      key={i}
                      className="dash-prompt-card"
                      onClick={() => {
                        if (prompt.hubId) {
                          router.push(`/hubs/${prompt.hubId}?tab=chat&session=new&promptAction=send&prompt=${encodeURIComponent(prompt.text)}`);
                        }
                      }}
                      type="button"
                    >
                      <p className="dash-prompt-text">&ldquo;{prompt.text}&rdquo;</p>
                      <span className="dash-prompt-hub-badge">{hubNameMap.get(prompt.hubId!) ?? 'Hub'}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
