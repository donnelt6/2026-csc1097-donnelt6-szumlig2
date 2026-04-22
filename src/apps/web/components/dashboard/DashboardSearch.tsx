'use client';

// DashboardSearch.tsx: Dashboard search tab for finding hubs, sources, and content.

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueries } from '@tanstack/react-query';
import {
  MagnifyingGlassIcon,
  RectangleStackIcon,
  ChatBubbleLeftIcon,
  DocumentIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { listHubs, listChatSessions } from '../../lib/api';
import { formatRelativeTime } from '../../lib/utils';
import type { ChatSessionSummary } from '@shared/index';

interface ChatResult extends ChatSessionSummary {
  hubName: string;
}

export function DashboardSearch() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('search') ?? '';
  const [query, setQuery] = useState(initialQuery);

  const { data: hubs } = useQuery({
    queryKey: ['hubs'],
    queryFn: listHubs,
  });

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
    const chats: ChatResult[] = [];
    sessionQueries.forEach((q, i) => {
      if (q.data) {
        q.data.forEach((session) => {
          chats.push({ ...session, hubName: hubs[i].name });
        });
      }
    });
    return chats;
  }, [hubs, sessionQueries]);

  const chatsLoading = sessionQueries.some((q) => q.isLoading);

  const normalizedQuery = query.trim().toLowerCase();

  const hubResults = normalizedQuery
    ? hubs?.filter((hub) => {
        const nameMatch = hub.name?.toLowerCase().includes(normalizedQuery);
        const descMatch = hub.description?.toLowerCase().includes(normalizedQuery);
        return nameMatch || descMatch;
      }) ?? []
    : [];

  const chatResults = normalizedQuery
    ? allChats.filter((chat) =>
        chat.title?.toLowerCase().includes(normalizedQuery)
      )
    : [];

  const highlightMatch = (text: string) => {
    if (!normalizedQuery || !text) return text;
    const idx = text.toLowerCase().indexOf(normalizedQuery);
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="dash-search-highlight">{text.slice(idx, idx + normalizedQuery.length)}</mark>
        {text.slice(idx + normalizedQuery.length)}
      </>
    );
  };

  return (
    <div className="dash-search-page">
      <h1 className="dash-page-title">Search</h1>
      <p className="dash-page-subtitle">Search across your hubs and conversations.</p>

      <div className="dash-search-bar">
        <MagnifyingGlassIcon className="dash-search-bar-icon" />
        <input
          type="text"
          className="dash-search-bar-input"
          placeholder="Search hubs and chats..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {normalizedQuery && (
        <div className="dash-search-results">
          <h3 className="dash-search-results-heading">
            Hubs ({hubResults.length})
          </h3>
          {hubResults.length > 0 ? (
            <div className="dash-search-results-list">
              {hubResults.map((hub) => (
                <Link key={hub.id} href={`/hubs/${hub.id}`} className="dash-search-result-card">
                  <div className="dash-search-result-icon">
                    <RectangleStackIcon />
                  </div>
                  <div className="dash-search-result-info">
                    <h4 className="dash-search-result-name">{highlightMatch(hub.name)}</h4>
                    {hub.description && (
                      <p className="dash-search-result-desc">{highlightMatch(hub.description)}</p>
                    )}
                    <div className="dash-search-result-meta">
                      <span>
                        <DocumentIcon className="dash-search-result-meta-icon" />
                        {hub.sources_count ?? 0} Docs
                      </span>
                      <span>
                        <UserIcon className="dash-search-result-meta-icon" />
                        {hub.members_count ?? 0} Members
                      </span>
                      <span>Updated {formatRelativeTime(hub.last_accessed_at)}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted">No hubs match your search.</p>
          )}

          <h3 className="dash-search-results-heading">
            Chats ({chatsLoading ? '...' : chatResults.length})
          </h3>
          {chatResults.length > 0 ? (
            <div className="dash-search-results-list">
              {chatResults.map((chat) => (
                <Link
                  key={chat.id}
                  href={`/hubs/${chat.hub_id}?tab=chat&session=${chat.id}`}
                  className="dash-search-result-card"
                >
                  <div className="dash-search-result-icon">
                    <ChatBubbleLeftIcon />
                  </div>
                  <div className="dash-search-result-info">
                    <h4 className="dash-search-result-name">{highlightMatch(chat.title)}</h4>
                    <div className="dash-search-result-meta">
                      <span>
                        <RectangleStackIcon className="dash-search-result-meta-icon" />
                        {chat.hubName}
                      </span>
                      <span>{formatRelativeTime(chat.last_message_at)}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : !chatsLoading ? (
            <p className="muted">No chats match your search.</p>
          ) : (
            <p className="muted">Loading chats...</p>
          )}
        </div>
      )}

      {!normalizedQuery && (
        <div className="dash-search-empty">
          <MagnifyingGlassIcon className="dash-search-empty-icon" />
          <p className="muted">Start typing to search across your hubs and chats.</p>
        </div>
      )}
    </div>
  );
}
