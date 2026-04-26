'use client';

// AddSourceModal.tsx: Modal dialog for adding new URL or file sources to a hub.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  XMarkIcon,
  CloudArrowUpIcon,
  DocumentTextIcon,
  GlobeAltIcon,
  PlayCircleIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import {
  createSource,
  createYouTubeFallbackSource,
  createWebSource,
  createYouTubeSource,
  enqueueSource,
  failSource,
} from "../lib/api";
import {
  MEDIA_COMPRESSION_INPUT_MAX_BYTES,
  mediaUploadRequiresCompression,
  prepareMediaFileForUpload,
} from "../lib/mediaCompression";
import type { Source } from "@shared/index";

type UploadStatus = "pending" | "preparing" | "uploading" | "creating" | "enqueuing" | "complete" | "error";

interface FileQueueItem {
  kind: "file";
  sourceKind: "document" | "manual_media" | "youtube_fallback";
  id: string;
  label: string;
  size: number;
  file: File;
  status: UploadStatus;
  progress: number;
  error?: string;
  sourceId?: string;
  youtubeSourceId?: string;
}

interface WebQueueItem {
  kind: "webpage";
  id: string;
  label: string;
  url: string;
  status: UploadStatus;
  progress: number;
  error?: string;
}

interface YouTubeQueueItem {
  kind: "youtube";
  id: string;
  label: string;
  url: string;
  language: string;
  allowAutoCaptions: boolean;
  status: UploadStatus;
  progress: number;
  error?: string;
}

type QueueItem = FileQueueItem | WebQueueItem | YouTubeQueueItem;

interface Props {
  hubId: string;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
  youtubeFallbackSource?: Source | null;
}

type ModalTab = "upload" | "webpage" | "youtube";
type YouTubeImportMode = "link" | "manual";

function resolveContentType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "pdf": return "application/pdf";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "txt":
    case "md": return "text/plain";
    case "mp3":
      return "audio/mpeg";
    case "mp4": return "video/mp4";
    case "m4a": return "audio/mp4";
    default: return "application/octet-stream";
  }
}

function buildUploadFailureMessage(xhr: XMLHttpRequest): string {
  const responseText = xhr.responseText?.trim();
  if (responseText) {
    try {
      const parsed = JSON.parse(responseText) as { message?: string; error?: string };
      const message = parsed.message || parsed.error;
      if (message) return `Upload failed: ${message}`;
    } catch {
      return `Upload failed: ${responseText}`;
    }
  }
  return `Upload failed with status ${xhr.status}`;
}

const DOCUMENT_ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];
const DOCUMENT_ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];

const MEDIA_ACCEPTED_EXTENSIONS = [".mp3", ".mp4", ".m4a"];
const MEDIA_ACCEPTED_MIME_TYPES = [
  "audio/mpeg",
  "video/mp4",
  "audio/mp4",
];

const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;
function getFileModeConfig(sourceKind: FileQueueItem["sourceKind"]) {
  if (sourceKind === "document") {
    return {
      acceptedExtensions: DOCUMENT_ACCEPTED_EXTENSIONS,
      acceptedMimeTypes: DOCUMENT_ACCEPTED_MIME_TYPES,
      maxSize: DOCUMENT_MAX_BYTES,
      acceptsLabel: "PDF, DOCX, TXT, or MD files up to 50MB",
      unsupportedMessage: "No supported files selected. Accepted: PDF, DOCX, TXT, MD.",
      tooLargeLabel: "50 MB",
      allowMultiple: true,
      dropzoneTitle: "Click or drag and drop files",
    };
  }
  return {
    acceptedExtensions: MEDIA_ACCEPTED_EXTENSIONS,
    acceptedMimeTypes: MEDIA_ACCEPTED_MIME_TYPES,
    maxSize: MEDIA_COMPRESSION_INPUT_MAX_BYTES,
    acceptsLabel: "MP3, MP4, or M4A files. Files above 50MB are compressed before upload.",
    unsupportedMessage: "No supported media selected. Accepted: MP3, MP4, M4A.",
    tooLargeLabel: "200 MB",
    allowMultiple: sourceKind === "manual_media",
    dropzoneTitle: "Click or drag and drop audio or video",
  };
}

function isAcceptedFile(file: File, acceptedExtensions: string[], acceptedMimeTypes: string[]): boolean {
  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  return acceptedExtensions.includes(ext) || acceptedMimeTypes.includes(file.type);
}

let queueIdCounter = 0;

export function AddSourceModal({ hubId, open, onClose, onRefresh, youtubeFallbackSource = null }: Props) {
  const isYouTubeFallbackMode = Boolean(youtubeFallbackSource);
  const [activeTab, setActiveTab] = useState<ModalTab>("upload");
  const [youtubeImportMode, setYouTubeImportMode] = useState<YouTubeImportMode>("link");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [url, setUrl] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeAutoCaptions, setYoutubeAutoCaptions] = useState(true);
  const [youtubeLanguage, setYoutubeLanguage] = useState("en");
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const isProcessingRef = useRef(false);
  const isAddingYouTubeUrlRef = useRef(false);
  const queueRef = useRef(queue);
  const queuedYoutubeUrlsRef = useRef<Set<string>>(new Set());
  queueRef.current = queue;
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && isYouTubeFallbackMode) {
      setActiveTab("upload");
    }
  }, [open, isYouTubeFallbackMode]);

  useEffect(() => {
    queuedYoutubeUrlsRef.current = new Set(
      queue
        .filter((item): item is YouTubeQueueItem => item.kind === "youtube")
        .filter((item) => item.status !== "error" && item.status !== "complete")
        .map((item) => item.url),
    );
  }, [queue]);

  useEffect(() => {
    isAddingYouTubeUrlRef.current = false;
  }, [queue]);

  // Auto-dismiss status messages
  useEffect(() => {
    if (!statusMessage) return;
    const timeout = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  // Clear completed and errored queue items when the modal reopens so a fresh upload
  // session starts cleanly without mutating the underlying source rows.
  useEffect(() => {
    if (open) {
      setQueue((prev) => prev.filter((item) => item.status !== "complete" && item.status !== "error"));
    }
  }, [open]);

  // Process queue sequentially — handles all source types
  const syncQueue = useCallback((updater: (items: QueueItem[]) => QueueItem[]) => {
    const next = updater(queueRef.current);
    queueRef.current = next;
    setQueue(next);
  }, []);

  const processQueue = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    while (true) {
      const nextItem = queueRef.current.find((item) => item.status === "pending");

      if (!nextItem) break;

      const itemId = nextItem.id;

      try {
        if (nextItem.kind === "file") {
          let file = nextItem.file;
          if (nextItem.sourceKind !== "document" && mediaUploadRequiresCompression(file)) {
            syncQueue((items) =>
              items.map((item) =>
                item.id === itemId ? { ...item, status: "preparing" as UploadStatus, progress: 0 } : item
              )
            );
            file = await prepareMediaFileForUpload(file);
            syncQueue((items) =>
              items.map((item) =>
                item.id === itemId && item.kind === "file"
                  ? { ...item, file, label: file.name, size: file.size }
                  : item
              )
            );
          }

          // Compression happens before the direct storage upload so the signed PUT stays below
          // the active Supabase project limit.
          syncQueue((items) =>
            items.map((item) =>
              item.id === itemId ? { ...item, status: "uploading" as UploadStatus, progress: 0 } : item
            )
          );

          // Step 1: Create source record and get upload URL
          const enqueueResult = nextItem.sourceKind === "youtube_fallback"
            ? await createYouTubeFallbackSource({
                hub_id: hubId,
                youtube_source_id: nextItem.youtubeSourceId!,
                original_name: file.name,
              })
            : await createSource(
                nextItem.sourceKind === "manual_media"
                  ? { hub_id: hubId, original_name: file.name, file_kind: "media" }
                  : { hub_id: hubId, original_name: file.name }
              );
          const contentType = resolveContentType(file);

          // Track the backend source ID so we can clean up on failure
          syncQueue((items) =>
            items.map((item) =>
              item.id === itemId && item.kind === "file" ? { ...item, sourceId: enqueueResult.source.id } : item
            )
          );

          // Step 2: Upload to S3 with progress tracking via XHR
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", enqueueResult.upload_url);
            xhr.setRequestHeader("Content-Type", contentType);

            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                const pct = Math.round((event.loaded / event.total) * 100);
                syncQueue((items) =>
                  items.map((item) =>
                    item.id === itemId ? { ...item, progress: pct } : item
                  )
                );
              }
            };

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
              } else {
                reject(new Error(buildUploadFailureMessage(xhr)));
              }
            };
            xhr.onerror = () => reject(new Error("Upload failed — network error"));
            xhr.send(file);
          });

          // Step 3: Enqueue for processing
          syncQueue((items) =>
            items.map((item) =>
              item.id === itemId ? { ...item, status: "enqueuing" as UploadStatus, progress: 100 } : item
            )
          );
          await enqueueSource(enqueueResult.source.id);
        } else if (nextItem.kind === "webpage") {
          syncQueue((items) =>
            items.map((item) =>
              item.id === itemId ? { ...item, status: "creating" as UploadStatus, progress: 0 } : item
            )
          );
          let finalUrl = nextItem.url;
          if (!/^https?:\/\//i.test(finalUrl)) {
            finalUrl = `https://${finalUrl}`;
          }
          await createWebSource({ hub_id: hubId, url: finalUrl });
        } else if (nextItem.kind === "youtube") {
          syncQueue((items) =>
            items.map((item) =>
              item.id === itemId ? { ...item, status: "creating" as UploadStatus, progress: 0 } : item
            )
          );
          let finalUrl = nextItem.url;
          if (!/^https?:\/\//i.test(finalUrl)) {
            finalUrl = `https://${finalUrl}`;
          }
          await createYouTubeSource({
            hub_id: hubId,
            url: finalUrl,
            language: nextItem.language.trim() || undefined,
            allow_auto_captions: nextItem.allowAutoCaptions,
          });
        }

        // Done
        syncQueue((items) =>
          items.map((item) =>
            item.id === itemId ? { ...item, status: "complete" as UploadStatus, progress: 100 } : item
          )
        );
        onRefresh();
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Failed.";
        syncQueue((items) =>
          items.map((item) =>
            item.id === itemId ? { ...item, status: "error" as UploadStatus, error: reason } : item
          )
        );

        // Preserve failed file-backed sources so they remain visible in the Sources
        // tab instead of silently disappearing after client-side upload errors.
        if (nextItem.kind === "file") {
          const match = queueRef.current.find((i) => i.id === itemId && i.kind === "file");
          const sourceId = match?.kind === "file" ? match.sourceId : undefined;
          if (sourceId) {
            try {
              await failSource(sourceId, reason);
              onRefresh();
            } catch (failErr) {
              const failReason = failErr instanceof Error ? failErr.message : "Unknown error";
              setStatusMessage({
                text: `Upload failed, and Caddie could not mark the source as failed automatically: ${failReason}`,
                type: "error",
              });
            }
          }
        }
      }
    }

    isProcessingRef.current = false;
  }, [hubId, onRefresh, syncQueue]);

  // Trigger processing whenever pending items appear in the queue
  useEffect(() => {
    if (queue.some((item) => item.status === "pending")) {
      processQueue();
    }
  }, [queue, processQueue]);

  const addFiles = useCallback((files: FileList | File[], sourceKind: FileQueueItem["sourceKind"]) => {
    const newItems: QueueItem[] = [];
    const config = getFileModeConfig(sourceKind);
    const rejected: string[] = [];
    const candidates = Array.from(files);
    const selectedFiles = config.allowMultiple ? candidates : candidates.slice(0, 1);
    for (const file of selectedFiles) {
      if (!isAcceptedFile(file, config.acceptedExtensions, config.acceptedMimeTypes)) continue;
      if (file.size > config.maxSize) { rejected.push(file.name); continue; }
      newItems.push({
        kind: "file",
        sourceKind,
        id: `upload-${++queueIdCounter}`,
        label: file.name,
        size: file.size,
        file,
        status: "pending",
        progress: 0,
        youtubeSourceId: youtubeFallbackSource?.id,
      });
    }
    if (!config.allowMultiple && candidates.length > 1) {
      setStatusMessage({
        text: sourceKind === "youtube_fallback"
          ? "Upload one audio or video file at a time for this YouTube recovery."
          : "Upload one audio or video file at a time for each manual media import.",
        type: "error",
      });
    }
    if (rejected.length > 0) {
      setStatusMessage({
        text: sourceKind === "document"
          ? `${rejected.join(", ")} exceeded the ${config.tooLargeLabel} limit`
          : `${rejected.join(", ")} exceeded the ${config.tooLargeLabel} raw size limit for browser compression`,
        type: "error",
      });
    }
    if (newItems.length === 0 && rejected.length === 0) {
      setStatusMessage({
        text: config.unsupportedMessage,
        type: "error",
      });
      return;
    }
    if (newItems.length === 0) return;
    setQueue((prev) => [...prev, ...newItems]);
  }, [youtubeFallbackSource?.id]);

  const addWebUrl = useCallback(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      setStatusMessage({ text: "Enter a URL to ingest.", type: "error" });
      return;
    }
    if (queueRef.current.some((i) => "url" in i && i.url === trimmed && i.status !== "error" && i.status !== "complete")) {
      setStatusMessage({ text: "That URL is already in the queue.", type: "error" });
      return;
    }
    setQueue((prev) => {
      if (prev.some((i) => "url" in i && i.url === trimmed && i.status !== "error" && i.status !== "complete")) {
        return prev;
      }
      return [...prev, {
        kind: "webpage" as const,
        id: `web-${++queueIdCounter}`,
        label: trimmed,
        url: trimmed,
        status: "pending" as UploadStatus,
        progress: 0,
      }];
    });
    setUrl("");
  }, [url]);

  const addYouTubeUrl = useCallback(() => {
    if (isAddingYouTubeUrlRef.current) {
      return;
    }
    const trimmed = youtubeUrl.trim();
    if (!trimmed) {
      setStatusMessage({ text: "Enter a YouTube URL to ingest.", type: "error" });
      return;
    }
    if (
      queuedYoutubeUrlsRef.current.has(trimmed)
      || queueRef.current.some((i) => "url" in i && i.url === trimmed && i.status !== "error" && i.status !== "complete")
    ) {
      setStatusMessage({ text: "That URL is already in the queue.", type: "error" });
      return;
    }
    queuedYoutubeUrlsRef.current.add(trimmed);
    isAddingYouTubeUrlRef.current = true;
    setQueue((prev) => {
      if (prev.some((i) => "url" in i && i.url === trimmed && i.status !== "error" && i.status !== "complete")) {
        return prev;
      }
      return [...prev, {
        kind: "youtube" as const,
        id: `yt-${++queueIdCounter}`,
        label: trimmed,
        url: trimmed,
        language: youtubeLanguage,
        allowAutoCaptions: youtubeAutoCaptions,
        status: "pending" as UploadStatus,
        progress: 0,
      }];
    });
    setYoutubeUrl("");
    setYoutubeLanguage("en");
    setYoutubeAutoCaptions(true);
  }, [youtubeUrl, youtubeLanguage, youtubeAutoCaptions]);

  const removeFromQueue = useCallback((itemId: string) => {
    setQueue((prev) => prev.filter((i) => i.id !== itemId));
  }, []);

  // Drag-and-drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(
        e.dataTransfer.files,
        isYouTubeFallbackMode ? "youtube_fallback" : activeTab === "youtube" ? "manual_media" : "document",
      );
    }
  }, [activeTab, addFiles, isYouTubeFallbackMode]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(
        e.target.files,
        isYouTubeFallbackMode ? "youtube_fallback" : activeTab === "youtube" ? "manual_media" : "document",
      );
      e.target.value = "";
    }
  }, [activeTab, addFiles, isYouTubeFallbackMode]);

  const handleClose = () => {
    // Don't clear queue — uploads continue in the background
    setUrl("");

    setYoutubeUrl("");
    setYoutubeLanguage("en");
    setYoutubeAutoCaptions(true);
    setYouTubeImportMode("link");

    setStatusMessage(null);
    setActiveTab("upload");
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) handleClose();
  };

  const pendingCount = queue.filter((item) =>
    item.status === "pending" || item.status === "preparing" || item.status === "uploading" || item.status === "creating" || item.status === "enqueuing"
  ).length;
  const completedCount = queue.filter((item) => item.status === "complete").length;
  const allDone = queue.length > 0 && pendingCount === 0 && completedCount > 0;

  if (!open) return null;

  const activeUploadKind: FileQueueItem["sourceKind"] = isYouTubeFallbackMode
    ? "youtube_fallback"
    : activeTab === "youtube"
      ? "manual_media"
      : "document";
  const activeUploadConfig = getFileModeConfig(activeUploadKind);

  const queueItemIcon = (item: QueueItem) => {
    if (item.status === "complete") return <CheckCircleIcon className="add-source-modal__queue-item-done" />;
    if (item.status === "error") return <ExclamationCircleIcon className="add-source-modal__queue-item-error-icon" />;
    if (item.kind === "webpage") return <GlobeAltIcon className="add-source-modal__queue-item-icon" />;
    if (item.kind === "youtube") return <PlayCircleIcon className="add-source-modal__queue-item-icon" />;
    if (item.sourceKind !== "document") return <PlayCircleIcon className="add-source-modal__queue-item-icon" />;
    return <DocumentTextIcon className="add-source-modal__queue-item-icon" />;
  };

  const queueItemMeta = (item: QueueItem) => {
    if (item.kind === "file") {
      return (
        <>
          {item.sourceKind === "youtube_fallback"
            ? "YouTube Recovery"
            : item.sourceKind === "manual_media"
              ? "Manual Media Upload"
              : formatFileSize(item.size)}
          {item.status === "preparing" && " · Compressing..."}
          {item.status === "uploading" && ` \u00b7 ${item.progress}%`}
          {item.status === "enqueuing" && " \u00b7 Processing..."}
          {item.status === "error" && ` \u00b7 ${item.error ?? "Failed"}`}
        </>
      );
    }
    const typeLabel = item.kind === "webpage" ? "Webpage" : "YouTube";
    if (item.status === "creating" || item.status === "uploading") return `${typeLabel} \u00b7 Importing...`;
    if (item.status === "error") return `${typeLabel} \u00b7 ${item.error ?? "Failed"}`;
    if (item.status === "complete") return typeLabel;
    return `${typeLabel} \u00b7 Queued`;
  };

  return (
    <div className="modal-backdrop" ref={backdropRef} onClick={handleBackdropClick}>
      <div className="modal add-source-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="add-source-modal__header">
          <div>
            <h2 className="add-source-modal__title">Add Source</h2>
            <p className="add-source-modal__subtitle">
              {isYouTubeFallbackMode ? "Upload audio or video to recover a failed YouTube import." : "Import documents, webpages, or videos into your hub."}
            </p>
          </div>
          <button
            type="button"
            className="add-source-modal__close"
            onClick={handleClose}
            aria-label="Close"
          >
            <XMarkIcon className="add-source-modal__close-icon" />
          </button>
        </div>

        {/* Tabs */}
        {!isYouTubeFallbackMode && (
          <div className="add-source-modal__tabs">
            {([
              { key: "upload" as ModalTab, label: "Upload Documents", Icon: DocumentTextIcon },
              { key: "webpage" as ModalTab, label: "Webpage Link", Icon: GlobeAltIcon },
              { key: "youtube" as ModalTab, label: "Video/Audio", Icon: PlayCircleIcon },
            ]).map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                className={`add-source-modal__tab${activeTab === key ? " add-source-modal__tab--active" : ""}`}
                onClick={() => setActiveTab(key)}
              >
                <Icon className="add-source-modal__tab-icon" />
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Tab content */}
        <div className="add-source-modal__body">
          {statusMessage && (
            <p className={`add-source-modal__status add-source-modal__status--${statusMessage.type}`}>
              {statusMessage.text}
            </p>
          )}

          {activeTab === "upload" && (
            <label
              className={`add-source-modal__dropzone${isDragOver ? " add-source-modal__dropzone--active" : ""}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <CloudArrowUpIcon className="add-source-modal__dropzone-icon" />
              <p className="add-source-modal__dropzone-text">
                {activeUploadConfig.dropzoneTitle}
              </p>
              <p className="add-source-modal__dropzone-hint">
                {activeUploadConfig.acceptsLabel}
              </p>
              {isYouTubeFallbackMode && (
                <div className="add-source-modal__info-note">
                  <InformationCircleIcon className="add-source-modal__info-note-icon" />
                  <p>
                    This upload will be linked to the failed YouTube source{youtubeFallbackSource ? `: ${youtubeFallbackSource.original_name}.` : "."}
                    {" "}Only upload media you own or have permission to transcribe.
                  </p>
                </div>
              )}
              <input
                type="file"
                multiple={activeUploadConfig.allowMultiple}
                accept={activeUploadConfig.acceptedExtensions.join(",")}
                onChange={handleFileInputChange}
                className="add-source-modal__file-input"
              />
            </label>
          )}

          {activeTab === "webpage" && (
            <div className="add-source-modal__link-section">
              <div className="add-source-modal__field">
                <label className="add-source-modal__field-label">URL</label>
                <p className="add-source-modal__field-hint">We&apos;ll fetch and index the page content for semantic search.</p>
                <input
                  type="url"
                  className="add-source-modal__field-input"
                  placeholder="https://example.com/article"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addWebUrl(); }}
                />
              </div>
              <div className="add-source-modal__footer-row">
                <div className="add-source-modal__info-note">
                  <InformationCircleIcon className="add-source-modal__info-note-icon" />
                  <p>Webpages are cleaned of ads and navigation. This may take up to 30 seconds.</p>
                </div>
                <button
                  type="button"
                  className="button button--primary add-source-modal__submit"
                  onClick={addWebUrl}
                  disabled={!url.trim()}
                >
                  Import
                </button>
              </div>
            </div>
          )}

          {activeTab === "youtube" && (
            <div className="add-source-modal__link-section">
              <div className="add-source-modal__choice-row">
                <button
                  type="button"
                  className={`add-source-modal__choice${youtubeImportMode === "link" ? " add-source-modal__choice--active" : ""}`}
                  onClick={() => setYouTubeImportMode("link")}
                >
                  <span className="add-source-modal__choice-title">Import from YouTube link</span>
                </button>
                <button
                  type="button"
                  className={`add-source-modal__choice${youtubeImportMode === "manual" ? " add-source-modal__choice--active" : ""}`}
                  onClick={() => setYouTubeImportMode("manual")}
                >
                  <span className="add-source-modal__choice-title">Upload Video/Audio manually</span>
                </button>
              </div>
              {youtubeImportMode === "link" ? (
                <>
                  <div className="add-source-modal__field">
                    <label className="add-source-modal__field-label">YouTube URL</label>
                    <p className="add-source-modal__field-hint">We&apos;ll extract and index the video&apos;s captions for semantic search.</p>
                    <input
                      type="url"
                      className="add-source-modal__field-input"
                      placeholder="https://youtube.com/watch?v=..."
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") addYouTubeUrl(); }}
                    />
                  </div>
                  <div className="add-source-modal__options-inline">
                    <div className="add-source-modal__option-inline">
                      <label className="add-source-modal__option-label" htmlFor="yt-language">Language</label>
                      <input
                        id="yt-language"
                        type="text"
                        className="add-source-modal__option-input"
                        value={youtubeLanguage}
                        onChange={(e) => setYoutubeLanguage(e.target.value)}
                        placeholder="en"
                      />
                    </div>
                    <div className="add-source-modal__option-inline">
                      <label className="add-source-modal__option-label" htmlFor="yt-auto-captions">Auto-captions</label>
                      <button
                        id="yt-auto-captions"
                        type="button"
                        role="switch"
                        aria-checked={youtubeAutoCaptions}
                        className={`add-source-modal__toggle${youtubeAutoCaptions ? " add-source-modal__toggle--on" : ""}`}
                        onClick={() => setYoutubeAutoCaptions(!youtubeAutoCaptions)}
                      >
                        <span className="add-source-modal__toggle-thumb" />
                      </button>
                    </div>
                  </div>
                  <div className="add-source-modal__footer-row">
                    <div className="add-source-modal__info-note">
                      <InformationCircleIcon className="add-source-modal__info-note-icon" />
                      <p>Faster when captions are available; if import fails, you can upload media manually. Only add YouTube videos you own or have permission to transcribe.</p>
                    </div>
                    <button
                      type="button"
                      className="button button--primary add-source-modal__submit"
                      onClick={addYouTubeUrl}
                      disabled={!youtubeUrl.trim()}
                    >
                      Import
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label
                    className={`add-source-modal__dropzone${isDragOver ? " add-source-modal__dropzone--active" : ""}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <CloudArrowUpIcon className="add-source-modal__dropzone-icon" />
                    <p className="add-source-modal__dropzone-text">{getFileModeConfig("manual_media").dropzoneTitle}</p>
                    <p className="add-source-modal__dropzone-hint">{getFileModeConfig("manual_media").acceptsLabel}</p>
                    <input
                      type="file"
                      multiple={getFileModeConfig("manual_media").allowMultiple}
                      accept={getFileModeConfig("manual_media").acceptedExtensions.join(",")}
                      onChange={handleFileInputChange}
                      className="add-source-modal__file-input"
                    />
                  </label>
                  <div className="add-source-modal__info-note">
                    <InformationCircleIcon className="add-source-modal__info-note-icon" />
                    <p>Upload a media file directly and Caddie will transcribe it. Only add files you own or have permission to transcribe.</p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Shared queue — visible on all tabs */}
        {queue.length > 0 && (
          <div className="add-source-modal__queue">
            <div className="add-source-modal__queue-header">
              <span className="add-source-modal__queue-label">
                {allDone ? "Imports Complete" : "Importing"}
              </span>
              <span className="add-source-modal__queue-count">
                {allDone
                  ? `${completedCount} source${completedCount !== 1 ? "s" : ""}`
                  : `${completedCount} of ${queue.length} complete`}
              </span>
            </div>
            <ul className="add-source-modal__queue-list">
              {[...queue].reverse().map((item) => (
                <li key={item.id} className="add-source-modal__queue-item">
                  <div className="add-source-modal__queue-item-info">
                    {queueItemIcon(item)}
                    <div className="add-source-modal__queue-item-details">
                      <span className="add-source-modal__queue-item-name">{item.label}</span>
                      <span className="add-source-modal__queue-item-meta">
                        {queueItemMeta(item)}
                      </span>
                    </div>
                  </div>
                  {(item.status === "pending" || item.status === "error") && (
                    <button
                      type="button"
                      className="add-source-modal__queue-remove"
                      onClick={() => removeFromQueue(item.id)}
                    >
                      Remove
                    </button>
                  )}
                  {item.kind === "file" && (item.status === "uploading" || item.status === "enqueuing") && (
                    <div className="add-source-modal__progress-bar">
                      <div
                        className="add-source-modal__progress-fill"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
