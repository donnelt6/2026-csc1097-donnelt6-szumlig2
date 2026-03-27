'use client';

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DocumentTextIcon,
  GlobeAltIcon,
  PlayCircleIcon,
  DocumentPlusIcon,
  XMarkIcon,
  EyeIcon,
  TrashIcon,
  ArrowPathIcon,
  PlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  ClipboardDocumentIcon,
} from "@heroicons/react/24/outline";
import {
  deleteSource,
  listSourceChunks,
  refreshSource,
} from "../lib/api";
import { useSearch } from "../lib/SearchContext";
import { AddSourceModal } from "./AddSourceModal";
import { SuggestedSourcesPanel } from "./SuggestedSourcesPanel";
import type { Source } from "../lib/types";

interface Props {
  hubId: string;
  sources: Source[];
  onRefresh: () => void | Promise<unknown>;
  canUpload?: boolean;
  canReviewSuggestions?: boolean;
  selectedSourceIds?: string[];
  onToggleSource?: (sourceId: string) => void;
  onSelectAllSources?: (scope?: string[]) => void;
  onClearSourceSelection?: (scope?: string[]) => void;
  autoOpenModal?: boolean;
  onModalOpened?: () => void;
}

export function UploadPanel({
  hubId,
  sources,
  onRefresh,
  canUpload = true,
  canReviewSuggestions = false,
  selectedSourceIds = [],
  onToggleSource = () => undefined,
  onSelectAllSources = () => undefined,
  onClearSourceSelection = () => undefined,
  autoOpenModal = false,
  onModalOpened,
}: Props) {
  const queryClient = useQueryClient();
  const { searchQuery } = useSearch();
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [deletingSourceIds, setDeletingSourceIds] = useState<Set<string>>(new Set());
  const [refreshingSourceIds, setRefreshingSourceIds] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<"all" | "file" | "web" | "youtube">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "complete" | "incomplete">("all");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const [isDeletingFailed, setIsDeletingFailed] = useState(false);
  const [viewingSource, setViewingSource] = useState<Source | null>(null);
  const [viewChunks, setViewChunks] = useState<{ chunk_index: number; text: string }[]>([]);
  const [isLoadingChunks, setIsLoadingChunks] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [errorPopoverId, setErrorPopoverId] = useState<string | null>(null);
  const [errorPopoverFlip, setErrorPopoverFlip] = useState(false);
  const errorPopoverRef = useRef<HTMLDivElement>(null);

  // Close error popover on click outside
  useEffect(() => {
    if (!errorPopoverId) return;
    const handleClick = (e: MouseEvent) => {
      if (errorPopoverRef.current && !errorPopoverRef.current.contains(e.target as Node)) {
        setErrorPopoverId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [errorPopoverId]);

  // Reset page when navbar search changes
  useEffect(() => { setPage(0); }, [searchQuery]);
  const autoOpenHandled = useRef(false);

  // Auto-open modal when triggered from sidebar
  useEffect(() => {
    if (autoOpenModal && !autoOpenHandled.current) {
      autoOpenHandled.current = true;
      setShowAddModal(true);
      onModalOpened?.();
    }
    if (!autoOpenModal) {
      autoOpenHandled.current = false;
    }
  }, [autoOpenModal, onModalOpened]);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  const updateSourcesCache = (updater: (current: Source[]) => Source[]) => {
    queryClient.setQueryData<Source[]>(["sources", hubId], (current) => updater(current ?? []));
  };

  const handleDeleteSource = async (sourceId: string) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Delete this source permanently? This removes the source and its processed chunks. This cannot be undone."
      );
      if (!confirmed) return;
    }
    setDeletingSourceIds((prev) => new Set(prev).add(sourceId));
    try {
      await deleteSource(sourceId);
      setPage(0);
      await onRefresh();
      setStatusMessage({ text: "Source deleted.", type: "success" });
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: "error" });
    } finally {
      setDeletingSourceIds((prev) => { const next = new Set(prev); next.delete(sourceId); return next; });
    }
  };

  const handleDeleteAllFailed = async () => {
    const failed = sources.filter((s) => s.status === "failed");
    if (!failed.length) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete ${failed.length} failed source${failed.length === 1 ? "" : "s"}? This cannot be undone.`
      );
      if (!confirmed) return;
    }
    setIsDeletingFailed(true);
    const failedIds = new Set(failed.map((source) => source.id));
    const previousSources = queryClient.getQueryData<Source[]>(["sources", hubId]) ?? [];
    updateSourcesCache((current) => current.filter((source) => !failedIds.has(source.id)));
    try {
      const results = await Promise.allSettled(failed.map((s) => deleteSource(s.id)));
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failedCount = results.filter((r) => r.status === "rejected").length;
      setPage(0);
      if (failedCount === 0) {
        setStatusMessage({ text: `${succeeded} failed source${succeeded === 1 ? "" : "s"} deleted.`, type: "success" });
      } else {
        const deletedIds = new Set(
          failed
            .filter((_, index) => results[index].status === "fulfilled")
            .map((source) => source.id)
        );
        queryClient.setQueryData(
          ["sources", hubId],
          previousSources.filter((source) => !deletedIds.has(source.id))
        );
        setStatusMessage({ text: `${succeeded} deleted, ${failedCount} could not be removed.`, type: "error" });
      }
      onRefresh();
    } finally {
      setIsDeletingFailed(false);
    }
  };

  const handleRefreshSource = async (sourceId: string) => {
    setRefreshingSourceIds((prev) => new Set(prev).add(sourceId));
    const previousSources = queryClient.getQueryData<Source[]>(["sources", hubId]) ?? [];
    updateSourcesCache((current) =>
      current.map((source) =>
        source.id === sourceId
          ? { ...source, status: "queued", failure_reason: undefined }
          : source
      )
    );
    try {
      await refreshSource(sourceId);
      setStatusMessage({ text: "Refresh queued. Latest content will be ingested.", type: "success" });
      onRefresh();
    } catch (err) {
      queryClient.setQueryData(["sources", hubId], previousSources);
      setStatusMessage({ text: (err as Error).message, type: "error" });
    } finally {
      setRefreshingSourceIds((prev) => { const next = new Set(prev); next.delete(sourceId); return next; });
    }
  };


  const handleViewChunks = async (source: Source) => {
    setViewingSource(source);
    setViewChunks([]);
    setIsLoadingChunks(true);
    try {
      const chunks = await listSourceChunks(source.id);
      setViewChunks(chunks);
    } catch {
      setViewChunks([]);
    } finally {
      setIsLoadingChunks(false);
    }
  };

  const sortedSources = useMemo(
    () => [...sources].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [sources]
  );
  const filteredSources = useMemo(() => {
    let result = sortedSources;
    if (typeFilter !== "all") {
      result = result.filter((s) => s.type === typeFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter((s) =>
        statusFilter === "complete" ? s.status === "complete" : s.status !== "complete"
      );
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((s) => s.original_name.toLowerCase().includes(q));
    }
    return result;
  }, [sortedSources, typeFilter, statusFilter, searchQuery]);
  const typeCounts = useMemo(() => {
    const counts = { all: sortedSources.length, file: 0, web: 0, youtube: 0, complete: 0, incomplete: 0, failed: 0 };
    for (const s of sortedSources) {
      if (s.type in counts) counts[s.type as "file" | "web" | "youtube"]++;
      if (s.status === "complete") counts.complete++;
      else counts.incomplete++;
      if (s.status === "failed") counts.failed++;
    }
    return counts;
  }, [sortedSources]);
  const filteredSelectableIds = useMemo(
    () => filteredSources.filter((s) => s.status === "complete").map((s) => s.id),
    [filteredSources]
  );
  const selectedSourceSet = useMemo(() => new Set(selectedSourceIds), [selectedSourceIds]);
  const selectedCount = filteredSelectableIds.filter((id) => selectedSourceSet.has(id)).length;
  const selectableCount = filteredSelectableIds.length;
  const totalPages = Math.max(1, Math.ceil(filteredSources.length / pageSize));

  useEffect(() => {
    const max = Math.max(0, totalPages - 1);
    if (page > max) setPage(max);
  }, [page, totalPages]);

  const safePage = Math.min(page, totalPages - 1);
  const pagedSources = filteredSources.slice(safePage * pageSize, (safePage + 1) * pageSize);

  return (
    <div className="sources">
      {/* Header: title on top, subtitle + actions on second row */}
      <h2 className="sources__title">Hub Sources</h2>
      <div className="sources__subtitle-row">
        <p className="sources__description">
          Centralised knowledge repository. All uploaded documents are indexed and processed for semantic search.
        </p>
        <div className="sources__header-actions">
          <SuggestedSourcesPanel hubId={hubId} canReview={canReviewSuggestions} onAccepted={onRefresh} />
          {canUpload && (
            <button
              type="button"
              className="button button--primary sources__add-btn"
              onClick={() => setShowAddModal(true)}
            >
              <PlusIcon className="sources__btn-icon" />
              Add Source
            </button>
          )}
        </div>
      </div>

      {!canUpload && (
        <p className="sources__permission-notice">You only have view access. Ask the hub owner to grant admin or editor permissions.</p>
      )}

      {statusMessage && <p className={`sources__status sources__status--${statusMessage.type}`}>{statusMessage.text}</p>}

      {/* Filters + selection row */}
      {sortedSources.length > 0 && (
        <div className="sources__toolbar">
          <div className="sources__filter-groups">
            <div className="sources__filter-pills">
              <button
                type="button"
                className={`sources__filter-pill${statusFilter === "all" ? " sources__filter-pill--active" : ""}`}
                onClick={() => { setStatusFilter("all"); setPage(0); }}
              >
                All
              </button>
              {(["complete", "incomplete"] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  className={`sources__filter-pill${statusFilter === status ? " sources__filter-pill--active" : ""}`}
                  onClick={() => { setStatusFilter(statusFilter === status ? "all" : status); setPage(0); }}
                >
                  {status === "complete" ? "Complete" : "Incomplete"} ({typeCounts[status]})
                </button>
              ))}
            </div>
            <div className="sources__filter-pills">
              <button
                type="button"
                className={`sources__filter-pill${typeFilter === "all" ? " sources__filter-pill--active" : ""}`}
                onClick={() => { setTypeFilter("all"); setPage(0); }}
              >
                All
              </button>
              {(["file", "web", "youtube"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`sources__filter-pill${typeFilter === type ? " sources__filter-pill--active" : ""}`}
                  onClick={() => { setTypeFilter(typeFilter === type ? "all" : type); setPage(0); }}
                >
                  {type === "file" ? "Files" : type === "web" ? "Web" : "YouTube"} ({typeCounts[type]})
                </button>
              ))}
            </div>
            {canUpload && typeCounts.failed > 0 && (
              <button
                type="button"
                className="sources__filter-pill sources__delete-failed"
                onClick={handleDeleteAllFailed}
                disabled={isDeletingFailed}
              >
                {isDeletingFailed ? "Deleting..." : `Delete failed (${typeCounts.failed})`}
              </button>
            )}
          </div>
          {selectableCount > 0 && (
            <div className="sources__selection-actions">
              <span className="sources__selection-text">{selectedCount} of {selectableCount} selected</span>
              <button className="button--small" type="button" onClick={() => onSelectAllSources?.(filteredSelectableIds)} disabled={selectedCount === selectableCount}>
                Select all
              </button>
              <button className="button--small" type="button" onClick={() => onClearSourceSelection?.(filteredSelectableIds)} disabled={selectedCount === 0}>
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {/* Table header */}
      {sortedSources.length > 0 && (
        <div className="sources__table-header">
          <span className="sources__th sources__th--name">Resource Name</span>
          <span className="sources__th sources__th--type">Type</span>
          <span className="sources__th sources__th--status">Status</span>
          <span className="sources__th sources__th--actions">Actions</span>
        </div>
      )}

      {/* Table rows */}
      <div className="sources__table-body">
        {pagedSources.map((source) => {
          const isSelectable = source.status === "complete";
          const isSelected = isSelectable && selectedSourceSet.has(source.id);
          const isRemoteSource = source.type === "web" || source.type === "youtube";
          const isDeleting = deletingSourceIds.has(source.id);
          const isRefreshingThis = refreshingSourceIds.has(source.id);
          return (
            <div
              key={source.id}
              className={`sources__row${isSelectable ? " sources__row--selectable" : ""}${isSelected ? " sources__row--selected" : ""}`}
              role={isSelectable ? "button" : undefined}
              tabIndex={isSelectable ? 0 : undefined}
              aria-label={isSelectable ? `${isSelected ? "Deselect" : "Select"} ${source.original_name}` : undefined}
              aria-pressed={isSelectable ? isSelected : undefined}
              onClick={isSelectable ? (e) => {
                if ((e.target as HTMLElement).closest("button, a, input")) return;
                onToggleSource?.(source.id);
              } : undefined}
              onKeyDown={isSelectable ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggleSource?.(source.id);
                }
              } : undefined}
            >
              {/* Resource name */}
              <div className="sources__cell sources__cell--name">
                <div className={`sources__resource-icon sources__resource-icon--${source.type}`}>
                  {source.type === "file" && <DocumentTextIcon className="sources__type-icon sources__type-icon--file" />}
                  {source.type === "web" && <GlobeAltIcon className="sources__type-icon sources__type-icon--web" />}
                  {source.type === "youtube" && <PlayCircleIcon className="sources__type-icon sources__type-icon--youtube" />}
                </div>
                <div className="sources__resource-details">
                  <span className="sources__resource-name">{source.original_name}</span>
                  <span className="sources__resource-meta">
                    Uploaded {formatRelativeDate(new Date(source.created_at))}
                    {source.type === "youtube" && (source.ingestion_metadata as Record<string, unknown> | null)?.captions_source === "auto" && (
                      <span className="sources__auto-caption-badge" title="Auto-generated captions">&#x26A0; Auto-captions</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Type badge */}
              <div className="sources__cell sources__cell--type">
                <span className={`sources__type-badge sources__type-badge--${source.type}`}>
                  {source.type === "file" ? "Document" : source.type === "web" ? "Web" : "YouTube"}
                </span>
              </div>

              {/* Status */}
              <div className="sources__cell sources__cell--status">
                {isDeleting ? (
                  <span className="sources__status-indicator sources__status-indicator--processing">
                    <span className="sources__status-spinner" />
                    Deleting
                  </span>
                ) : (
                  <StatusIndicator status={source.status} />
                )}
              </div>

              {/* Actions — fixed 3-slot layout: refresh | eye/warning | delete */}
              <div className="sources__cell sources__cell--actions">
                {/* Slot 1: refresh (remote sources) or placeholder */}
                {isRemoteSource ? (
                  <button
                    className="sources__action-btn"
                    type="button"
                    onClick={() => handleRefreshSource(source.id)}
                    disabled={isRefreshingThis}
                    title="Refresh"
                  >
                    <ArrowPathIcon className={`sources__action-icon${isRefreshingThis ? " sources__action-icon--spin" : ""}`} />
                  </button>
                ) : (
                  <span className="sources__action-btn sources__action-btn--placeholder" />
                )}

                {/* Slot 2: eye (complete) or warning (failed) or placeholder */}
                {source.status === "complete" ? (
                  <button
                    className="sources__action-btn"
                    type="button"
                    onClick={() => handleViewChunks(source)}
                    title="View chunks"
                  >
                    <EyeIcon className="sources__action-icon" />
                  </button>
                ) : source.status === "failed" ? (
                  <div className="sources__error-popover-wrapper" ref={errorPopoverId === source.id ? errorPopoverRef : undefined}>
                    <button
                      className="sources__action-btn sources__action-btn--warning"
                      type="button"
                      onClick={(e) => {
                        if (errorPopoverId === source.id) {
                          setErrorPopoverId(null);
                        } else {
                          const btn = e.currentTarget as HTMLElement;
                          const scroller = btn.closest(".sources__table-body");
                          if (scroller) {
                            const btnRect = btn.getBoundingClientRect();
                            const scrollRect = scroller.getBoundingClientRect();
                            setErrorPopoverFlip(btnRect.top - scrollRect.top < 160);
                          }
                          setErrorPopoverId(source.id);
                        }
                      }}
                      title="View error"
                    >
                      <ExclamationTriangleIcon className="sources__action-icon" />
                    </button>
                    {errorPopoverId === source.id && (
                      <div className={`sources__error-popover${errorPopoverFlip ? " sources__error-popover--below" : ""}`}>
                        <p className="sources__error-popover-text">{source.failure_reason || "Processing failed. Try deleting and re-uploading."}</p>
                        {source.failure_reason && (
                          <button
                            className="sources__error-popover-copy"
                            type="button"
                            onClick={() => navigator.clipboard.writeText(source.failure_reason!)}
                            title="Copy error"
                          >
                            <ClipboardDocumentIcon className="sources__error-popover-copy-icon" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="sources__action-btn sources__action-btn--placeholder" />
                )}

                {/* Slot 3: delete */}
                {canUpload && (
                  <button
                    className="sources__action-btn sources__action-btn--danger"
                    type="button"
                    onClick={() => handleDeleteSource(source.id)}
                    disabled={isDeleting}
                    title="Delete"
                  >
                    <TrashIcon className="sources__action-icon" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {sortedSources.length > 0 && filteredSources.length === 0 && (
          <p className="sources__empty-message muted">No sources match your search.</p>
        )}
        {!sortedSources.length && (
          <div className="sources__empty">
            <DocumentPlusIcon className="sources__empty-icon" />
            <p className="sources__empty-title">No sources yet</p>
            <p className="sources__empty-desc">Click &ldquo;Add Source&rdquo; to upload your first document, add a URL, or import a YouTube video.</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {filteredSources.length > 0 && (
        <div className="sources__pagination">
          <p className="sources__pagination-info">
            Showing {safePage * pageSize + 1}&ndash;{Math.min((safePage + 1) * pageSize, filteredSources.length)} of {filteredSources.length} Sources
          </p>
          <div className="sources__pagination-controls">
            <div className="sources__pagination-per-page">
              <span className="sources__pagination-per-page-label">Per page</span>
              {[10, 25, 50].map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`sources__pagination-page${size === pageSize ? " sources__pagination-page--active" : ""}`}
                  onClick={() => { setPageSize(size); setPage(0); }}
                >
                  {size}
                </button>
              ))}
            </div>
            <div className="sources__pagination-buttons">
              <button
                type="button"
                className="sources__pagination-arrow"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                <ChevronLeftIcon className="sources__pagination-arrow-icon" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`sources__pagination-page${p === page ? " sources__pagination-page--active" : ""}`}
                  onClick={() => setPage(p)}
                >
                  {p + 1}
                </button>
              ))}
              <button
                type="button"
                className="sources__pagination-arrow"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                <ChevronRightIcon className="sources__pagination-arrow-icon" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View chunks modal */}
      {viewingSource && (
        <div className="modal-backdrop" onClick={() => setViewingSource(null)}>
          <div className="modal sources__chunks-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sources__chunks-header">
              <h3 className="sources__chunks-title">{viewingSource.original_name}</h3>
              <button type="button" className="sources__chunks-close" onClick={() => setViewingSource(null)} aria-label="Close">
                <XMarkIcon className="sources__chunks-close-icon" />
              </button>
            </div>
            <div className="sources__chunks-body">
              {isLoadingChunks && <p className="sources__chunks-loading">Loading chunks...</p>}
              {!isLoadingChunks && viewChunks.length === 0 && (
                <p className="sources__chunks-empty">No chunks found for this source.</p>
              )}
              {!isLoadingChunks && viewChunks.map((chunk) => (
                <div key={chunk.chunk_index} className="sources__chunk">
                  <span className="sources__chunk-index">Chunk {chunk.chunk_index + 1}</span>
                  <p className="sources__chunk-text">{chunk.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Add source modal */}
      <AddSourceModal
        hubId={hubId}
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onRefresh={onRefresh}
      />

    </div>
  );
}

function StatusIndicator({ status }: { status: Source["status"] }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  if (status === "complete") {
    return (
      <span className="sources__status-indicator sources__status-indicator--complete">
        <span className="sources__status-dot sources__status-dot--complete" />
        {label}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="sources__status-indicator sources__status-indicator--failed">
        <span className="sources__status-dot sources__status-dot--failed" />
        {label}
      </span>
    );
  }
  return (
    <span className="sources__status-indicator sources__status-indicator--processing">
      <span className="sources__status-spinner" />
      Indexing
    </span>
  );
}

function formatRelativeDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;

  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}
