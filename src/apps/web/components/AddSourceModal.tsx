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
} from "@heroicons/react/24/outline";
import {
  createSource,
  createWebSource,
  createYouTubeSource,
  enqueueSource,
} from "../lib/api";

type UploadStatus = "pending" | "uploading" | "enqueuing" | "complete" | "error";

interface FileQueueItem {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number;
  error?: string;
}

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
  const [queue, setQueue] = useState<FileQueueItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [url, setUrl] = useState("");
  const [isSubmittingUrl, setIsSubmittingUrl] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeAutoCaptions, setYoutubeAutoCaptions] = useState(true);
  const [isSubmittingYoutube, setIsSubmittingYoutube] = useState(false);
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

  // Process upload queue sequentially
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    while (true) {
      let nextItem: FileQueueItem | undefined;
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
      const file = nextItem.file;

      // Mark as uploading
      setQueue((prev) =>
        prev.map((item) =>
          item.id === itemId ? { ...item, status: "uploading" as UploadStatus, progress: 0 } : item
        )
      );

      try {
        // Step 1: Create source record and get upload URL
        const enqueueResult = await createSource({ hub_id: hubId, original_name: file.name });
        const contentType = resolveContentType(file);

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

        // Done
        setQueue((prev) =>
          prev.map((item) =>
            item.id === itemId ? { ...item, status: "complete" as UploadStatus, progress: 100 } : item
          )
        );
        onRefresh();
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Upload failed.";
        setQueue((prev) =>
          prev.map((item) =>
            item.id === itemId ? { ...item, status: "error" as UploadStatus, error: reason } : item
          )
        );
      }
    }

    isProcessingRef.current = false;
  }, [hubId, onRefresh]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const newItems: FileQueueItem[] = [];
    for (const file of Array.from(files)) {
      if (!isAcceptedFile(file)) continue;
      newItems.push({
        id: `upload-${++queueIdCounter}`,
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
    // Kick off processing after state update
    setTimeout(() => processQueue(), 0);
  }, [processQueue]);

  const removeFromQueue = useCallback((itemId: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== itemId));
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
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = "";
    }
  }, [addFiles]);

  // Web URL submission
  const handleSubmitUrl = async () => {
    if (!url.trim()) {
      setStatusMessage({ text: "Enter a URL to ingest.", type: "error" });
      return;
    }
    let finalUrl = url.trim();
    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = `https://${finalUrl}`;
    }
    setIsSubmittingUrl(true);
    try {
      await createWebSource({ hub_id: hubId, url: finalUrl });
      setStatusMessage({ text: "URL enqueued. Processing will start shortly.", type: "success" });
      setUrl("");
      onRefresh();
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: "error" });
    } finally {
      setIsSubmittingUrl(false);
    }
  };

  // YouTube submission
  const handleSubmitYoutube = async () => {
    if (!youtubeUrl.trim()) {
      setStatusMessage({ text: "Enter a YouTube URL to ingest.", type: "error" });
      return;
    }
    let finalYtUrl = youtubeUrl.trim();
    if (!/^https?:\/\//i.test(finalYtUrl)) {
      finalYtUrl = `https://${finalYtUrl}`;
    }
    setIsSubmittingYoutube(true);
    try {
      await createYouTubeSource({
        hub_id: hubId,
        url: finalYtUrl,
        allow_auto_captions: youtubeAutoCaptions,
      });
      setStatusMessage({ text: "YouTube video enqueued. Processing will start shortly.", type: "success" });
      setYoutubeUrl("");
      setYoutubeAutoCaptions(true);
      onRefresh();
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, type: "error" });
    } finally {
      setIsSubmittingYoutube(false);
    }
  };

  const handleClose = () => {
    // Only close if no uploads are actively in progress
    const hasActive = queue.some((item) => item.status === "uploading" || item.status === "enqueuing");
    if (hasActive) {
      if (!window.confirm("Uploads are still in progress. Close anyway?")) return;
    }
    setQueue([]);
    setUrl("");
    setYoutubeUrl("");
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

  if (!open) return null;

  return (
    <div className="modal-backdrop" ref={backdropRef} onClick={handleBackdropClick}>
      <div className="modal add-source-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="add-source-modal__header">
          <div>
            <h2 className="add-source-modal__title">Add Source</h2>
            <p className="add-source-modal__subtitle">Upload your documents to the archive.</p>
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
            <>
              {/* Drop zone */}
              <div
                className={`add-source-modal__dropzone${isDragOver ? " add-source-modal__dropzone--active" : ""}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <CloudArrowUpIcon className="add-source-modal__dropzone-icon" />
                <p className="add-source-modal__dropzone-text">Drag and drop your files</p>
                <p className="add-source-modal__dropzone-hint">PDF, TXT, MD, or DOCX files up to 50MB</p>
                <button
                  type="button"
                  className="button button--primary add-source-modal__browse-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Browse Files
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,.md"
                  onChange={handleFileInputChange}
                  style={{ display: "none" }}
                />
              </div>

              {/* Upload queue */}
              {queue.length > 0 && (
                <div className="add-source-modal__queue">
                  <div className="add-source-modal__queue-header">
                    <span className="add-source-modal__queue-label">Active Uploads</span>
                    <span className="add-source-modal__queue-count">
                      {pendingCount > 0 ? `${pendingCount} remaining` : `${completedCount} complete`}
                    </span>
                  </div>
                  <ul className="add-source-modal__queue-list">
                    {queue.map((item) => (
                      <li key={item.id} className="add-source-modal__queue-item">
                        <div className="add-source-modal__queue-item-info">
                          <DocumentTextIcon className="add-source-modal__queue-item-icon" />
                          <div className="add-source-modal__queue-item-details">
                            <span className="add-source-modal__queue-item-name">{item.file.name}</span>
                            <span className="add-source-modal__queue-item-meta">
                              {formatFileSize(item.file.size)}
                              {item.status === "uploading" && ` \u00b7 ${item.progress}% uploaded`}
                              {item.status === "enqueuing" && " \u00b7 Processing..."}
                              {item.status === "complete" && " \u00b7 Complete"}
                              {item.status === "error" && ` \u00b7 ${item.error ?? "Failed"}`}
                            </span>
                          </div>
                        </div>
                        <div className="add-source-modal__queue-item-right">
                          {item.status === "complete" && (
                            <CheckCircleIcon className="add-source-modal__queue-item-done" />
                          )}
                          {item.status === "error" && (
                            <ExclamationCircleIcon className="add-source-modal__queue-item-error-icon" />
                          )}
                          {(item.status === "pending" || item.status === "error") && (
                            <button
                              type="button"
                              className="add-source-modal__queue-cancel"
                              onClick={() => removeFromQueue(item.id)}
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                        {(item.status === "uploading" || item.status === "enqueuing") && (
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
            </>
          )}

          {activeTab === "webpage" && (
            <div className="add-source-modal__link-section">
              <div className="add-source-modal__link-row">
                <GlobeAltIcon className="add-source-modal__link-icon" />
                <input
                  type="url"
                  className="add-source-modal__link-input"
                  placeholder="https://example.com/article"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSubmitUrl(); }}
                />
                <button
                  type="button"
                  className="button button--secondary add-source-modal__link-btn"
                  onClick={handleSubmitUrl}
                  disabled={isSubmittingUrl || !url.trim()}
                >
                  {isSubmittingUrl ? "Fetching..." : "Fetch"}
                </button>
              </div>
            </div>
          )}

          {activeTab === "youtube" && (
            <div className="add-source-modal__link-section">
              <div className="add-source-modal__link-row">
                <PlayCircleIcon className="add-source-modal__link-icon" />
                <input
                  type="url"
                  className="add-source-modal__link-input"
                  placeholder="https://youtube.com/watch?v=..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSubmitYoutube(); }}
                />
                <button
                  type="button"
                  className="button button--secondary add-source-modal__link-btn"
                  onClick={handleSubmitYoutube}
                  disabled={isSubmittingYoutube || !youtubeUrl.trim()}
                >
                  {isSubmittingYoutube ? "Importing..." : "Import"}
                </button>
              </div>
              <label className="add-source-modal__checkbox-label">
                <input
                  type="checkbox"
                  checked={youtubeAutoCaptions}
                  onChange={(e) => setYoutubeAutoCaptions(e.target.checked)}
                />
                <span>Allow auto-generated captions</span>
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="add-source-modal__footer">
          <button
            type="button"
            className="button button--secondary"
            onClick={handleClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
