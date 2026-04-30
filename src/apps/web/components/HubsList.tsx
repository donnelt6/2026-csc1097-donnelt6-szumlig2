'use client';

// HubsList.tsx: Hub card grid with search filtering, sorting, and pagination.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PlusCircleIcon,
  StarIcon as StarOutline,
  EllipsisVerticalIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SwatchIcon,
  ArchiveBoxIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { DocumentIcon, StarIcon as StarSolid, UserIcon } from "@heroicons/react/24/solid";
import { archiveHub, listHubs, removeMember, toggleHubFavourite, unarchiveHub, updateHub } from "../lib/api";
import {
  DEFAULT_HUB_COLOR_KEY,
  DEFAULT_HUB_ICON_KEY,
  resolveHubAppearance,
  type HubColorKey,
  type HubIconKey,
} from "../lib/hubAppearance";
import type { Hub } from "@shared/index";
import { formatRelativeTime } from "../lib/utils";
import type { HubsFilterState } from "./HubsToolbar";
import { useAuth } from "./auth/AuthProvider";
import { HubAppearanceModal } from "./HubAppearanceModal";
import { ProfileAvatar } from "./profile/ProfileAvatar";

interface HubsListProps {
  searchQuery: string;
  filters: HubsFilterState;
  onHubCountChange?: (count: number) => void;
  onPaginationVisibleChange?: (visible: boolean) => void;
  onCreateHub?: () => void;
}

export function HubsList({ searchQuery, filters, onHubCountChange, onPaginationVisibleChange, onCreateHub }: HubsListProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingHub, setEditingHub] = useState<Hub | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editIconKey, setEditIconKey] = useState<HubIconKey>(DEFAULT_HUB_ICON_KEY);
  const [editColorKey, setEditColorKey] = useState<HubColorKey>(DEFAULT_HUB_COLOR_KEY);
  const { data, isLoading, error } = useQuery({
    queryKey: ["hubs"],
    queryFn: listHubs,
  });
  const updateAppearanceMutation = useMutation({
    mutationFn: (payload: { hubId: string; name: string; description: string; icon_key: string; color_key: string }) =>
      updateHub(payload.hubId, {
        name: payload.name,
        description: payload.description,
        icon_key: payload.icon_key,
        color_key: payload.color_key,
      }),
    onMutate: () => {
      setMutationError(null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
      setEditingHub(null);
      setMutationError(null);
    },
    onError: (error) => {
      setMutationError(`Failed to save hub changes: ${(error as Error).message}`);
    },
  });
  const archiveHubMutation = useMutation({
    mutationFn: (hubId: string) => archiveHub(hubId),
    onMutate: async (hubId: string) => {
      setMutationError(null);
      await queryClient.cancelQueries({ queryKey: ["hubs"] });
      const previousHubs = queryClient.getQueryData<Hub[]>(["hubs"]) ?? [];
      const archivedAt = new Date().toISOString();
      queryClient.setQueryData<Hub[]>(["hubs"], (current = []) =>
        current.map((hub) => (hub.id === hubId ? { ...hub, archived_at: archivedAt } : hub))
      );
      setOpenMenuId(null);
      return { previousHubs };
    },
    onError: (_error, _hubId, context) => {
      if (context?.previousHubs) {
        queryClient.setQueryData(["hubs"], context.previousHubs);
      }
      setMutationError(`Failed to archive hub: ${(_error as Error).message}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
    },
  });
  const unarchiveHubMutation = useMutation({
    mutationFn: (hubId: string) => unarchiveHub(hubId),
    onMutate: async (hubId: string) => {
      setMutationError(null);
      await queryClient.cancelQueries({ queryKey: ["hubs"] });
      const previousHubs = queryClient.getQueryData<Hub[]>(["hubs"]) ?? [];
      queryClient.setQueryData<Hub[]>(["hubs"], (current = []) =>
        current.map((hub) => (hub.id === hubId ? { ...hub, archived_at: null } : hub))
      );
      setOpenMenuId(null);
      return { previousHubs };
    },
    onError: (_error, _hubId, context) => {
      if (context?.previousHubs) {
        queryClient.setQueryData(["hubs"], context.previousHubs);
      }
      setMutationError(`Failed to unarchive hub: ${(_error as Error).message}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
    },
  });
  const leaveHubMutation = useMutation({
    mutationFn: (payload: { hubId: string; userId: string }) => removeMember(payload.hubId, payload.userId),
    onMutate: async ({ hubId }) => {
      setMutationError(null);
      await queryClient.cancelQueries({ queryKey: ["hubs"] });
      const previousHubs = queryClient.getQueryData<Hub[]>(["hubs"]) ?? [];
      queryClient.setQueryData<Hub[]>(["hubs"], (current = []) => current.filter((hub) => hub.id !== hubId));
      setOpenMenuId(null);
      return { previousHubs };
    },
    onError: (_error, _payload, context) => {
      if (context?.previousHubs) {
        queryClient.setQueryData(["hubs"], context.previousHubs);
      }
      setMutationError(`Failed to leave hub: ${(_error as Error).message}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
    },
  });

  const { sortField, sortDirection, selectedRoles, typeTab, statusTab } = filters;

  const toggleFavourite = async (hubId: string, currentState: boolean, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const currentHubs = queryClient.getQueryData<Hub[]>(["hubs"]) ?? [];
    const targetHub = currentHubs.find((hub) => hub.id === hubId);
    if (hubId.startsWith("temp-hub-") || targetHub?._isPendingClientSync) return;
    const newState = !currentState;
    await queryClient.cancelQueries({ queryKey: ["hubs"] });
    queryClient.setQueryData(["hubs"], (oldHubs: typeof data) => {
      if (!oldHubs) return oldHubs;
      return oldHubs.map((h) => h.id === hubId ? { ...h, is_favourite: newState } : h);
    });
    try {
      await toggleHubFavourite(hubId, newState);
    } catch {
      // revert on failure
    }
    queryClient.invalidateQueries({ queryKey: ["hubs"] });
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
    if (statusTab === "active" && hub.archived_at) return false;
    if (statusTab === "archived" && !hub.archived_at) return false;
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

  useEffect(() => {
    onPaginationVisibleChange?.(totalPages > 1);
  }, [onPaginationVisibleChange, totalPages]);

  useEffect(() => {
    const handleWindowClick = () => setOpenMenuId(null);
    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  const openAppearanceEditor = (hub: Hub, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setOpenMenuId(null);
    setMutationError(null);
    setEditingHub(hub);
    setEditName(hub.name ?? "");
    setEditDescription(hub.description ?? "");
    setEditIconKey((hub.icon_key as HubIconKey | null) ?? DEFAULT_HUB_ICON_KEY);
    setEditColorKey((hub.color_key as HubColorKey | null) ?? DEFAULT_HUB_COLOR_KEY);
  };

  const closeAppearanceEditor = () => {
    setEditingHub(null);
    setMutationError(null);
  };

  const submitAppearanceUpdate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingHub) return;
    const trimmedName = editName.trim();
    if (!trimmedName) {
      setMutationError("Hub name cannot be blank.");
      return;
    }
    updateAppearanceMutation.mutate({
      hubId: editingHub.id,
      name: trimmedName,
      description: editDescription.trim(),
      icon_key: editIconKey,
      color_key: editColorKey,
    });
  };

  const toggleArchiveHub = (hub: Hub, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const isArchived = Boolean(hub.archived_at);
    const confirmed = window.confirm(
      isArchived
        ? `Unarchive "${hub.name}"? It will appear in Active again.`
        : `Archive "${hub.name}"? You can still view it in Archived.`
    );
    if (!confirmed) return;
    if (isArchived) {
      unarchiveHubMutation.mutate(hub.id);
      return;
    }
    archiveHubMutation.mutate(hub.id);
  };

  const leaveHub = (hub: Hub, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!user?.id) {
      setMutationError("Failed to leave hub: You must be signed in to continue.");
      setOpenMenuId(null);
      return;
    }
    const confirmed = window.confirm("Leave this hub? You will lose access until another member invites you back.");
    if (!confirmed) return;
    leaveHubMutation.mutate({ hubId: hub.id, userId: user.id });
  };

  return (
    <>
    <div className="hubs-list-container">
      {isLoading && <p className="muted">Loading hubs...</p>}
      {error && <p className="muted">Failed to load hubs: {(error as Error).message}</p>}
      {mutationError && <p className="muted" role="alert">{mutationError}</p>}

      <div className="hubs-grid hubs-grid--4col">
        {currentPage === 1 && (
          <button className="hub-card hub-card--create" onClick={onCreateHub} type="button">
            <div className="hub-card-create-icon">
              <PlusCircleIcon />
            </div>
            <h3 className="hub-card-create-title">Create New Hub</h3>
            <p className="hub-card-create-desc">Set up a new space for your documentation.</p>
          </button>
        )}

        {paginatedHubs?.map((hub: Hub) => {
          const appearance = resolveHubAppearance(hub.icon_key, hub.color_key);
          const HubIcon = appearance.icon.icon;
          const canEditAppearance = hub.role === "owner" || hub.role === "admin";
          const canArchiveHub = hub.role === "owner";
          const canLeaveHub = !!user?.id && hub.role !== "owner";
          const canOpenMenu = canEditAppearance || canArchiveHub || canLeaveHub;
          const isPendingHub = hub.id.startsWith("temp-hub-") || hub._isPendingClientSync;
          const memberProfiles = hub.member_profiles ?? [];
          const memberEmails = hub.member_emails ?? [];
          const memberCount = memberProfiles.length || memberEmails.length;
          return (
          <Link
            key={hub.id}
            href={`/hubs/${hub.id}`}
            className="hub-card hub-card--with-accent"
            style={{ "--hub-card-accent": appearance.color.value } as CSSProperties}
          >
            <div className="hub-card-top">
              <div className="hub-card-heading-flow">
                <div
                  className="hub-card-icon"
                  style={appearance.badgeStyle}
                  data-testid={`hub-icon-${hub.id}`}
                  data-icon-key={appearance.icon.key}
                  data-color-key={appearance.color.key}
                >
                  <HubIcon />
                </div>
                <h3 className="hub-card-title hub-card-title--hubs">
                  <span className="hub-card-title-text hub-card-title-text--hubs">{hub.name}</span>
                </h3>
              </div>
              <div className="hub-card-actions">
                <button
                  onClick={(e) => toggleFavourite(hub.id, hub.is_favourite ?? false, e)}
                  className="hub-favourite-button"
                  aria-label={
                    isPendingHub
                      ? "Hub is still being created"
                      : hub.is_favourite
                        ? "Remove from pinned"
                        : "Add to pinned"
                  }
                  disabled={isPendingHub}
                >
                  {hub.is_favourite ? (
                    <StarSolid className="hub-favourite-icon filled" />
                  ) : (
                    <StarOutline className="hub-favourite-icon" />
                  )}
                </button>
                {canOpenMenu && (
                  <div className="hub-card-menu">
                    <button
                      className="hub-menu-button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setOpenMenuId((prev) => (prev === hub.id ? null : hub.id));
                      }}
                      aria-label={`Hub options for ${hub.name}`}
                      aria-expanded={openMenuId === hub.id}
                    >
                      <EllipsisVerticalIcon className="hub-menu-icon" />
                    </button>
                    {openMenuId === hub.id && (
                      <div
                        className="hub-card-menu__dropdown"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                    >
                        {canEditAppearance && (
                          <button
                          type="button"
                          className="hub-card-menu__item"
                          onClick={(e) => openAppearanceEditor(hub, e)}
                        >
                          <span>Edit hub</span>
                          <SwatchIcon className="hub-card-menu__item-icon" />
                        </button>
                        )}
                        {canArchiveHub && (
                          <button
                            type="button"
                            className="hub-card-menu__item hub-card-menu__item--danger"
                            onClick={(e) => toggleArchiveHub(hub, e)}
                          >
                            <span>{hub.archived_at ? "Unarchive hub" : "Archive hub"}</span>
                            <ArchiveBoxIcon className="hub-card-menu__item-icon" />
                          </button>
                        )}
                        {canLeaveHub && (
                          <button
                            type="button"
                            className="hub-card-menu__item hub-card-menu__item--danger"
                            onClick={(e) => leaveHub(hub, e)}
                            disabled={leaveHubMutation.isPending}
                          >
                            <span>{leaveHubMutation.isPending ? "Leaving hub..." : "Leave hub"}</span>
                            <TrashIcon className="hub-card-menu__item-icon" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
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
        })}
      </div>

      {!isLoading && filteredHubs?.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <p className="muted">No hubs found. Create your first hub to get started.</p>
        </div>
      )}

      {totalPages > 1 && (
      <div className="hubs-pagination">
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
      )}
    </div>
    {editingHub && (
      <HubAppearanceModal
        mode="edit"
        title={`Edit ${editingHub.name}`}
        subtitle=""
        submitLabel="Save hub"
        isSubmitting={updateAppearanceMutation.isPending}
        isSubmitDisabled={!editName.trim()}
        onClose={closeAppearanceEditor}
        onSubmit={submitAppearanceUpdate}
        name={editName}
        description={editDescription}
        onNameChange={setEditName}
        onDescriptionChange={setEditDescription}
        iconKey={editIconKey}
        colorKey={editColorKey}
        onIconKeyChange={setEditIconKey}
        onColorKeyChange={setEditColorKey}
        nameMax={120}
        descriptionMax={500}
      />
    )}
    </>
  );
}

