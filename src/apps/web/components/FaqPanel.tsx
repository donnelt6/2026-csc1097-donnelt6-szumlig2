'use client';

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { archiveFaq, generateFaqs, listFaqs, updateFaq } from "../lib/api";
import type { Citation, FaqEntry } from "../lib/types";

interface Props {
  hubId: string;
  selectedSourceIds: string[];
  hasSelectableSources: boolean;
  canEdit: boolean;
}

interface DraftValues {
  question: string;
  answer: string;
}

export function FaqPanel({ hubId, selectedSourceIds, hasSelectableSources, canEdit }: Props) {
  const queryClient = useQueryClient();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftValues>>({});
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["faqs", hubId],
    queryFn: () => listFaqs(hubId),
  });

  const entries = useMemo(() => data ?? [], [data]);
  const hasSelection = selectedSourceIds.length > 0;
  const canGenerate = canEdit && hasSelection;

  const generateMutation = useMutation({
    mutationFn: () => generateFaqs({ hub_id: hubId, source_ids: selectedSourceIds }),
    onSuccess: (data) => {
      const count = data.entries.length;
      setStatusMessage(count > 0 ? "FAQs generated." : "No FAQs were generated from the selected sources.");
      queryClient.invalidateQueries({ queryKey: ["faqs", hubId] });
    },
    onError: (err) => setStatusMessage((err as Error).message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ faqId, payload }: { faqId: string; payload: Parameters<typeof updateFaq>[1] }) =>
      updateFaq(faqId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["faqs", hubId] });
    },
    onError: (err) => setStatusMessage((err as Error).message),
  });

  const archiveMutation = useMutation({
    mutationFn: (faqId: string) => archiveFaq(faqId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["faqs", hubId] });
    },
    onError: (err) => setStatusMessage((err as Error).message),
  });

  const buildDefaultDraft = (entry: FaqEntry): DraftValues => ({
    question: entry.question,
    answer: entry.answer,
  });

  const getDraft = (entry: FaqEntry) => drafts[entry.id] ?? buildDefaultDraft(entry);

  const updateDraft = (entry: FaqEntry, updates: Partial<DraftValues>) => {
    setDrafts((prev) => ({
      ...prev,
      [entry.id]: { ...(prev[entry.id] ?? buildDefaultDraft(entry)), ...updates },
    }));
  };

  const startEditing = (entry: FaqEntry) => {
    setEditingId(entry.id);
    setDrafts((prev) => ({ ...prev, [entry.id]: prev[entry.id] ?? buildDefaultDraft(entry) }));
  };

  const cancelEditing = () => {
    setEditingId(null);
  };

  const saveEditing = (entry: FaqEntry) => {
    const draft = getDraft(entry);
    updateMutation.mutate({
      faqId: entry.id,
      payload: { question: draft.question.trim(), answer: draft.answer.trim() },
    });
    setEditingId(null);
  };

  const togglePin = (entry: FaqEntry) => {
    updateMutation.mutate({ faqId: entry.id, payload: { is_pinned: !entry.is_pinned } });
  };

  const handleArchive = (entry: FaqEntry) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Archive this FAQ? You can regenerate later to restore suggestions.");
      if (!confirmed) return;
    }
    archiveMutation.mutate(entry.id);
  };

  const buttonLabel = entries.length > 0 ? "Regenerate FAQs" : "Generate FAQs";

  return (
    <div className="card grid">
      <div>
        <h3 style={{ margin: 0 }}>FAQs</h3>
        <p className="muted">Generate onboarding FAQs from your selected sources, then pin or edit them.</p>
      </div>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
        {canEdit && (
          <button className="button" onClick={() => generateMutation.mutate()} disabled={!canGenerate || generateMutation.isPending}>
            {generateMutation.isPending ? "Generating..." : buttonLabel}
          </button>
        )}
        {!hasSelectableSources && <p className="muted">Upload and process sources to generate FAQs.</p>}
        {hasSelectableSources && !hasSelection && (
          <p className="muted">Select at least one source to generate FAQs.</p>
        )}
        {!canEdit && <p className="muted">Only owners and editors can generate or edit FAQs.</p>}
      </div>
      {statusMessage && <p className="muted">{statusMessage}</p>}
      {isLoading && <p className="muted">Loading FAQs...</p>}
      {error && <p className="muted">Failed to load FAQs: {(error as Error).message}</p>}
      {!isLoading && !error && entries.length === 0 && (
        <p className="muted">No FAQs yet. Generate them from your selected sources.</p>
      )}
      <div className="grid" style={{ gap: "12px" }}>
        {entries.map((entry) => {
          const isEditing = editingId === entry.id;
          const draft = getDraft(entry);
          return (
            <div key={entry.id} className="card" style={{ borderColor: "#1e2535" }}>
              <div className="grid" style={{ gap: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                  <strong>{entry.question}</strong>
                  {canEdit && (
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button
                        className="button"
                        type="button"
                        onClick={() => togglePin(entry)}
                        disabled={updateMutation.isPending}
                      >
                        {entry.is_pinned ? "Unpin" : "Pin"}
                      </button>
                      {!isEditing && (
                        <button className="button" type="button" onClick={() => startEditing(entry)}>
                          Edit
                        </button>
                      )}
                      {isEditing && (
                        <button className="button" type="button" onClick={cancelEditing}>
                          Cancel
                        </button>
                      )}
                      <button
                        className="button"
                        type="button"
                        onClick={() => handleArchive(entry)}
                        disabled={archiveMutation.isPending}
                      >
                        Archive
                      </button>
                    </div>
                  )}
                </div>
                <p className="muted" style={{ marginTop: 0 }}>
                  Confidence {Math.round((entry.confidence || 0) * 100)}%
                </p>
                {!isEditing && <p style={{ whiteSpace: "pre-wrap" }}>{entry.answer}</p>}
                {isEditing && (
                  <div className="grid" style={{ gap: "8px" }}>
                    <label>
                      <span className="muted">Question</span>
                      <textarea
                        value={draft.question}
                        onChange={(e) => updateDraft(entry, { question: e.target.value })}
                      />
                    </label>
                    <label>
                      <span className="muted">Answer</span>
                      <textarea
                        value={draft.answer}
                        onChange={(e) => updateDraft(entry, { answer: e.target.value })}
                      />
                    </label>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        className="button"
                        type="button"
                        onClick={() => saveEditing(entry)}
                        disabled={updateMutation.isPending}
                      >
                        {updateMutation.isPending ? "Saving..." : "Save"}
                      </button>
                      <button className="button" type="button" onClick={cancelEditing}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {entry.citations.length > 0 && (
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {entry.citations.map((citation, idx) => {
                      const preview =
                        citation.snippet.length > 120 ? `${citation.snippet.slice(0, 120)}...` : citation.snippet;
                      return (
                        <button
                          key={`${citation.source_id}-${citation.chunk_index ?? idx}`}
                          onClick={() => setActiveCitation(citation)}
                          style={{
                            border: "1px solid #243145",
                            borderRadius: "10px",
                            padding: "6px 10px",
                            fontSize: "0.9rem",
                            background: "#0f1726",
                            color: "var(--text)",
                            cursor: "pointer",
                          }}
                          type="button"
                        >
                          {citation.source_id.slice(0, 6)} - {preview}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {activeCitation && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setActiveCitation(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(6, 10, 20, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            zIndex: 50,
          }}
        >
          <div
            className="card"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: "720px", width: "100%", maxHeight: "80vh", overflow: "auto" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
              <strong>Source {activeCitation.source_id.slice(0, 8)}</strong>
              <button className="button" type="button" onClick={() => setActiveCitation(null)}>
                Close
              </button>
            </div>
            <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
              {activeCitation.snippet}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
