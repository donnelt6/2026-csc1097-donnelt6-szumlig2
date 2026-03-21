'use client';

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DocumentIcon,
  UserIcon,
  PlusCircleIcon,
  StarIcon as StarOutline,
  EllipsisVerticalIcon,
  RectangleStackIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarSolid } from "@heroicons/react/24/solid";
import { listHubs, toggleHubFavourite } from "../lib/api";
import type { Hub } from "../lib/types";
import type { HubsFilterState } from "./HubsToolbar";

function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return "Never";

  const now = new Date().getTime();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;

  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  const weeks = Math.floor(diffMs / 604800000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return `${weeks}w ago`;
}

interface HubsListProps {
  searchQuery: string;
  filters: HubsFilterState;
  onHubCountChange?: (count: number) => void;
  onCreateHub?: () => void;
}

export function HubsList({ searchQuery, filters, onHubCountChange, onCreateHub }: HubsListProps) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["hubs"],
    queryFn: listHubs,
  });

  const { sortField, sortDirection, selectedRoles, typeTab, statusTab } = filters;

  const toggleFavourite = async (hubId: string, currentState: boolean, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const newState = !currentState;
    queryClient.setQueryData(["hubs"], (oldHubs: typeof data) => {
      if (!oldHubs) return oldHubs;
      return oldHubs.map((h) => h.id === hubId ? { ...h, is_favourite: newState } : h);
    });
    try {
      await toggleHubFavourite(hubId, newState);
    } catch {
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();

  let filteredHubs = data?.filter((hub: Hub) => {
    if (normalizedQuery) {
      const matchesName = hub.name?.toLowerCase().includes(normalizedQuery) ?? false;
      const matchesDescription = hub.description?.toLowerCase().includes(normalizedQuery) ?? false;
      if (!matchesName && !matchesDescription) return false;
    }
    if (selectedRoles.size > 0 && hub.role && !selectedRoles.has(hub.role)) return false;
    if (typeTab === "pinned" && !hub.is_favourite) return false;
    if (typeTab === "shared" && hub.role === "owner") return false;
    // "archived" status tab is placeholder — no hubs to show yet
    if (statusTab === "archived") return false;
    return true;
  });

  if (filteredHubs) {
    filteredHubs = [...filteredHubs].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "accessed": {
          const aTime = a.last_accessed_at ? new Date(a.last_accessed_at).getTime() : 0;
          const bTime = b.last_accessed_at ? new Date(b.last_accessed_at).getTime() : 0;
          comparison = bTime - aTime;
          break;
        }
        case "name": {
          comparison = (a.name ?? "").localeCompare(b.name ?? "");
          break;
        }
        case "members": {
          comparison = (b.members_count ?? 0) - (a.members_count ?? 0);
          break;
        }
        case "sources": {
          comparison = (b.sources_count ?? 0) - (a.sources_count ?? 0);
          break;
        }
      }
      return sortDirection === "desc" ? comparison : -comparison;
    });
  }

  const hubCount = filteredHubs?.length ?? 0;
  const [currentPage, setCurrentPage] = useState(1);
  const gridSlots = 8;
  const firstPageHubs = gridSlots - 1;
  const totalPages = hubCount <= firstPageHubs ? 1 : 1 + Math.ceil((hubCount - firstPageHubs) / gridSlots);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filters.typeTab, filters.statusTab, filters.sortField, filters.sortDirection, filters.selectedRoles]);

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedHubs = currentPage === 1
    ? filteredHubs?.slice(0, firstPageHubs)
    : filteredHubs?.slice(firstPageHubs + (currentPage - 2) * gridSlots, firstPageHubs + (currentPage - 1) * gridSlots);

  useEffect(() => {
    onHubCountChange?.(hubCount);
  }, [hubCount, onHubCountChange]);

  return (
    <div className="hubs-list-container">
      {isLoading && <p className="muted">Loading hubs...</p>}
      {error && <p className="muted">Failed to load hubs: {(error as Error).message}</p>}

      <div className="hubs-grid hubs-grid--4col">
        {currentPage === 1 && (
          <button className="hub-card hub-card--create" onClick={onCreateHub} type="button">
            <div className="hub-card-create-icon">
              <PlusCircleIcon />
            </div>
            <h3 className="hub-card-create-title">Create New Hub</h3>
            <p className="hub-card-create-desc">Initialize a new secure documentation environment</p>
          </button>
        )}

        {paginatedHubs?.map((hub: Hub) => (
          <Link key={hub.id} href={`/hubs/${hub.id}`} className="hub-card">
            <div className="hub-card-top">
              <div className="hub-card-icon">
                <RectangleStackIcon />
              </div>
              <div className="hub-card-actions">
                <button
                  onClick={(e) => toggleFavourite(hub.id, hub.is_favourite ?? false, e)}
                  className="hub-favourite-button"
                  aria-label={hub.is_favourite ? "Remove from favourites" : "Add to favourites"}
                >
                  {hub.is_favourite ? (
                    <StarSolid className="hub-favourite-icon filled" />
                  ) : (
                    <StarOutline className="hub-favourite-icon" />
                  )}
                </button>
                <button
                  className="hub-menu-button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  aria-label="Hub options"
                >
                  <EllipsisVerticalIcon className="hub-menu-icon" />
                </button>
              </div>
            </div>

            <h3 className="hub-card-title">{hub.name}</h3>
            <p className="hub-card-description">{hub.description || "No description"}</p>

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
        ))}
      </div>

      {!isLoading && filteredHubs?.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <p className="muted">No hubs found. Create your first hub to get started.</p>
        </div>
      )}

      <div className="hubs-pagination" style={totalPages <= 1 ? { visibility: 'hidden' } : undefined}>
          <p className="hubs-pagination-info">
            Showing {currentPage === 1 ? 1 : firstPageHubs + (currentPage - 2) * gridSlots + 1}–{Math.min(currentPage === 1 ? firstPageHubs : firstPageHubs + (currentPage - 1) * gridSlots, hubCount)} of {hubCount} Hubs
          </p>
          <div className="hubs-pagination-buttons">
            <button
              className="hubs-pagination-arrow"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeftIcon className="hubs-pagination-arrow-icon" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                className={`hubs-pagination-page ${page === currentPage ? 'hubs-pagination-page--active' : ''}`}
                onClick={() => setCurrentPage(page)}
              >
                {page}
              </button>
            ))}
            <button
              className="hubs-pagination-arrow"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <ChevronRightIcon className="hubs-pagination-arrow-icon" />
            </button>
          </div>
      </div>
    </div>
  );
}
