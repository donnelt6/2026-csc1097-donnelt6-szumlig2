'use client';

import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDownIcon,
  DocumentTextIcon,
  GlobeAltIcon,
  PlayCircleIcon,
  DocumentPlusIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  createSource,
  createSourceUploadUrl,
  createWebSource,
  createYouTubeSource,
  deleteSource,
  enqueueSource,
  failSource,
  refreshSource,
} from "../lib/api";
import type { Source } from "../lib/types";

interface Props {
  hubId: string;
  sources: Source[];
  onRefresh: () => void;
  canUpload?: boolean;
  selectedSourceIds?: string[];
  onToggleSource?: (sourceId: string) => void;
  onSelectAllSources?: (scope?: string[]) => void;
  onClearSourceSelection?: (scope?: string[]) => void;
}

export function UploadPanel({
  hubId,
  sources,
  onRefresh,
  canUpload = true,
  selectedSourceIds = [],
  onToggleSource = () => undefined,
  onSelectAllSources = () => undefined,
  onClearSourceSelection = () => undefined,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [youtubeUrl, setYouTubeUrl] = useState("");
  const [youtubeLanguage, setYouTubeLanguage] = useState("");
  const [youtubeAutoCaptions, setYouTubeAutoCaptions] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [retryingSourceId, setRetryingSourceId] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
  const [refreshingSourceId, setRefreshingSourceId] = useState<string | null>(null);
  const [reprocessingSourceId, setReprocessingSourceId] = useState<string | null>(null);
  const [isSubmittingUrl, setIsSubmittingUrl] = useState(false);
  const [isSubmittingYouTube, setIsSubmittingYouTube] = useState(false);
  const [retryFiles, setRetryFiles] = useState<Record<string, File>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "file" | "web" | "youtube">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "complete" | "incomplete">("all");
  const [uploadOpen, setUploadOpen] = useState(true);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const [isDeletingFailed, setIsDeletingFailed] = useState(false);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first");
      const uploadFile = file;
      const enqueue = await createSource({ hub_id: hubId, original_name: file.name });
      const contentType = resolveContentType(file);
      try {
        const uploadResp = await fetch(enqueue.upload_url, {
          method: "PUT",
          body: uploadFile,
          headers: { "Content-Type": contentType },
        });
        if (!uploadResp.ok) {
          const detail = await uploadResp.text();
          throw new Error(detail || `Upload failed with status ${uploadResp.status}`);
        }
      } catch (err) {
        const reason = clampFailureReason(err);
        setRetryFiles((prev) => ({ ...prev, [enqueue.source.id]: uploadFile }));
        await failSource(enqueue.source.id, reason).catch(() => undefined);
        onRefresh();
        throw new Error(reason);
      }
      await enqueueSource(enqueue.source.id);
      return enqueue.source;
    },
    onSuccess: (source) => {
      setStatusMessage({ text: "Upload enqueued. Processing will start shortly.", type: "success" });
      setFile(null);
      setRetryFiles((prev) => {
        if (!source?.id || !(source.id in prev)) return prev;
        const { [source.id]: _unused, ...rest } = prev;
        return rest;
      });
      onRefresh();
    },
    onError: (err) => {
      setStatusMessage({ text: (err as Error).message, type: "error" });
    },
  });

  const handleRetryUpload = async (sourceId: string) => {
    const retryFile = retryFiles[sourceId];
    if (!retryFile) {
      setStatusMessage({ text: "Retry unavailable after refresh.", type: "error" });
      return;
    }
    setIsRetrying(true);
    setRetryingSourceId(sourceId);
    try {
      const { upload_url } = await createSourceUploadUrl(sourceId);
      const contentType = resolveContentType(retryFile);
      const uploadResp = await fetch(upload_url, {
        method: "PUT",
        body: retryFile,
        headers: { "Content-Type": contentType },
      });
      if (!uploadResp.ok) {
        const detail = await uploadResp.text();
        throw new Error(detail || `Upload failed with status ${uploadResp.status}`);
      }
      await enqueueSource(sourceId);
      setStatusMessage({ text: "Upload requeued. Processing will start shortly.", type: "success" });
      onRefresh();
    } catch (err) {
      const reason = clampFailureReason(err);
      await failSource(sourceId, reason).catch(() => undefined);
      onRefresh();
      setStatusMessage({ text: reason, type: "error" });
    } finally {
      setIsRetrying(false);
      setRetryingSourceId(null);
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Delete this source permanently? This removes the source and its processed chunks. This cannot be undone."
      );
      if (!confirmed) return;
    }
    setDeletingSourceId(sourceId);
    try {
      await deleteSource(sourceId);
      setRetryFiles((prev) => {
        if (!(sourceId in prev)) return prev;
        const { [sourceId]: _unused, ...rest } = prev;
        return rest;
      });
      setStatusMessage({ text: "Source deleted.", type: "success" });
      onRefresh();
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: "error" });
    } finally {
      setDeletingSourceId(null);
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
    try {
      await Promise.all(failed.map((s) => deleteSource(s.id)));
      setRetryFiles((prev) => {
        const next = { ...prev };
        for (const s of failed) delete next[s.id];
        return next;
      });
      setStatusMessage({ text: `${failed.length} failed source${failed.length === 1 ? "" : "s"} deleted.`, type: "success" });
      onRefresh();
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: "error" });
      onRefresh();
    } finally {
      setIsDeletingFailed(false);
    }
  };

  const handleSubmitUrl = async () => {
    if (!url.trim()) {
      setStatusMessage({ text: "Enter a URL to ingest.", type: "error" });
      return;
    }
    setIsSubmittingUrl(true);
    try {
      await createWebSource({ hub_id: hubId, url: url.trim() });
      setStatusMessage({ text: "URL enqueued. Processing will start shortly.", type: "success" });
      setUrl("");
      onRefresh();
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: "error" });
    } finally {
      setIsSubmittingUrl(false);
    }
  };

  const handleSubmitYouTube = async () => {
    if (!youtubeUrl.trim()) {
      setStatusMessage({ text: "Enter a YouTube URL to ingest.", type: "error" });
      return;
    }
    setIsSubmittingYouTube(true);
    try {
      await createYouTubeSource({
        hub_id: hubId,
        url: youtubeUrl.trim(),
        language: youtubeLanguage.trim() ? youtubeLanguage.trim() : null,
        allow_auto_captions: youtubeAutoCaptions,
      });
      setStatusMessage({ text: "YouTube video enqueued. Processing will start shortly.", type: "success" });
      setYouTubeUrl("");
      setYouTubeLanguage("");
      setYouTubeAutoCaptions(false);
      onRefresh();
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: "error" });
    } finally {
      setIsSubmittingYouTube(false);
    }
  };

  const handleRefreshSource = async (sourceId: string) => {
    setRefreshingSourceId(sourceId);
    try {
      await refreshSource(sourceId);
      setStatusMessage({ text: "Refresh queued. Latest content will be ingested.", type: "success" });
      onRefresh();
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: "error" });
    } finally {
      setRefreshingSourceId(null);
    }
  };

  const handleReprocessSource = async (sourceId: string) => {
    setReprocessingSourceId(sourceId);
    try {
      await enqueueSource(sourceId);
      setStatusMessage({ text: "Reprocessing queued.", type: "success" });
      onRefresh();
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: "error" });
    } finally {
      setReprocessingSourceId(null);
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
    const counts = { all: sortedSources.length, file: 0, web: 0, youtube: 0, complete: 0, incomplete: 0 };
    for (const s of sortedSources) {
      if (s.type in counts) counts[s.type as "file" | "web" | "youtube"]++;
      if (s.status === "complete") counts.complete++;
      else counts.incomplete++;
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
  const pagedSources = filteredSources.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="sources">
      <input
        ref={fileInputRef}
        type="file"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        accept=".pdf,.docx,.txt,.md"
        disabled={!canUpload}
        style={{ display: "none" }}
      />

      {canUpload ? (
        <div className="sources__upload-card">
          <button
            type="button"
            className="sources__upload-toggle"
            onClick={() => setUploadOpen((v) => !v)}
            aria-expanded={uploadOpen}
          >
            <DocumentPlusIcon className="sources__section-icon" />
            <span className="sources__upload-toggle-text">Add a source</span>
            <ChevronDownIcon className={`sources__upload-chevron${uploadOpen ? " sources__upload-chevron--open" : ""}`} />
          </button>
          {uploadOpen && (
            <div className="sources__upload-body">
              {/* File upload section */}
              <div className="sources__section">
                <div className="sources__section-header">
                  <DocumentTextIcon className="sources__section-icon sources__type-icon--file" />
                  <div>
                    <h3 className="sources__section-title">Upload a file</h3>
                    <p className="sources__section-desc">PDF, DOCX, TXT, or Markdown</p>
                  </div>
                </div>
                <div className="sources__file-row">
                  <button className="button--secondary button" type="button" onClick={() => fileInputRef.current?.click()}>
                    Choose file
                  </button>
                  <span className="sources__file-name">{file ? file.name : "No file chosen"}</span>
                  <button className="button button--primary" onClick={() => mutation.mutate()} disabled={mutation.isPending || !file}>
                    {mutation.isPending ? "Uploading..." : "Upload"}
                  </button>
                </div>
              </div>

              {/* Web URL section */}
              <div className="sources__section">
                <div className="sources__section-header">
                  <GlobeAltIcon className="sources__section-icon sources__type-icon--web" />
                  <div>
                    <h3 className="sources__section-title">Add a web page</h3>
                    <p className="sources__section-desc">Enter a URL to scrape and ingest</p>
                  </div>
                </div>
                <div className="sources__input-row">
                  <input type="url" placeholder="https://example.com/onboarding" value={url} onChange={(e) => setUrl(e.target.value)} />
                  <button className="button button--primary" onClick={handleSubmitUrl} disabled={isSubmittingUrl || !url.trim()}>
                    {isSubmittingUrl ? "Adding..." : "Add URL"}
                  </button>
                </div>
              </div>

              {/* YouTube section */}
              <div className="sources__section">
                <div className="sources__section-header">
                  <PlayCircleIcon className="sources__section-icon sources__type-icon--youtube" />
                  <div>
                    <h3 className="sources__section-title">Add a YouTube video</h3>
                    <p className="sources__section-desc">Transcript will be extracted and ingested</p>
                  </div>
                </div>
                <div className="sources__input-row">
                  <input type="url" placeholder="https://www.youtube.com/watch?v=..." value={youtubeUrl} onChange={(e) => setYouTubeUrl(e.target.value)} />
                  <button className="button button--primary" onClick={handleSubmitYouTube} disabled={isSubmittingYouTube || !youtubeUrl.trim()}>
                    {isSubmittingYouTube ? "Adding..." : "Add YouTube"}
                  </button>
                </div>
                <div className="sources__youtube-options">
                  <input type="text" placeholder="Language (optional, e.g. en)" value={youtubeLanguage} onChange={(e) => setYouTubeLanguage(e.target.value)} />
                  <label className="checkbox-label">
                    <input type="checkbox" checked={youtubeAutoCaptions} onChange={(e) => setYouTubeAutoCaptions(e.target.checked)} />
                    <span>Allow auto-captions</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="sources__permission-notice">You only have view access. Ask the hub owner to grant edit permissions.</p>
      )}
      {statusMessage && <p className={`sources__status sources__status--${statusMessage.type}`}>{statusMessage.text}</p>}

      <hr className="sources__divider" />

      {sortedSources.length > 0 && (
        <div className="sources__filter-bar">
          <div className="sources__search">
            <MagnifyingGlassIcon className="sources__search-icon" />
            <input
              type="text"
              className="sources__search-input"
              placeholder="Search sources..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
            />
            {searchQuery && (
              <button type="button" className="sources__search-clear" onClick={() => setSearchQuery("")} aria-label="Clear search">
                <XMarkIcon className="sources__search-clear-icon" />
              </button>
            )}
          </div>
          <div className="sources__filter-pills">
            <button
              type="button"
              className={`sources__filter-pill${statusFilter === "all" && typeFilter === "all" ? " sources__filter-pill--active" : ""}`}
              onClick={() => { setStatusFilter("all"); setTypeFilter("all"); setPage(0); }}
            >
              All ({typeCounts.all})
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
            <span className="sources__filter-divider" />
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
            {canUpload && typeCounts.incomplete > 0 && (
              <>
                <span className="sources__filter-divider" />
                <button
                  type="button"
                  className="sources__filter-pill sources__delete-failed"
                  onClick={handleDeleteAllFailed}
                  disabled={isDeletingFailed}
                >
                  {isDeletingFailed ? "Deleting..." : `Delete failed (${typeCounts.incomplete})`}
                </button>
              </>
            )}
          </div>
          {selectableCount > 0 && (
            <div className="sources__selection-row">
              <span className="sources__selection-text">{selectedCount} of {selectableCount} selected</span>
              <div className="sources__selection-actions">
                <button className="button--small" type="button" onClick={() => onSelectAllSources(filteredSelectableIds)} disabled={selectedCount === selectableCount}>
                  Select all
                </button>
                <button className="button--small" type="button" onClick={() => onClearSourceSelection(filteredSelectableIds)} disabled={selectedCount === 0}>
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {filteredSources.length > 0 && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          totalItems={filteredSources.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
        />
      )}

      <div className="sources__list">
        {pagedSources.map((source) => {
          const isSelectable = source.status === "complete";
          const isSelected = isSelectable && selectedSourceSet.has(source.id);
          const webSnapshotReady =
            source.type === "web" &&
            source.status === "complete" &&
            Boolean((source.ingestion_metadata as { crawl_at?: string } | null)?.crawl_at);
          const youtubeSnapshotReady =
            source.type === "youtube" &&
            source.status === "complete" &&
            Boolean((source.ingestion_metadata as { transcript_fetched_at?: string } | null)?.transcript_fetched_at);
          const isRemoteSource = source.type === "web" || source.type === "youtube";
          const snapshotReady = webSnapshotReady || youtubeSnapshotReady;
          const isDeleting = deletingSourceId === source.id;
          const isRetryingThis = isRetrying && retryingSourceId === source.id;
          const isRefreshingThis = refreshingSourceId === source.id;
          const isReprocessingThis = reprocessingSourceId === source.id;
          return (
            <div
              key={source.id}
              className={`sources__card${isSelectable ? " sources__card--selectable" : ""}${isSelected ? " sources__card--selected" : ""}`}
              onClick={isSelectable ? (e) => {
                if ((e.target as HTMLElement).closest("button, a, input")) return;
                onToggleSource(source.id);
              } : undefined}
            >
              <div className="sources__card-top">
                <div className="sources__card-info">
                  {source.type === "file" && <DocumentTextIcon className="sources__type-icon sources__type-icon--file" />}
                  {source.type === "web" && <GlobeAltIcon className="sources__type-icon sources__type-icon--web" />}
                  {source.type === "youtube" && <PlayCircleIcon className="sources__type-icon sources__type-icon--youtube" />}
                  <div className="sources__card-details">
                    <p className="sources__card-name">{source.original_name}</p>
                    <p className="sources__card-meta">
                      {source.type === "web" ? "Web URL" : source.type === "youtube" ? "YouTube" : "File"}{" "}
                      &middot; {formatIrelandDateTime(new Date(source.created_at))}
                      {source.type === "youtube" && (source.ingestion_metadata as Record<string, unknown> | null)?.captions_source === "auto" && (
                        <span className="sources__auto-caption-badge" title="This transcript was generated by YouTube's automatic captions and may contain errors">⚠ Auto-captions</span>
                      )}
                    </p>
                    {!isSelectable && source.status !== "failed" && (
                      <p className="sources__card-note">Available after processing completes.</p>
                    )}
                  </div>
                </div>
                <div className="sources__card-right">
                  {source.status === "failed" && (
                    <div className="sources__card-actions">
                      {isRemoteSource ? (
                        <button className="button--small" type="button" onClick={() => handleRefreshSource(source.id)} disabled={isRefreshingThis}>
                          {isRefreshingThis ? "Refreshing..." : "Refresh"}
                        </button>
                      ) : (
                        <button className="button--small" type="button" onClick={() => handleRetryUpload(source.id)} disabled={isRetryingThis || isDeleting || !retryFiles[source.id]}>
                          {isRetryingThis ? "Retrying..." : "Retry upload"}
                        </button>
                      )}
                      {canUpload && (
                        <button className="button--small button--danger" type="button" onClick={() => handleDeleteSource(source.id)} disabled={isRetryingThis || isDeleting || isRefreshingThis}>
                          {isDeleting ? "Deleting..." : "Delete"}
                        </button>
                      )}
                    </div>
                  )}
                  {isRemoteSource && source.status !== "failed" && (
                    <div className="sources__card-actions">
                      <button className="button--small" type="button" onClick={() => handleReprocessSource(source.id)} disabled={isReprocessingThis || isRefreshingThis || !snapshotReady}>
                        {isReprocessingThis ? "Reprocessing..." : "Reprocess"}
                      </button>
                      <button className="button--small" type="button" onClick={() => handleRefreshSource(source.id)} disabled={isRefreshingThis || isReprocessingThis}>
                        {isRefreshingThis ? "Refreshing..." : "Refresh"}
                      </button>
                      {canUpload && (
                        <button className="button--small button--danger" type="button" onClick={() => handleDeleteSource(source.id)} disabled={isDeleting || isRefreshingThis || isReprocessingThis}>
                          {isDeleting ? "Deleting..." : "Delete"}
                        </button>
                      )}
                    </div>
                  )}
                  {!isRemoteSource && source.status !== "failed" && canUpload && (
                    <div className="sources__card-actions">
                      <button className="button--small button--danger" type="button" onClick={() => handleDeleteSource(source.id)} disabled={isDeleting}>
                        {isDeleting ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  )}
                  <StatusPill status={source.status} />
                </div>
              </div>
              {source.failure_reason && (
                <p className="sources__card-error">Error: {source.failure_reason}</p>
              )}
              {isRemoteSource && source.status !== "failed" && !snapshotReady && (
                <p className="sources__card-note">Reprocess is available after the first successful ingest.</p>
              )}
              {source.status === "failed" && !isRemoteSource && !retryFiles[source.id] && (
                <p className="sources__card-note">Retry is available until you refresh this page.</p>
              )}
            </div>
          );
        })}
        {sortedSources.length > 0 && filteredSources.length === 0 && (
          <p className="muted" style={{ textAlign: "center", padding: "24px 0" }}>No sources match your search.</p>
        )}
        {!sortedSources.length && (
          <div className="sources__empty">
            <DocumentPlusIcon className="sources__empty-icon" />
            <p className="sources__empty-title">No sources yet</p>
            <p className="sources__empty-desc">Upload your first document, add a URL, or paste a YouTube link above.</p>
          </div>
        )}
      </div>

      {filteredSources.length > 0 && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          totalItems={filteredSources.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
        />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: Source["status"] }) {
  return (
    <span className={`sources__pill sources__pill--${status}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function PaginationBar({
  page,
  totalPages,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  return (
    <div className="sources__pagination">
      <div className="sources__pagination-info">
        Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalItems)} of {totalItems}
      </div>
      <div className="sources__pagination-controls">
        <button type="button" className="button--small" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
          Previous
        </button>
        <span className="sources__pagination-page">Page {page + 1} of {totalPages}</span>
        <button type="button" className="button--small" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>
          Next
        </button>
      </div>
      <div className="sources__pagination-sizes">
        {[10, 25, 50].map((size) => (
          <button
            key={size}
            type="button"
            className={`sources__filter-pill${pageSize === size ? " sources__filter-pill--active" : ""}`}
            onClick={() => onPageSizeChange(size)}
          >
            {size}
          </button>
        ))}
      </div>
    </div>
  );
}

function resolveContentType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "txt":
    case "md":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function clampFailureReason(err: unknown): string {
  const message = err instanceof Error ? err.message : "Upload failed.";
  const trimmed = message.trim() || "Upload failed.";
  return trimmed.length > 500 ? trimmed.slice(0, 500) : trimmed;
}

function formatIrelandDateTime(date: Date) {
  if (Number.isNaN(date.getTime())) return "";
  const day = pad2(date.getDate());
  const month = pad2(date.getMonth() + 1);
  const year = date.getFullYear();
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}
