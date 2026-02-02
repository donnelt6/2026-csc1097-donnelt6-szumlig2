'use client';

import { useEffect } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserIcon, UsersIcon, UserGroupIcon, DocumentIcon, StarIcon as StarOutline, RectangleStackIcon } from "@heroicons/react/24/outline";
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
}

export function HubsList({ searchQuery, filters, onHubCountChange }: HubsListProps) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["hubs"],
    queryFn: listHubs,
  });

  const {
    sortField,
    sortDirection,
    selectedRoles,
    minMembers,
    maxMembers,
    minSources,
    maxSources,
    showOnlyFavourites,
  } = filters;

  const toggleFavourite = async (hubId: string, currentState: boolean, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const newState = !currentState;

    queryClient.setQueryData(["hubs"], (oldHubs: typeof data) => {
      if (!oldHubs) return oldHubs;
      return oldHubs.map((h) =>
        h.id === hubId ? { ...h, is_favourite: newState } : h
      );
    });

    try {
      await toggleHubFavourite(hubId, newState);
    } catch (error) {
      console.error("Failed to toggle favourite:", error);
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const minMembersNum = minMembers ? parseInt(minMembers, 10) : null;
  const maxMembersNum = maxMembers ? parseInt(maxMembers, 10) : null;
  const minSourcesNum = minSources ? parseInt(minSources, 10) : null;
  const maxSourcesNum = maxSources ? parseInt(maxSources, 10) : null;

  let filteredHubs = data?.filter((hub: Hub) => {
    if (normalizedQuery) {
      const matchesName = hub.name?.toLowerCase().includes(normalizedQuery) ?? false;
      const matchesDescription = hub.description?.toLowerCase().includes(normalizedQuery) ?? false;
      if (!matchesName && !matchesDescription) return false;
    }

    if (selectedRoles.size > 0 && hub.role && !selectedRoles.has(hub.role)) {
      return false;
    }

    const memberCount = hub.members_count ?? 0;
    if (minMembersNum !== null && memberCount < minMembersNum) return false;
    if (maxMembersNum !== null && memberCount > maxMembersNum) return false;

    const sourceCount = hub.sources_count ?? 0;
    if (minSourcesNum !== null && sourceCount < minSourcesNum) return false;
    if (maxSourcesNum !== null && sourceCount > maxSourcesNum) return false;

    if (showOnlyFavourites && !hub.is_favourite) {
      return false;
    }

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
        case "members": {
          const aMembers = a.members_count ?? 0;
          const bMembers = b.members_count ?? 0;
          comparison = bMembers - aMembers;
          break;
        }
        case "sources": {
          const aSources = a.sources_count ?? 0;
          const bSources = b.sources_count ?? 0;
          comparison = bSources - aSources;
          break;
        }
      }

      return sortDirection === "desc" ? comparison : -comparison;
    });
  }

  const hubCount = filteredHubs?.length ?? 0;

  // Notify parent of hub count changes
  useEffect(() => {
    onHubCountChange?.(hubCount);
  }, [hubCount, onHubCountChange]);

  return (
    <div>
      {isLoading && <p className="muted">Loading hubs...</p>}
      {error && <p className="muted">Failed to load hubs: {(error as Error).message}</p>}

      <div className="hubs-grid">
        {filteredHubs?.map((hub: Hub) => (
          <Link key={hub.id} href={`/hubs/${hub.id}`} className="hub-card">
            <div className="hub-card-header">
              <div className="hub-card-icon">
                <RectangleStackIcon />
              </div>
              <div className="hub-card-title-row">
                <div>
                  <h3 className="hub-card-title">{hub.name}</h3>
                  <p className="hub-card-description">{hub.description || "No description"}</p>
                </div>
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
              </div>
            </div>
            <div className="hub-card-footer">
              <div className="hub-card-stats">
                <span className="hub-stat" aria-label={`${hub.members_count ?? 0} members`}>
                  {(hub.members_count ?? 0) === 1 ? (
                    <UserIcon className="hub-stat-icon" aria-hidden="true" />
                  ) : (hub.members_count ?? 0) <= 4 ? (
                    <UsersIcon className="hub-stat-icon" aria-hidden="true" />
                  ) : (
                    <UserGroupIcon className="hub-stat-icon" aria-hidden="true" />
                  )}
                  <span className="hub-stat-value">{hub.members_count ?? 0}</span>
                </span>
                <span className="hub-stat" aria-label={`${hub.sources_count ?? 0} sources`}>
                  <DocumentIcon className="hub-stat-icon" aria-hidden="true" />
                  <span className="hub-stat-value">{hub.sources_count ?? 0}</span>
                </span>
              </div>
              <span className="hub-card-time" aria-label={`Last accessed ${formatRelativeTime(hub.last_accessed_at)}`}>
                {formatRelativeTime(hub.last_accessed_at)}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {!isLoading && filteredHubs?.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <p className="muted">No hubs found. Create your first hub to get started.</p>
        </div>
      )}
    </div>
  );
}
