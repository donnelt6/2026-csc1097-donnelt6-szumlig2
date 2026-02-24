'use client';

import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
  onSelectAllSources?: () => void;
  onClearSourceSelection?: () => void;
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
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [youtubeUrl, setYouTubeUrl] = useState("");
  const [youtubeLanguage, setYouTubeLanguage] = useState("");
  const [youtubeAutoCaptions, setYouTubeAutoCaptions] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [retryingSourceId, setRetryingSourceId] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
  const [refreshingSourceId, setRefreshingSourceId] = useState<string | null>(null);
  const [reprocessingSourceId, setReprocessingSourceId] = useState<string | null>(null);
  const [isSubmittingUrl, setIsSubmittingUrl] = useState(false);
  const [isSubmittingYouTube, setIsSubmittingYouTube] = useState(false);
  const [retryFiles, setRetryFiles] = useState<Record<string, File>>({});

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
        // Mark the source as failed so the user can retry or delete explicitly.
        setRetryFiles((prev) => ({ ...prev, [enqueue.source.id]: uploadFile }));
        await failSource(enqueue.source.id, reason).catch(() => undefined);
        onRefresh();
        throw new Error(reason);
      }
      await enqueueSource(enqueue.source.id);
      return enqueue.source;
    },
    onSuccess: (source) => {
      setStatusMessage("Upload enqueued. Processing will start shortly.");
      setFile(null);
      setRetryFiles((prev) => {
        if (!source?.id || !(source.id in prev)) return prev;
        const { [source.id]: _unused, ...rest } = prev;
        return rest;
      });
      onRefresh();
    },
    onError: (err) => {
      setStatusMessage((err as Error).message);
    },
  });

  const handleRetryUpload = async (sourceId: string) => {
    const retryFile = retryFiles[sourceId];
    if (!retryFile) {
      setStatusMessage("Retry unavailable after refresh.");
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
      setStatusMessage("Upload requeued. Processing will start shortly.");
      onRefresh();
    } catch (err) {
      const reason = clampFailureReason(err);
      await failSource(sourceId, reason).catch(() => undefined);
      onRefresh();
      setStatusMessage(reason);
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
      setStatusMessage("Source deleted.");
      onRefresh();
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setDeletingSourceId(null);
    }
  };

  const handleSubmitUrl = async () => {
    if (!url.trim()) {
      setStatusMessage("Enter a URL to ingest.");
      return;
    }
    setIsSubmittingUrl(true);
    try {
      await createWebSource({ hub_id: hubId, url: url.trim() });
      setStatusMessage("URL enqueued. Processing will start shortly.");
      setUrl("");
      onRefresh();
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setIsSubmittingUrl(false);
    }
  };

  const handleSubmitYouTube = async () => {
    if (!youtubeUrl.trim()) {
      setStatusMessage("Enter a YouTube URL to ingest.");
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
      setStatusMessage("YouTube video enqueued. Processing will start shortly.");
      setYouTubeUrl("");
      setYouTubeLanguage("");
      setYouTubeAutoCaptions(false);
      onRefresh();
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setIsSubmittingYouTube(false);
    }
  };

  const handleRefreshSource = async (sourceId: string) => {
    setRefreshingSourceId(sourceId);
    try {
      await refreshSource(sourceId);
      setStatusMessage("Refresh queued. Latest content will be ingested.");
      onRefresh();
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setRefreshingSourceId(null);
    }
  };

  const handleReprocessSource = async (sourceId: string) => {
    setReprocessingSourceId(sourceId);
    try {
      await enqueueSource(sourceId);
      setStatusMessage("Reprocessing queued.");
      onRefresh();
    } catch (err) {
      setStatusMessage((err as Error).message);
    } finally {
      setReprocessingSourceId(null);
    }
  };

  const sortedSources = useMemo(
    () => [...sources].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [sources]
  );
  const selectableSources = useMemo(
    () => sortedSources.filter((source) => source.status === "complete"),
    [sortedSources]
  );
  const selectedSourceSet = useMemo(() => new Set(selectedSourceIds), [selectedSourceIds]);
  const selectedCount = selectableSources.filter((source) => selectedSourceSet.has(source.id)).length;
  const selectableCount = selectableSources.length;

  return (
    <div className="card grid">
      <div>
        <h3 style={{ margin: 0 }}>Upload a source</h3>
        <p className="muted">PDF, DOCX, TXT, Markdown, web URLs, or YouTube videos. Progress updates appear below.</p>
      </div>
      <label>
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          accept=".pdf,.docx,.txt,.md"
          disabled={!canUpload}
        />
      </label>
      <button className="button" onClick={() => mutation.mutate()} disabled={!canUpload || mutation.isPending || !file}>
        {mutation.isPending ? "Uploading..." : "Upload"}
      </button>
      <label>
        <input
          type="url"
          placeholder="https://example.com/onboarding"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={!canUpload}
        />
      </label>
      <button className="button" onClick={handleSubmitUrl} disabled={!canUpload || isSubmittingUrl || !url.trim()}>
        {isSubmittingUrl ? "Adding..." : "Add URL"}
      </button>
      <label>
        <input
          type="url"
          placeholder="https://www.youtube.com/watch?v=..."
          value={youtubeUrl}
          onChange={(e) => setYouTubeUrl(e.target.value)}
          disabled={!canUpload}
        />
      </label>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <input
            type="text"
            placeholder="Language (optional, e.g. en)"
            value={youtubeLanguage}
            onChange={(e) => setYouTubeLanguage(e.target.value)}
            disabled={!canUpload}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <input
            type="checkbox"
            checked={youtubeAutoCaptions}
            onChange={(e) => setYouTubeAutoCaptions(e.target.checked)}
            disabled={!canUpload}
          />
          Allow auto-captions
        </label>
      </div>
      <button
        className="button"
        onClick={handleSubmitYouTube}
        disabled={!canUpload || isSubmittingYouTube || !youtubeUrl.trim()}
      >
        {isSubmittingYouTube ? "Adding..." : "Add YouTube"}
      </button>
      {!canUpload && <p className="muted">You only have view access. Ask the hub owner to grant edit permissions.</p>}
      {statusMessage && <p className="muted">{statusMessage}</p>}
      {selectableCount > 0 && (
        <div className="card" style={{ borderColor: "#1e2535" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
            <p className="muted" style={{ margin: 0 }}>
              Sources used for answers: {selectedCount} of {selectableCount}
            </p>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                className="button"
                type="button"
                onClick={onSelectAllSources}
                disabled={selectedCount === selectableCount}
              >
                Select all
              </button>
              <button
                className="button"
                type="button"
                onClick={onClearSourceSelection}
                disabled={selectedCount === 0}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="grid" style={{ gap: "10px" }}>
        {sortedSources.map((source) => {
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
            <div key={source.id} className="card" style={{ borderColor: "#1e2535" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                <div>
                  <label style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!isSelectable}
                      onChange={() => onToggleSource(source.id)}
                      aria-label={`Use ${source.original_name} for answers`}
                      title={isSelectable ? "Use this source for answers." : "Available after processing."}
                    />
                    <strong>{source.original_name}</strong>
                  </label>
                  <p className="muted">
                    {source.type === "web"
                      ? "Web URL"
                      : source.type === "youtube"
                        ? "YouTube"
                        : "File"}{" "}
                    - {formatIrelandDateTime(new Date(source.created_at))}
                  </p>
                  {!isSelectable && source.status !== "failed" && (
                    <p className="muted">Available after processing completes.</p>
                  )}
                </div>
                <StatusPill status={source.status} />
              </div>
            {source.failure_reason && <p className="muted">Error: {source.failure_reason}</p>}
            {source.status === "failed" && (
              <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                {isRemoteSource ? (
                  <button
                    className="button"
                    type="button"
                    onClick={() => handleRefreshSource(source.id)}
                    disabled={isRefreshingThis}
                  >
                    {isRefreshingThis ? "Refreshing..." : "Refresh"}
                  </button>
                ) : (
                  <button
                    className="button"
                    type="button"
                    onClick={() => handleRetryUpload(source.id)}
                    disabled={isRetryingThis || isDeleting || !retryFiles[source.id]}
                  >
                    {isRetryingThis ? "Retrying..." : "Retry upload"}
                  </button>
                )}
                {canUpload && (
                  <button
                    className="button"
                    type="button"
                    onClick={() => handleDeleteSource(source.id)}
                    disabled={isRetryingThis || isDeleting || isRefreshingThis}
                  >
                    {isDeleting ? "Deleting..." : "Delete"}
                  </button>
                )}
              </div>
            )}
            {isRemoteSource && source.status !== "failed" && (
              <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                <button
                  className="button"
                  type="button"
                  onClick={() => handleReprocessSource(source.id)}
                  disabled={
                    isReprocessingThis ||
                    isRefreshingThis ||
                    !snapshotReady
                  }
                >
                  {isReprocessingThis ? "Reprocessing..." : "Reprocess"}
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={() => handleRefreshSource(source.id)}
                  disabled={isRefreshingThis || isReprocessingThis}
                >
                  {isRefreshingThis ? "Refreshing..." : "Refresh"}
                </button>
                {canUpload && (
                  <button
                    className="button"
                    type="button"
                    onClick={() => handleDeleteSource(source.id)}
                    disabled={isDeleting || isRefreshingThis || isReprocessingThis}
                  >
                    {isDeleting ? "Deleting..." : "Delete"}
                  </button>
                )}
              </div>
            )}
            {!isRemoteSource && source.status !== "failed" && canUpload && (
              <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                <button
                  className="button"
                  type="button"
                  onClick={() => handleDeleteSource(source.id)}
                  disabled={isDeleting}
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            )}
            {isRemoteSource && source.status !== "failed" && !snapshotReady && (
              <p className="muted">Reprocess is available after the first successful ingest.</p>
            )}
            {source.status === "failed" && !isRemoteSource && !retryFiles[source.id] && (
              <p className="muted">Retry is available until you refresh this page.</p>
            )}
            </div>
          );
        })}
        {!sortedSources.length && <p className="muted">No sources yet. Upload your first document.</p>}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Source["status"] }) {
  const colors: Record<Source["status"], string> = {
    queued: "#a1a1aa",
    processing: "#fbbf24",
    failed: "#f87171",
    complete: "#34d399",
  };
  return (
    <span
      style={{
        borderRadius: "999px",
        padding: "6px 10px",
        fontWeight: 700,
        fontSize: "0.8rem",
        background: colors[status],
        color: "#0b1221",
      }}
    >
      {status.toUpperCase()}
    </span>
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
