'use client';

import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { createSource, createSourceUploadUrl, deleteSource, enqueueSource, failSource } from "../lib/api";
import type { Source } from "../lib/types";

interface Props {
  hubId: string;
  sources: Source[];
  onRefresh: () => void;
  canUpload?: boolean;
}

export function UploadPanel({ hubId, sources, onRefresh, canUpload = true }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [retryingSourceId, setRetryingSourceId] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
  const [retryFiles, setRetryFiles] = useState<Record<string, File>>({});

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

  const sortedSources = useMemo(
    () => [...sources].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [sources]
  );

  return (
    <div className="card grid">
      <div>
        <h3 style={{ margin: 0 }}>Upload a source</h3>
        <p className="muted">PDF, DOCX, TXT, or Markdown. Progress updates appear below.</p>
      </div>
      <label>
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          accept=".pdf,.doc,.docx,.txt,.md"
          disabled={!canUpload}
        />
      </label>
      <button className="button" onClick={() => mutation.mutate()} disabled={!canUpload || mutation.isPending || !file}>
        {mutation.isPending ? "Uploading..." : "Upload"}
      </button>
      {!canUpload && <p className="muted">You only have view access. Ask the hub owner to grant edit permissions.</p>}
      {statusMessage && <p className="muted">{statusMessage}</p>}
      <div className="grid" style={{ gap: "10px" }}>
        {sortedSources.map((source) => (
          <div key={source.id} className="card" style={{ borderColor: "#1e2535" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong>{source.original_name}</strong>
                <p className="muted">{new Date(source.created_at).toLocaleString()}</p>
              </div>
              <StatusPill status={source.status} />
            </div>
            {source.failure_reason && <p className="muted">Error: {source.failure_reason}</p>}
            {source.status === "failed" && (
              <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                <button
                  className="button"
                  type="button"
                  onClick={() => handleRetryUpload(source.id)}
                  disabled={isRetrying || deletingSourceId === source.id || !retryFiles[source.id]}
                >
                  {isRetrying && retryingSourceId === source.id ? "Retrying..." : "Retry upload"}
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={() => handleDeleteSource(source.id)}
                  disabled={isRetrying || deletingSourceId === source.id}
                >
                  {deletingSourceId === source.id ? "Deleting..." : "Delete"}
                </button>
              </div>
            )}
            {source.status === "failed" && !retryFiles[source.id] && (
              <p className="muted">Retry is available until you refresh this page.</p>
            )}
          </div>
        ))}
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
    case "doc":
      return "application/msword";
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
