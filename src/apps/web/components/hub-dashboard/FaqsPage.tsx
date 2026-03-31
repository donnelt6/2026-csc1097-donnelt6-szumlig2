'use client';

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
  MapPinIcon,
  PencilSquareIcon,
  TrashIcon,
  ArrowRightIcon,
  FunnelIcon,
} from "@heroicons/react/24/outline";
import { archiveFaq, generateFaqs, listFaqs, updateFaq } from "../../lib/api";
import type { Citation, FaqEntry, Source } from "../../lib/types";

interface Props {
  hubId: string;
  sources: Source[];
  canEdit: boolean;
}

interface DraftValues {
  question: string;
  answer: string;
}

type FilterTab = 'recent' | 'pinned';

const FAQS_PER_PAGE = 6;

export function FaqsPage({ hubId, sources, canEdit }: Props) {
  const queryClient = useQueryClient();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filterTab, setFilterTab] = useState<FilterTab>('recent');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createSourceIds, setCreateSourceIds] = useState<string[]>([]);
  const [pendingGenerations, setPendingGenerations] = useState<Set<string>>(new Set());

  const [selectedFaq, setSelectedFaq] = useState<FaqEntry | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftValues>>({});
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);

  const completeSources = useMemo(() => sources.filter((s) => s.status === 'complete'), [sources]);

  const openCreateModal = () => {
    setCreateSourceIds(completeSources.map((s) => s.id));
    setShowCreateModal(true);
  };

  const toggleCreateSource = (id: string) => {
    setCreateSourceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  useEffect(() => {
    if (!statusMessage) return;
    const t = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(t);
  }, [statusMessage]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["faqs", hubId],
    queryFn: () => listFaqs(hubId),
    staleTime: 0,
  });

  const allEntries = useMemo(() => data ?? [], [data]);

  const entries = useMemo(() => {
    if (filterTab === 'pinned') return allEntries.filter((f) => f.is_pinned);
    return allEntries;
  }, [allEntries, filterTab]);

  useEffect(() => {
    setPage(1);
  }, [filterTab]);

  useEffect(() => {
    if (!selectedFaq) return;
    const fresh = allEntries.find((f) => f.id === selectedFaq.id);
    if (fresh) {
      setSelectedFaq(fresh);
    } else {
      setSelectedFaq(null);
    }
  }, [allEntries]); // eslint-disable-line react-hooks/exhaustive-deps

  const canGenerate = canEdit && createSourceIds.length > 0;

  const totalPages = Math.max(1, Math.ceil(entries.length / FAQS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pagedFaqs = entries.slice((safePage - 1) * FAQS_PER_PAGE, safePage * FAQS_PER_PAGE);

  const startGeneration = () => {
    const id = crypto.randomUUID();
    const sourceIds = [...createSourceIds];

    setPendingGenerations((prev) => new Set(prev).add(id));
    setShowCreateModal(false);

    generateFaqs({ hub_id: hubId, source_ids: sourceIds })
      .then(async (data) => {
        const count = data.entries.length;
        setStatusMessage(count > 0 ? `Generated ${count} FAQs.` : "No FAQs were generated from the selected sources.");
        await queryClient.invalidateQueries({ queryKey: ["faqs", hubId] });
      })
      .catch((err) => {
        setStatusMessage((err as Error).message);
      })
      .finally(() => {
        setPendingGenerations((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      });
  };

  const updateMutation = useMutation({
    mutationFn: ({ faqId, payload }: { faqId: string; payload: Parameters<typeof updateFaq>[1] }) =>
      updateFaq(faqId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["faqs", hubId] }),
    onError: (err) => setStatusMessage((err as Error).message),
  });

  const [archivingIds, setArchivingIds] = useState<Set<string>>(new Set());

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

  const cancelEditing = () => setEditingId(null);

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
      const confirmed = window.confirm("Archive this FAQ? You can regenerate later.");
      if (!confirmed) return;
    }
    setArchivingIds((prev) => new Set(prev).add(entry.id));
    archiveFaq(entry.id)
      .then(() => {
        setSelectedFaq((prev) => prev?.id === entry.id ? null : prev);
        queryClient.setQueryData<FaqEntry[]>(["faqs", hubId], (old) =>
          old?.filter((f) => f.id !== entry.id)
        );
      })
      .catch((err) => setStatusMessage((err as Error).message))
      .finally(() => {
        setArchivingIds((prev) => {
          const next = new Set(prev);
          next.delete(entry.id);
          return next;
        });
      });
  };

  const openFaq = (faq: FaqEntry) => {
    setSelectedFaq(faq);
    setEditingId(null);
  };

  const truncate = (text: string, max: number) =>
    text.length > max ? `${text.slice(0, max)}...` : text;

  const cardPreview = (answer: string) =>
    answer.length > 280 ? answer.slice(0, 280).trimEnd() + '...' : answer;

  const pinnedCount = allEntries.filter((f) => f.is_pinned).length;

  return (
    <div className={`hdash__faqs${totalPages > 1 ? ' hdash__faqs--with-pagination' : ''}`}>
      {statusMessage && <div className="hdash__guides-toast">{statusMessage}</div>}

      <div className="faq-toolbar">
        <div className="hubs-toolbar-tabs">
          <button
            className={`hubs-tab${filterTab === 'recent' ? ' hubs-tab--active' : ''}`}
            onClick={() => setFilterTab('recent')}
          >
            Recent
          </button>
          <button
            className={`hubs-tab${filterTab === 'pinned' ? ' hubs-tab--active' : ''}`}
            onClick={() => setFilterTab('pinned')}
          >
            Pinned{pinnedCount > 0 ? ` (${pinnedCount})` : ''}
          </button>
        </div>
        <button className="toolbar-button" type="button" disabled>
          <FunnelIcon className="toolbar-button-icon" />
        </button>
      </div>

      {canEdit && (
        <div className="faq-input-bar">
          <PlusIcon className="faq-input-bar__icon" />
          <span className="faq-input-bar__placeholder">Ask a new question...</span>
          <button
            className="faq-input-bar__generate"
            type="button"
            onClick={() => openCreateModal()}
            disabled={pendingGenerations.size > 0}
          >
            {pendingGenerations.size > 0 ? (
              <>
                <span className="gmodal__spinner gmodal__spinner--accent" />
                Generating...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
                Generate for me
              </>
            )}
          </button>
          <button
            className="faq-input-bar__submit"
            type="button"
            title="Press Enter"
            disabled
          >
            <ArrowRightIcon />
          </button>
        </div>
      )}

      <div className="hubs-grid hubs-grid--3col">
        {isLoading && (
          <div className="hub-card faq-card faq-card--loading">
            <p className="muted">Loading FAQs...</p>
          </div>
        )}
        {error && (
          <div className="hub-card faq-card">
            <p className="muted">Failed to load FAQs.</p>
          </div>
        )}
        {pagedFaqs.map((faq) => (
          <div
            key={faq.id}
            className={`hub-card faq-card${archivingIds.has(faq.id) ? ' faq-card--archiving' : ''}`}
            onClick={() => !archivingIds.has(faq.id) && openFaq(faq)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' && !archivingIds.has(faq.id)) openFaq(faq); }}
          >
            {archivingIds.has(faq.id) && (
              <div className="faq-card__archiving-overlay">
                <span className="gmodal__spinner" />
                <span>Archiving...</span>
              </div>
            )}
            <h3 className="faq-card__question">{truncate(faq.question, 80)}</h3>
            <p className="faq-card__answer-preview">{cardPreview(faq.answer)}</p>
            <div className="faq-card__footer">
              <span className="faq-card__confidence-badge">
                {Math.round((faq.confidence || 0) * 100)}%
              </span>
              {canEdit && (
                <div className="faq-card__actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={`faq-card__action-btn${faq.is_pinned ? ' faq-card__action-btn--active' : ''}`}
                    type="button"
                    title={faq.is_pinned ? 'Unpin' : 'Pin'}
                    onClick={() => togglePin(faq)}
                  >
                    <MapPinIcon />
                  </button>
                  <button
                    className="faq-card__action-btn"
                    type="button"
                    title="Edit"
                    onClick={() => {
                      openFaq(faq);
                      startEditing(faq);
                    }}
                  >
                    <PencilSquareIcon />
                  </button>
                  <button
                    className="faq-card__action-btn faq-card__action-btn--danger"
                    type="button"
                    title="Archive"
                    onClick={() => handleArchive(faq)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {!isLoading && !error && entries.length === 0 && (
          <div className="hub-card faq-card faq-card--empty">
            <p className="muted">
              {filterTab === 'pinned'
                ? 'No pinned FAQs yet.'
                : canEdit
                  ? 'No FAQs yet. Generate them from your sources.'
                  : 'No FAQs yet.'}
            </p>
          </div>
        )}
      </div>

      <div className="hubs-pagination">
        <span className="hubs-pagination-info">
          {entries.length > 0
            ? `Showing ${(safePage - 1) * FAQS_PER_PAGE + 1}\u2013${Math.min(safePage * FAQS_PER_PAGE, entries.length)} of ${entries.length} entries`
            : '\u00A0'}
        </span>
        {totalPages > 1 && (
          <div className="hubs-pagination-buttons">
            <button
              className="hubs-pagination-arrow"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeftIcon className="hubs-pagination-arrow-icon" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                className={`hubs-pagination-page${n === safePage ? ' hubs-pagination-page--active' : ''}`}
                onClick={() => setPage(n)}
              >
                {n}
              </button>
            ))}
            <button
              className="hubs-pagination-arrow"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRightIcon className="hubs-pagination-arrow-icon" />
            </button>
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="gmodal gmodal--sm" onClick={(e) => e.stopPropagation()}>
            <div className="gmodal__header">
              <span className="gmodal__badge">GENERATE</span>
              <button className="gmodal__icon-btn" type="button" onClick={() => setShowCreateModal(false)}>
                <XMarkIcon />
              </button>
            </div>
            <h2 className="gmodal__title">Generate FAQs</h2>
            <div className="gmodal__create-form">
              <div className="gmodal__source-section">
                <div className="gmodal__source-section-header">
                  <span className="hdash__form-label-text">Sources ({createSourceIds.length}/{completeSources.length})</span>
                  {completeSources.length > 0 && (
                    <div className="gmodal__source-section-actions">
                      <button
                        type="button"
                        className="button--small"
                        disabled={createSourceIds.length === completeSources.length}
                        onClick={() => setCreateSourceIds(completeSources.map((s) => s.id))}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="button--small"
                        disabled={createSourceIds.length === 0}
                        onClick={() => setCreateSourceIds([])}
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
                {completeSources.length > 0 ? (
                  <ul className="gmodal__source-list">
                    {completeSources.map((source) => {
                      const isSelected = createSourceIds.includes(source.id);
                      return (
                        <li key={source.id}>
                          <button
                            type="button"
                            className={`gmodal__source-list-item${isSelected ? ' gmodal__source-list-item--selected' : ''}`}
                            onClick={() => toggleCreateSource(source.id)}
                          >
                            {source.original_name}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="gmodal__create-hint">Upload and process sources first to generate FAQs.</p>
                )}
                {completeSources.length > 0 && createSourceIds.length === 0 && (
                  <p className="gmodal__create-hint">Select at least one source to generate FAQs.</p>
                )}
              </div>
              <button
                className="guide-card__draft-btn"
                onClick={() => startGeneration()}
                disabled={!canGenerate}
              >
                Generate FAQs
                <ChevronRightIcon style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedFaq && (() => {
        const faq = selectedFaq;
        const isEditing = editingId === faq.id;
        const draft = getDraft(faq);
        const confidence = Math.round((faq.confidence || 0) * 100);

        return (
          <div className="modal-backdrop" onClick={() => setSelectedFaq(null)}>
            <div className="gmodal" onClick={(e) => e.stopPropagation()}>
              <div className="gmodal__header">
                <div className="faq-modal__badges">
                  <span className="gmodal__badge">FAQ</span>
                  {faq.is_pinned && <span className="gmodal__badge faq-modal__badge--pinned">PINNED</span>}
                </div>
                <div className="gmodal__header-actions">
                  {canEdit && (
                    <>
                      <button
                        className={`gmodal__icon-btn${faq.is_pinned ? ' gmodal__icon-btn--active' : ''}`}
                        type="button"
                        title={faq.is_pinned ? 'Unpin' : 'Pin'}
                        onClick={() => togglePin(faq)}
                      >
                        <MapPinIcon />
                      </button>
                      {!isEditing && (
                        <button
                          className="gmodal__icon-btn"
                          type="button"
                          title="Edit"
                          onClick={() => startEditing(faq)}
                        >
                          <PencilSquareIcon />
                        </button>
                      )}
                      <button
                        className="gmodal__icon-btn gmodal__icon-btn--danger"
                        type="button"
                        title="Archive"
                        onClick={() => handleArchive(faq)}
                      >
                        <TrashIcon />
                      </button>
                    </>
                  )}
                  <button className="gmodal__icon-btn" type="button" title="Close" onClick={() => setSelectedFaq(null)}>
                    <XMarkIcon />
                  </button>
                </div>
              </div>

              <div className="faq-modal__question-section">
                <span className="faq-modal__label">QUESTION</span>
                {!isEditing ? (
                  <h2 className="gmodal__title">{faq.question}</h2>
                ) : (
                  <textarea
                    className="hdash__form-input hdash__form-textarea faq-modal__edit-question"
                    value={draft.question}
                    onChange={(e) => updateDraft(faq, { question: e.target.value })}
                    autoFocus
                  />
                )}
              </div>

              <div className="faq-modal__answer-section">
                <div className="faq-modal__answer-header">
                  <span className="faq-modal__label">ANSWER</span>
                  <span className="faq-modal__confidence">{confidence}% confidence</span>
                </div>
                {!isEditing ? (
                  <p className="faq-modal__answer-text">{faq.answer}</p>
                ) : (
                  <textarea
                    className="hdash__form-input hdash__form-textarea faq-modal__edit-answer"
                    value={draft.answer}
                    onChange={(e) => updateDraft(faq, { answer: e.target.value })}
                  />
                )}
              </div>

              {isEditing && (
                <div className="faq-modal__edit-actions">
                  <button
                    className="gmodal__step-edit-btn gmodal__step-edit-btn--save"
                    type="button"
                    onClick={() => saveEditing(faq)}
                    disabled={updateMutation.isPending}
                  >
                    {updateMutation.isPending ? "Saving..." : "Save"}
                  </button>
                  <button className="gmodal__step-edit-btn" type="button" onClick={cancelEditing}>
                    Cancel
                  </button>
                </div>
              )}

              {faq.citations.length > 0 && (
                <div className="faq-modal__citations">
                  <span className="faq-modal__label">CITATIONS</span>
                  <div className="faq-modal__citations-list">
                    {faq.citations.map((citation, idx) => {
                      const preview = citation.snippet.length > 140
                        ? `${citation.snippet.slice(0, 140)}...`
                        : citation.snippet;
                      return (
                        <button
                          key={`${citation.source_id}-${citation.chunk_index ?? idx}`}
                          className="faq-modal__citation-pill"
                          type="button"
                          onClick={() => setActiveCitation(citation)}
                        >
                          <span className="faq-modal__citation-id">{citation.source_id.slice(0, 6)}</span>
                          <span className="faq-modal__citation-snippet">{preview}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {activeCitation && (
        <div className="modal-backdrop" style={{ zIndex: 210 }} onClick={() => setActiveCitation(null)}>
          <div className="gmodal gmodal--sm" onClick={(e) => e.stopPropagation()}>
            <div className="gmodal__header">
              <strong>Source {activeCitation.source_id.slice(0, 8)}</strong>
              <button className="gmodal__icon-btn" type="button" onClick={() => setActiveCitation(null)}>
                <XMarkIcon />
              </button>
            </div>
            <p className="gmodal__citation-text">{activeCitation.snippet}</p>
          </div>
        </div>
      )}
    </div>
  );
}
