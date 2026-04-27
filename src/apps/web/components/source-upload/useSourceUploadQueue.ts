'use client';

// useSourceUploadQueue.ts: Queue state machine and upload strategies for source ingestion flows.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSource,
  createYouTubeFallbackSource,
  createWebSource,
  createYouTubeSource,
  enqueueSource,
  failSource,
} from "../../lib/api";
import {
  MEDIA_COMPRESSION_INPUT_MAX_BYTES,
  mediaUploadRequiresCompression,
  prepareMediaFileForUpload,
} from "../../lib/mediaCompression";

export type UploadStatus = "pending" | "preparing" | "uploading" | "creating" | "enqueuing" | "complete" | "error";

export interface FileQueueItem {
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

export interface WebQueueItem {
  kind: "webpage";
  id: string;
  label: string;
  url: string;
  status: UploadStatus;
  progress: number;
  error?: string;
}

export interface YouTubeQueueItem {
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

export type QueueItem = FileQueueItem | WebQueueItem | YouTubeQueueItem;

export interface StatusMessage {
  text: string;
  type: "success" | "error";
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
let queueIdCounter = 0;

export function getFileModeConfig(sourceKind: FileQueueItem["sourceKind"]) {
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

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface UseSourceUploadQueueArgs {
  hubId: string;
  open: boolean;
  onRefresh: () => void;
  youtubeFallbackSourceId?: string;
}

export function useSourceUploadQueue({
  hubId,
  open,
  onRefresh,
  youtubeFallbackSourceId,
}: UseSourceUploadQueueArgs) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const isProcessingRef = useRef(false);
  const isAddingYouTubeUrlRef = useRef(false);
  const queueRef = useRef(queue);
  const queuedYoutubeUrlsRef = useRef<Set<string>>(new Set());
  queueRef.current = queue;

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

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  // Drop finished rows when the modal opens again so the queue shows only active work.
  useEffect(() => {
    if (open) {
      setQueue((prev) => prev.filter((item) => item.status !== "complete" && item.status !== "error"));
    }
  }, [open]);

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
                item.id === itemId ? { ...item, status: "preparing" as UploadStatus, progress: 0 } : item,
              ),
            );
            file = await prepareMediaFileForUpload(file);
            syncQueue((items) =>
              items.map((item) =>
                item.id === itemId && item.kind === "file"
                  ? { ...item, file, label: file.name, size: file.size }
                  : item,
              ),
            );
          }

          syncQueue((items) =>
            items.map((item) =>
              item.id === itemId ? { ...item, status: "uploading" as UploadStatus, progress: 0 } : item,
            ),
          );

          const enqueueResult = nextItem.sourceKind === "youtube_fallback"
            ? await createYouTubeFallbackSource({
                hub_id: hubId,
                youtube_source_id: nextItem.youtubeSourceId!,
                original_name: file.name,
              })
            : await createSource(
                nextItem.sourceKind === "manual_media"
                  ? { hub_id: hubId, original_name: file.name, file_kind: "media" }
                  : { hub_id: hubId, original_name: file.name },
              );
          const contentType = resolveContentType(file);

          syncQueue((items) =>
            items.map((item) =>
              item.id === itemId && item.kind === "file" ? { ...item, sourceId: enqueueResult.source.id } : item,
            ),
          );

          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", enqueueResult.upload_url);
            xhr.setRequestHeader("Content-Type", contentType);

            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                const pct = Math.round((event.loaded / event.total) * 100);
                syncQueue((items) =>
                  items.map((item) =>
                    item.id === itemId ? { ...item, progress: pct } : item,
                  ),
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
            xhr.onerror = () => reject(new Error("Upload failed - network error"));
            xhr.send(file);
          });

          syncQueue((items) =>
            items.map((item) =>
              item.id === itemId ? { ...item, status: "enqueuing" as UploadStatus, progress: 100 } : item,
            ),
          );
          await enqueueSource(enqueueResult.source.id);
        } else if (nextItem.kind === "webpage") {
          syncQueue((items) =>
            items.map((item) =>
              item.id === itemId ? { ...item, status: "creating" as UploadStatus, progress: 0 } : item,
            ),
          );
          let finalUrl = nextItem.url;
          if (!/^https?:\/\//i.test(finalUrl)) {
            finalUrl = `https://${finalUrl}`;
          }
          await createWebSource({ hub_id: hubId, url: finalUrl });
        } else if (nextItem.kind === "youtube") {
          syncQueue((items) =>
            items.map((item) =>
              item.id === itemId ? { ...item, status: "creating" as UploadStatus, progress: 0 } : item,
            ),
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

        syncQueue((items) =>
          items.map((item) =>
            item.id === itemId ? { ...item, status: "complete" as UploadStatus, progress: 100 } : item,
          ),
        );
        onRefresh();
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Failed.";
        syncQueue((items) =>
          items.map((item) =>
            item.id === itemId ? { ...item, status: "error" as UploadStatus, error: reason } : item,
          ),
        );

        if (nextItem.kind === "file") {
          const match = queueRef.current.find((item) => item.id === itemId && item.kind === "file");
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

  useEffect(() => {
    if (queue.some((item) => item.status === "pending")) {
      void processQueue();
    }
  }, [processQueue, queue]);

  const addFiles = useCallback((files: FileList | File[], sourceKind: FileQueueItem["sourceKind"]) => {
    const newItems: QueueItem[] = [];
    const config = getFileModeConfig(sourceKind);
    const rejected: string[] = [];
    const candidates = Array.from(files);
    const selectedFiles = config.allowMultiple ? candidates : candidates.slice(0, 1);

    for (const file of selectedFiles) {
      if (!isAcceptedFile(file, config.acceptedExtensions, config.acceptedMimeTypes)) continue;
      if (file.size > config.maxSize) {
        rejected.push(file.name);
        continue;
      }
      newItems.push({
        kind: "file",
        sourceKind,
        id: `upload-${++queueIdCounter}`,
        label: file.name,
        size: file.size,
        file,
        status: "pending",
        progress: 0,
        youtubeSourceId: youtubeFallbackSourceId,
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
      setStatusMessage({ text: config.unsupportedMessage, type: "error" });
      return false;
    }
    if (newItems.length === 0) {
      return false;
    }
    setQueue((prev) => [...prev, ...newItems]);
    return true;
  }, [youtubeFallbackSourceId]);

  const addWebUrl = useCallback((url: string) => {
    const trimmed = url.trim();
    if (!trimmed) {
      setStatusMessage({ text: "Enter a URL to ingest.", type: "error" });
      return false;
    }
    if (queueRef.current.some((item) => "url" in item && item.url === trimmed && item.status !== "error" && item.status !== "complete")) {
      setStatusMessage({ text: "That URL is already in the queue.", type: "error" });
      return false;
    }
    setQueue((prev) => {
      if (prev.some((item) => "url" in item && item.url === trimmed && item.status !== "error" && item.status !== "complete")) {
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
    return true;
  }, []);

  const addYouTubeUrl = useCallback(({
    url,
    language,
    allowAutoCaptions,
  }: {
    url: string;
    language: string;
    allowAutoCaptions: boolean;
  }) => {
    if (isAddingYouTubeUrlRef.current) {
      return false;
    }
    const trimmed = url.trim();
    if (!trimmed) {
      setStatusMessage({ text: "Enter a YouTube URL to ingest.", type: "error" });
      return false;
    }
    if (
      queuedYoutubeUrlsRef.current.has(trimmed) ||
      queueRef.current.some((item) => "url" in item && item.url === trimmed && item.status !== "error" && item.status !== "complete")
    ) {
      setStatusMessage({ text: "That URL is already in the queue.", type: "error" });
      return false;
    }
    queuedYoutubeUrlsRef.current.add(trimmed);
    isAddingYouTubeUrlRef.current = true;
    setQueue((prev) => {
      if (prev.some((item) => "url" in item && item.url === trimmed && item.status !== "error" && item.status !== "complete")) {
        return prev;
      }
      return [...prev, {
        kind: "youtube" as const,
        id: `yt-${++queueIdCounter}`,
        label: trimmed,
        url: trimmed,
        language,
        allowAutoCaptions,
        status: "pending" as UploadStatus,
        progress: 0,
      }];
    });
    return true;
  }, []);

  const removeFromQueue = useCallback((itemId: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== itemId));
  }, []);

  const pendingCount = queue.filter((item) =>
    item.status === "pending" ||
    item.status === "preparing" ||
    item.status === "uploading" ||
    item.status === "creating" ||
    item.status === "enqueuing",
  ).length;
  const completedCount = queue.filter((item) => item.status === "complete").length;
  const allDone = queue.length > 0 && pendingCount === 0 && completedCount > 0;

  return {
    addFiles,
    addWebUrl,
    addYouTubeUrl,
    allDone,
    clearStatusMessage: () => setStatusMessage(null),
    completedCount,
    pendingCount,
    queue,
    removeFromQueue,
    statusMessage,
  };
}
