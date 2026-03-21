'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  MagnifyingGlassIcon,
  RectangleStackIcon,
  DocumentIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { listHubs } from '../../lib/api';
import { formatRelativeTime } from '../../lib/utils';

export function DashboardSearch() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(initialQuery);

  const { data: hubs } = useQuery({
    queryKey: ['hubs'],
    queryFn: listHubs,
  });

  const normalizedQuery = query.trim().toLowerCase();
  const results = normalizedQuery
    ? hubs?.filter((hub) => {
        const nameMatch = hub.name?.toLowerCase().includes(normalizedQuery);
        const descMatch = hub.description?.toLowerCase().includes(normalizedQuery);
        return nameMatch || descMatch;
      }) ?? []
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
      <p className="dash-page-subtitle">Search across all document hubs, sources, and teams.</p>

      <div className="dash-search-bar">
        <MagnifyingGlassIcon className="dash-search-bar-icon" />
        <input
          type="text"
          className="dash-search-bar-input"
          placeholder="Search hubs..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {normalizedQuery && (
        <div className="dash-search-results">
          <h3 className="dash-search-results-heading">
            Hubs ({results.length})
          </h3>
          {results.length > 0 ? (
            <div className="dash-search-results-list">
              {results.map((hub) => (
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

          <h3 className="dash-search-results-heading dash-search-results-heading--coming-soon">
            Chats <span className="dash-coming-soon-badge">Coming soon</span>
          </h3>
          <h3 className="dash-search-results-heading dash-search-results-heading--coming-soon">
            Sources <span className="dash-coming-soon-badge">Coming soon</span>
          </h3>
        </div>
      )}

      {!normalizedQuery && (
        <div className="dash-search-empty">
          <MagnifyingGlassIcon className="dash-search-empty-icon" />
          <p className="muted">Start typing to search across all your hubs.</p>
        </div>
      )}
    </div>
  );
}
