'use client';

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
  createWebSource,
  createYouTubeSource,
  deleteSource,
  enqueueSource,
} from "../lib/api";

type UploadStatus = "pending" | "uploading" | "enqueuing" | "complete" | "error";

interface FileQueueItem {
  kind: "file";
  id: string;
  label: string;
  size: number;
  file: File;
  status: UploadStatus;
  progress: number;
  error?: string;
  sourceId?: string;
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
}

type ModalTab = "upload" | "webpage" | "youtube";

function resolveContentType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "pdf": return "application/pdf";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "txt":
    case "md": return "text/plain";
    default: return "application/octet-stream";
  }
}

const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];
const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];

function isAcceptedFile(file: File): boolean {
  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  return ACCEPTED_EXTENSIONS.includes(ext) || ACCEPTED_MIME_TYPES.includes(file.type);
}

let queueIdCounter = 0;

export function AddSourceModal({ hubId, open, onClose, onRefresh }: Props) {
  const [activeTab, setActiveTab] = useState<ModalTab>("upload");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [url, setUrl] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeAutoCaptions, setYoutubeAutoCaptions] = useState(true);
  const [youtubeLanguage, setYoutubeLanguage] = useState("en");
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isProcessingRef = useRef(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Auto-dismiss status messages
  useEffect(() => {
    if (!statusMessage) return;
    const timeout = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  // Clear completed uploads when modal opens
  useEffect(() => {
    if (open) {
      setQueue((prev) => prev.filter((item) => item.status !== "complete" && item.status !== "error"));
    }
  }, [open]);

  // Process queue sequentially — handles all source types
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    while (true) {
      let nextItem: QueueItem | undefined;
      setQueue((prev) => {
        nextItem = prev.find((item) => item.status === "pending");
        return prev;
      });

      // Need to await a tick for setState to flush
      await new Promise((r) => setTimeout(r, 0));

      setQueue((prev) => {
        nextItem = prev.find((item) => item.status === "pending");
        return prev;
      });

      if (!nextItem) break;

      const itemId = nextItem.id;

      // Mark as uploading
      setQueue((prev) =>
        prev.map((item) =>
          item.id === itemId ? { ...item, status: "uploading" as UploadStatus, progress: 0 } : item
        )
      );

      try {
        if (nextItem.kind === "file") {
          const file = nextItem.file;

          // Step 1: Create source record and get upload URL
          const enqueueResult = await createSource({ hub_id: hubId, original_name: file.name });
          const contentType = resolveContentType(file);

          // Track the backend source ID so we can clean up on failure
          setQueue((prev) =>
            prev.map((item) =>
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
                setQueue((prev) =>
                  prev.map((item) =>
                    item.id === itemId ? { ...item, progress: pct } : item
                  )
                );
              }
            };

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
              } else {
                reject(new Error(`Upload failed with status ${xhr.status}`));
              }
            };
            xhr.onerror = () => reject(new Error("Upload failed — network error"));
            xhr.send(file);
          });

          // Step 3: Enqueue for processing
          setQueue((prev) =>
            prev.map((item) =>
              item.id === itemId ? { ...item, status: "enqueuing" as UploadStatus, progress: 100 } : item
            )
          );
          await enqueueSource(enqueueResult.source.id);
        } else if (nextItem.kind === "webpage") {
          let finalUrl = nextItem.url;
          if (!/^https?:\/\//i.test(finalUrl)) {
            finalUrl = `https://${finalUrl}`;
          }
          await createWebSource({ hub_id: hubId, url: finalUrl });
        } else if (nextItem.kind === "youtube") {
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
        setQueue((prev) =>
          prev.map((item) =>
            item.id === itemId ? { ...item, status: "complete" as UploadStatus, progress: 100 } : item
          )
        );
        onRefresh();
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Failed.";
        setQueue((prev) =>
          prev.map((item) =>
            item.id === itemId ? { ...item, status: "error" as UploadStatus, error: reason } : item
          )
        );
      }
    }

    isProcessingRef.current = false;
  }, [hubId, onRefresh]);

  // Trigger processing whenever pending items appear in the queue
  useEffect(() => {
    if (queue.some((item) => item.status === "pending")) {
      processQueue();
    }
  }, [queue, processQueue]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const newItems: QueueItem[] = [];
    for (const file of Array.from(files)) {
      if (!isAcceptedFile(file)) continue;
      newItems.push({
        kind: "file",
        id: `upload-${++queueIdCounter}`,
        label: file.name,
        size: file.size,
        file,
        status: "pending",
        progress: 0,
      });
    }
    if (newItems.length === 0) {
      setStatusMessage({ text: "No supported files selected. Accepted: PDF, DOCX, TXT, MD.", type: "error" });
      return;
    }
    setQueue((prev) => [...prev, ...newItems]);
  }, []);

  const addWebUrl = useCallback(() => {
    if (!url.trim()) {
      setStatusMessage({ text: "Enter a URL to ingest.", type: "error" });
      return;
    }
    setQueue((prev) => [...prev, {
      kind: "webpage" as const,
      id: `web-${++queueIdCounter}`,
      label: url.trim(),
      url: url.trim(),
      status: "pending" as UploadStatus,
      progress: 0,
    }]);
    setUrl("");
  }, [url]);

  const addYouTubeUrl = useCallback(() => {
    if (!youtubeUrl.trim()) {
      setStatusMessage({ text: "Enter a YouTube URL to ingest.", type: "error" });
      return;
    }
    setQueue((prev) => [...prev, {
      kind: "youtube" as const,
      id: `yt-${++queueIdCounter}`,
      label: youtubeUrl.trim(),
      url: youtubeUrl.trim(),
      language: youtubeLanguage,
      allowAutoCaptions: youtubeAutoCaptions,
      status: "pending" as UploadStatus,
      progress: 0,
    }]);
    setYoutubeUrl("");
    setYoutubeLanguage("en");
    setYoutubeAutoCaptions(true);
  }, [youtubeUrl, youtubeLanguage, youtubeAutoCaptions]);

  const removeFromQueue = useCallback((itemId: string) => {
    setQueue((prev) => {
      const item = prev.find((i) => i.id === itemId);
      // Clean up orphaned backend record for failed file uploads
      if (item?.kind === "file" && item.sourceId && item.status === "error") {
        deleteSource(item.sourceId).then(() => onRefresh()).catch(() => {});
      }
      return prev.filter((i) => i.id !== itemId);
    });
  }, [onRefresh]);

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
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = "";
    }
  }, [addFiles]);

  const handleClose = () => {
    // Don't clear queue — uploads continue in the background
    setUrl("");

    setYoutubeUrl("");
    setYoutubeLanguage("en");
    setYoutubeAutoCaptions(true);

    setStatusMessage(null);
    setActiveTab("upload");
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) handleClose();
  };

  const pendingCount = queue.filter((item) => item.status === "pending" || item.status === "uploading" || item.status === "enqueuing").length;
  const completedCount = queue.filter((item) => item.status === "complete").length;
  const allDone = queue.length > 0 && pendingCount === 0;

  if (!open) return null;

  const queueItemIcon = (item: QueueItem) => {
    if (item.status === "complete") return <CheckCircleIcon className="add-source-modal__queue-item-done" />;
    if (item.status === "error") return <ExclamationCircleIcon className="add-source-modal__queue-item-error-icon" />;
    if (item.kind === "webpage") return <GlobeAltIcon className="add-source-modal__queue-item-icon" />;
    if (item.kind === "youtube") return <PlayCircleIcon className="add-source-modal__queue-item-icon" />;
    return <DocumentTextIcon className="add-source-modal__queue-item-icon" />;
  };

  const queueItemMeta = (item: QueueItem) => {
    if (item.kind === "file") {
      return (
        <>
          {formatFileSize(item.size)}
          {item.status === "uploading" && ` \u00b7 ${item.progress}%`}
          {item.status === "enqueuing" && " \u00b7 Processing..."}
          {item.status === "error" && ` \u00b7 ${item.error ?? "Failed"}`}
        </>
      );
    }
    const typeLabel = item.kind === "webpage" ? "Webpage" : "YouTube";
    if (item.status === "uploading") return `${typeLabel} \u00b7 Importing...`;
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
            <p className="add-source-modal__subtitle">Import documents, webpages, or videos into your hub.</p>
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
        <div className="add-source-modal__tabs">
          {([
            { key: "upload" as ModalTab, label: "Upload Documents", Icon: DocumentTextIcon },
            { key: "webpage" as ModalTab, label: "Webpage Link", Icon: GlobeAltIcon },
            { key: "youtube" as ModalTab, label: "YouTube Video", Icon: PlayCircleIcon },
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
              <p className="add-source-modal__dropzone-text">Click or drag and drop files</p>
              <p className="add-source-modal__dropzone-hint">PDF, TXT, MD, or DOCX files up to 50MB</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.md"
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
                <button
                  type="button"
                  className="button button--primary add-source-modal__submit"
                  onClick={addYouTubeUrl}
                  disabled={!youtubeUrl.trim()}
                >
                  Import
                </button>
              </div>
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