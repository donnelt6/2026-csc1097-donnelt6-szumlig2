'use client';

// AddSourceModal.tsx: Modal dialog for source inputs while upload orchestration lives in a dedicated hook.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, MouseEvent } from "react";
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
import type { Source } from "@shared/index";
import {
  FileQueueItem,
  formatFileSize,
  getFileModeConfig,
  QueueItem,
  useSourceUploadQueue,
} from "./source-upload/useSourceUploadQueue";

interface Props {
  hubId: string;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
  youtubeFallbackSource?: Source | null;
}

type ModalTab = "upload" | "webpage" | "youtube";
type YouTubeImportMode = "link" | "manual";

export function AddSourceModal({ hubId, open, onClose, onRefresh, youtubeFallbackSource = null }: Props) {
  const isYouTubeFallbackMode = Boolean(youtubeFallbackSource);
  const [activeTab, setActiveTab] = useState<ModalTab>("upload");
  const [youtubeImportMode, setYouTubeImportMode] = useState<YouTubeImportMode>("link");
  const [isDragOver, setIsDragOver] = useState(false);
  const [url, setUrl] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeAutoCaptions, setYoutubeAutoCaptions] = useState(true);
  const [youtubeLanguage, setYoutubeLanguage] = useState("en");
  const backdropRef = useRef<HTMLDivElement>(null);
  const {
    addFiles,
    addWebUrl,
    addYouTubeUrl,
    allDone,
    clearStatusMessage,
    completedCount,
    queue,
    removeFromQueue,
    statusMessage,
  } = useSourceUploadQueue({
    hubId,
    open,
    onRefresh,
    youtubeFallbackSourceId: youtubeFallbackSource?.id,
  });

  useEffect(() => {
    if (open && isYouTubeFallbackMode) {
      setActiveTab("upload");
    }
  }, [open, isYouTubeFallbackMode]);

  const activeUploadKind: FileQueueItem["sourceKind"] = isYouTubeFallbackMode
    ? "youtube_fallback"
    : activeTab === "youtube"
      ? "manual_media"
      : "document";
  const activeUploadConfig = getFileModeConfig(activeUploadKind);

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    if (event.dataTransfer.files.length > 0) {
      addFiles(
        event.dataTransfer.files,
        isYouTubeFallbackMode ? "youtube_fallback" : activeTab === "youtube" ? "manual_media" : "document",
      );
    }
  }, [activeTab, addFiles, isYouTubeFallbackMode]);

  const handleFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      addFiles(
        event.target.files,
        isYouTubeFallbackMode ? "youtube_fallback" : activeTab === "youtube" ? "manual_media" : "document",
      );
      event.target.value = "";
    }
  }, [activeTab, addFiles, isYouTubeFallbackMode]);

  const handleWebImport = useCallback(() => {
    if (addWebUrl(url)) {
      setUrl("");
    }
  }, [addWebUrl, url]);

  const handleYouTubeImport = useCallback(() => {
    if (addYouTubeUrl({ url: youtubeUrl, language: youtubeLanguage, allowAutoCaptions: youtubeAutoCaptions })) {
      setYoutubeUrl("");
      setYoutubeLanguage("en");
      setYoutubeAutoCaptions(true);
    }
  }, [addYouTubeUrl, youtubeAutoCaptions, youtubeLanguage, youtubeUrl]);

  const handleClose = () => {
    setUrl("");
    setYoutubeUrl("");
    setYoutubeLanguage("en");
    setYoutubeAutoCaptions(true);
    setYouTubeImportMode("link");
    clearStatusMessage();
    setActiveTab("upload");
    onClose();
  };

  const handleBackdropClick = (event: MouseEvent) => {
    if (event.target === backdropRef.current) {
      handleClose();
    }
  };

  if (!open) return null;

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
          {item.status === "preparing" && " \u00b7 Compressing..."}
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
      <div className="modal add-source-modal" onClick={(event) => event.stopPropagation()}>
        <div className="add-source-modal__header">
          <div>
            <h2 className="add-source-modal__title">Add Source</h2>
            <p className="add-source-modal__subtitle">
              {isYouTubeFallbackMode
                ? "Upload audio or video to recover a failed YouTube import."
                : "Import documents, webpages, or videos into your hub."}
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
              <p className="add-source-modal__dropzone-text">{activeUploadConfig.dropzoneTitle}</p>
              <p className="add-source-modal__dropzone-hint">{activeUploadConfig.acceptsLabel}</p>
              {isYouTubeFallbackMode && (
                <div className="add-source-modal__info-note">
                  <InformationCircleIcon className="add-source-modal__info-note-icon" />
                  <p>
                    This upload will be linked to the failed YouTube source
                    {youtubeFallbackSource ? `: ${youtubeFallbackSource.original_name}.` : "."}
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
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") handleWebImport(); }}
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
                  onClick={handleWebImport}
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
                      onChange={(event) => setYoutubeUrl(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter") handleYouTubeImport(); }}
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
                        onChange={(event) => setYoutubeLanguage(event.target.value)}
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
                      onClick={handleYouTubeImport}
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
                      <span className="add-source-modal__queue-item-meta">{queueItemMeta(item)}</span>
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
