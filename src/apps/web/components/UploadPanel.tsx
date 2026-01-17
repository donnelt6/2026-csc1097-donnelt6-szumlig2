'use client';

import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { createSource, enqueueSource } from "../lib/api";
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

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first");
      const enqueue = await createSource({ hub_id: hubId, original_name: file.name });
      await fetch(enqueue.upload_url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      await enqueueSource(enqueue.source.id);
      return enqueue.source;
    },
    onSuccess: () => {
      setStatusMessage("Upload enqueued. Processing will start shortly.");
      setFile(null);
      onRefresh();
    },
    onError: (err) => {
      setStatusMessage((err as Error).message);
    },
  });

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
