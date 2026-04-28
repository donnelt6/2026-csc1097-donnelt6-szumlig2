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
    acceptsLabel: "MP3, MP4, or M4A files. Files above 20MB are compressed before upload.",
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
  const isMountedRef = useRef(true);
  const statusTimeoutRef = useRef<number | null>(null);
  const activeUploadXhrsRef = useRef(new Set<XMLHttpRequest>());

  const setQueueIfMounted = useCallback((updater: (items: QueueItem[]) => QueueItem[]) => {
    if (!isMountedRef.current) return;
    setQueue(updater);
  }, []);

  const setStatusMessageIfMounted = useCallback((message: StatusMessage | null) => {
    if (!isMountedRef.current) return;
    setStatusMessage(message);
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      isProcessingRef.current = false;
      if (statusTimeoutRef.current !== null) {
        window.clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = null;
      }
      for (const xhr of activeUploadXhrsRef.current) {
        xhr.abort();
      }
      activeUploadXhrsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (statusTimeoutRef.current !== null) {
      window.clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = null;
    }
    if (!statusMessage) return;
    statusTimeoutRef.current = window.setTimeout(() => {
      statusTimeoutRef.current = null;
      setStatusMessageIfMounted(null);
    }, 5000);
    return () => {
      if (statusTimeoutRef.current !== null) {
        window.clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = null;
      }
    };
  }, [setStatusMessageIfMounted, statusMessage]);

  // Drop finished rows when the modal opens again so the queue shows only active work.
  useEffect(() => {
    if (open) {
      setQueueIfMounted((prev) => prev.filter((item) => item.status !== "complete" && item.status !== "error"));
    }
  }, [open, setQueueIfMounted]);

  const updateQueueItem = useCallback((itemId: string, updater: (item: QueueItem) => QueueItem) => {
    setQueueIfMounted((items) =>
      items.map((item) => (item.id === itemId ? updater(item) : item)),
    );
  }, [setQueueIfMounted]);

  const processQueueItem = useCallback(async (nextItem: QueueItem) => {
    isProcessingRef.current = true;
    const itemId = nextItem.id;
    let createdSourceId: string | undefined;

    try {
      if (nextItem.kind === "file") {
        let file = nextItem.file;
        if (nextItem.sourceKind !== "document" && mediaUploadRequiresCompression(file)) {
          updateQueueItem(itemId, (item) => ({ ...item, status: "preparing" as UploadStatus, progress: 0 }));
          file = await prepareMediaFileForUpload(file);
          updateQueueItem(itemId, (item) =>
            item.kind === "file" ? { ...item, file, label: file.name, size: file.size } : item,
          );
        }

        updateQueueItem(itemId, (item) => ({ ...item, status: "uploading" as UploadStatus, progress: 0 }));

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
        createdSourceId = enqueueResult.source.id;
        const contentType = resolveContentType(file);

        updateQueueItem(itemId, (item) =>
          item.kind === "file" ? { ...item, sourceId: createdSourceId } : item,
        );

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          activeUploadXhrsRef.current.add(xhr);
          xhr.open("PUT", enqueueResult.upload_url);
          xhr.setRequestHeader("Content-Type", contentType);

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const pct = Math.round((event.loaded / event.total) * 100);
              updateQueueItem(itemId, (item) => ({ ...item, progress: pct }));
            }
          };

          xhr.onload = () => {
            activeUploadXhrsRef.current.delete(xhr);
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(buildUploadFailureMessage(xhr)));
            }
          };
          xhr.onerror = () => {
            activeUploadXhrsRef.current.delete(xhr);
            reject(new Error("Upload failed - network error"));
          };
          xhr.send(file);
        });

        updateQueueItem(itemId, (item) => ({ ...item, status: "enqueuing" as UploadStatus, progress: 100 }));
        await enqueueSource(enqueueResult.source.id);
      } else if (nextItem.kind === "webpage") {
        updateQueueItem(itemId, (item) => ({ ...item, status: "creating" as UploadStatus, progress: 0 }));
        let finalUrl = nextItem.url;
        if (!/^https?:\/\//i.test(finalUrl)) {
          finalUrl = `https://${finalUrl}`;
        }
        await createWebSource({ hub_id: hubId, url: finalUrl });
      } else if (nextItem.kind === "youtube") {
        updateQueueItem(itemId, (item) => ({ ...item, status: "creating" as UploadStatus, progress: 0 }));
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

      updateQueueItem(itemId, (item) => ({ ...item, status: "complete" as UploadStatus, progress: 100 }));
      if (isMountedRef.current) {
        onRefresh();
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Failed.";
      updateQueueItem(itemId, (item) => ({ ...item, status: "error" as UploadStatus, error: reason }));

      if (nextItem.kind === "file") {
        if (createdSourceId) {
          try {
            await failSource(createdSourceId, reason);
            if (isMountedRef.current) {
              onRefresh();
            }
          } catch (failErr) {
            const failReason = failErr instanceof Error ? failErr.message : "Unknown error";
            setStatusMessageIfMounted({
              text: `Upload failed, and Caddie could not mark the source as failed automatically: ${failReason}`,
              type: "error",
            });
          }
        }
      }
    } finally {
      isProcessingRef.current = false;
    }
  }, [hubId, onRefresh, setStatusMessageIfMounted, updateQueueItem]);

  useEffect(() => {
    if (isProcessingRef.current) {
      return;
    }
    const nextItem = queue.find((item) => item.status === "pending");
    if (nextItem) {
      void processQueueItem(nextItem);
    }
  }, [processQueueItem, queue]);

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
      setStatusMessageIfMounted({
        text: sourceKind === "youtube_fallback"
          ? "Upload one audio or video file at a time for this YouTube recovery."
          : "Upload one audio or video file at a time for each manual media import.",
        type: "error",
      });
    }
    if (rejected.length > 0) {
      setStatusMessageIfMounted({
        text: sourceKind === "document"
          ? `${rejected.join(", ")} exceeded the ${config.tooLargeLabel} limit`
          : `${rejected.join(", ")} exceeded the ${config.tooLargeLabel} raw size limit for browser compression`,
        type: "error",
      });
    }
    if (newItems.length === 0 && rejected.length === 0) {
      setStatusMessageIfMounted({ text: config.unsupportedMessage, type: "error" });
      return false;
    }
    if (newItems.length === 0) {
      return false;
    }
    setQueueIfMounted((prev) => [...prev, ...newItems]);
    return true;
  }, [setQueueIfMounted, setStatusMessageIfMounted, youtubeFallbackSourceId]);

  const addWebUrl = useCallback((url: string) => {
    const trimmed = url.trim();
    if (!trimmed) {
      setStatusMessageIfMounted({ text: "Enter a URL to ingest.", type: "error" });
      return false;
    }
    if (queue.some((item) => "url" in item && item.url === trimmed && item.status !== "error" && item.status !== "complete")) {
      setStatusMessageIfMounted({ text: "That URL is already in the queue.", type: "error" });
      return false;
    }
    let queued = false;
    setQueueIfMounted((prev) => {
      if (prev.some((item) => "url" in item && item.url === trimmed && item.status !== "error" && item.status !== "complete")) {
        return prev;
      }
      queued = true;
      return [...prev, {
        kind: "webpage" as const,
        id: `web-${++queueIdCounter}`,
        label: trimmed,
        url: trimmed,
        status: "pending" as UploadStatus,
        progress: 0,
      }];
    });
    if (!queued) {
      setStatusMessageIfMounted({ text: "That URL is already in the queue.", type: "error" });
    }
    return queued;
  }, [queue, setQueueIfMounted, setStatusMessageIfMounted]);

  const addYouTubeUrl = useCallback(({
    url,
    language,
    allowAutoCaptions,
  }: {
    url: string;
    language: string;
    allowAutoCaptions: boolean;
  }) => {
    const trimmed = url.trim();
    if (!trimmed) {
      setStatusMessageIfMounted({ text: "Enter a YouTube URL to ingest.", type: "error" });
      return false;
    }
    if (
      queue.some((item) => "url" in item && item.url === trimmed && item.status !== "error" && item.status !== "complete")
    ) {
      setStatusMessageIfMounted({ text: "That URL is already in the queue.", type: "error" });
      return false;
    }
    let queued = false;
    setQueueIfMounted((prev) => {
      if (prev.some((item) => "url" in item && item.url === trimmed && item.status !== "error" && item.status !== "complete")) {
        return prev;
      }
      queued = true;
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
    if (!queued) {
      setStatusMessageIfMounted({ text: "That URL is already in the queue.", type: "error" });
    }
    return queued;
  }, [queue, setQueueIfMounted, setStatusMessageIfMounted]);

  const removeFromQueue = useCallback((itemId: string) => {
    setQueueIfMounted((prev) => prev.filter((item) => item.id !== itemId));
  }, [setQueueIfMounted]);

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
    clearStatusMessage: () => setStatusMessageIfMounted(null),
    completedCount,
    pendingCount,
    queue,
    removeFromQueue,
    statusMessage,
  };
}
