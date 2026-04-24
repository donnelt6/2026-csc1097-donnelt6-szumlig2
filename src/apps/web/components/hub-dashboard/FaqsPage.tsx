'use client';

// FaqsPage.tsx: Hub dashboard FAQs page with search, filtering, and flag actions.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
  PencilSquareIcon,
  TrashIcon,
  EllipsisVerticalIcon,
  StarIcon as StarOutline,
  SparklesIcon,
  ChatBubbleLeftIcon,
  FlagIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarSolid } from "@heroicons/react/24/solid";
import { archiveFaq, askQuestion, createFaq, flagFaq, generateFaqs, listFaqs, updateFaq } from "../../lib/api";
import { useSearch } from "../../lib/SearchContext";
import { FlagModal } from "./FlagModal";
import { MobileSearchBar } from "./MobileSearchBar";
import { TopicFilterPills } from "./TopicFilterPills";
import { buildTopicFilterOptions, matchesTopicFilter } from "./topicFilters";
import type { Citation, FaqEntry, FlagReason, Source } from "@shared/index";


interface Props {
  hubId: string;
  sources: Source[];
  canEdit: boolean;
}

interface DraftValues {
  question: string;
  answer: string;
}

type FilterTab = 'all' | 'favourites';

const FAQS_PER_PAGE = 8;

export function FaqsPage({ hubId, sources, canEdit }: Props) {
  const queryClient = useQueryClient();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);

  const { searchQuery } = useSearch();

  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [showAskModal, setShowAskModal] = useState(false);
  const [askInput, setAskInput] = useState("");
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [manualQuestion, setManualQuestion] = useState("");
  const [manualAnswer, setManualAnswer] = useState("");
  const [createSourceIds, setCreateSourceIds] = useState<string[]>([]);
  const [pendingGenerations, setPendingGenerations] = useState<Set<string>>(new Set());

  const [selectedFaq, setSelectedFaq] = useState<FaqEntry | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftValues>>({});
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [flagTargetId, setFlagTargetId] = useState<string | null>(null);

  useEffect(() => {
    if (!openMenuId) return;
    const handler = () => setOpenMenuId(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [openMenuId]);

  const completeSources = useMemo(() => sources.filter((s) => s.status === 'complete'), [sources]);

  const openGenerateModal = () => {
    setCreateSourceIds(completeSources.map((s) => s.id));
    setShowGenerateModal(true);
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
  const topicOptions = useMemo(() => buildTopicFilterOptions(allEntries), [allEntries]);

  const entries = useMemo(() => {
    let filtered = allEntries;
    if (filterTab === 'favourites') filtered = filtered.filter((f) => f.is_pinned);
    filtered = filtered.filter((f) => matchesTopicFilter(f, selectedTopic));
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter(
        (f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [allEntries, filterTab, searchQuery, selectedTopic]);

  useEffect(() => {
    setPage(1);
  }, [filterTab, selectedTopic, searchQuery]);

  const selectedFaqId = selectedFaq?.id ?? null;
  useEffect(() => {
    if (!selectedFaqId) return;
    const fresh = allEntries.find((f) => f.id === selectedFaqId);
    if (fresh) {
      setSelectedFaq(fresh);
    } else {
      setSelectedFaq(null);
    }
  }, [allEntries, selectedFaqId]);

  const canGenerate = canEdit && createSourceIds.length > 0;

  const firstPageLimit = FAQS_PER_PAGE;
  const totalPages = entries.length <= firstPageLimit
    ? 1
    : 1 + Math.ceil((entries.length - firstPageLimit) / FAQS_PER_PAGE);
  const safePage = Math.min(page, totalPages);
  const pageStart = safePage === 1 ? 0 : firstPageLimit + (safePage - 2) * FAQS_PER_PAGE;
  const pageLimit = safePage === 1 ? firstPageLimit : FAQS_PER_PAGE;
  const pagedFaqs = entries.slice(pageStart, pageStart + pageLimit);

  const startGeneration = () => {
    const id = crypto.randomUUID();
    const sourceIds = [...createSourceIds];

    setPendingGenerations((prev) => new Set(prev).add(id));
    setShowGenerateModal(false);

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

  const createMutation = useMutation({
    mutationFn: (data: { hub_id: string; question: string; answer: string }) => createFaq(data),
    onSuccess: () => {
      setShowManualModal(false);
      setManualQuestion("");
      setManualAnswer("");
      queryClient.invalidateQueries({ queryKey: ["faqs", hubId] });
      setStatusMessage("FAQ added.");
    },
    onError: (err) => setStatusMessage((err as Error).message),
  });

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

  const flagMutation = useMutation({
    mutationFn: ({ faqId, reason, notes }: { faqId: string; reason: FlagReason; notes?: string }) =>
      flagFaq(faqId, { reason, notes }),
    onSuccess: () => {
      setFlagTargetId(null);
      setStatusMessage("FAQ flagged for review.");
      queryClient.invalidateQueries({ queryKey: ["flagged-content", hubId] });
    },
    onError: (err) => setStatusMessage((err as Error).message),
  });

  const favouriteMutation = useMutation({
    mutationFn: ({ faqId, is_pinned }: { faqId: string; is_pinned: boolean }) =>
      updateFaq(faqId, { is_pinned }),
    onMutate: async ({ faqId, is_pinned }) => {
      await queryClient.cancelQueries({ queryKey: ["faqs", hubId] });
      const previous = queryClient.getQueryData<FaqEntry[]>(["faqs", hubId]);
      if (previous) {
        queryClient.setQueryData(["faqs", hubId],
          previous.map((f) => f.id === faqId ? { ...f, is_pinned } : f)
        );
      }
      return { previous };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["faqs", hubId] }),
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["faqs", hubId], ctx.previous);
      setStatusMessage((err as Error).message);
    },
  });

  const toggleFavourite = (entry: FaqEntry) => {
    favouriteMutation.mutate({ faqId: entry.id, is_pinned: !entry.is_pinned });
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

  const favouriteCount = allEntries.filter((f) => f.is_pinned).length;

  return (
    <div className={`hdash__faqs${totalPages > 1 ? ' hdash__faqs--with-pagination' : ''}`}>
      {statusMessage && <div className="hdash__guides-toast">{statusMessage}</div>}

      <MobileSearchBar placeholder="Search FAQs..." />

      <div className="faq-toolbar">
        <div className="faq-toolbar__left">
          <div className="faq-toolbar__filters">
            <div className="sources__filter-pills" aria-label="FAQ list filters">
              <button
                type="button"
                className={`sources__filter-pill${filterTab === 'all' ? ' sources__filter-pill--active' : ''}`}
                onClick={() => setFilterTab('all')}
              >
                All
              </button>
              <button
                type="button"
                className={`sources__filter-pill${filterTab === 'favourites' ? ' sources__filter-pill--active' : ''}`}
                onClick={() => setFilterTab(filterTab === 'favourites' ? 'all' : 'favourites')}
              >
                Pinned{favouriteCount > 0 ? ` (${favouriteCount})` : ''}
              </button>
            </div>
            {topicOptions.length > 0 && (
              <TopicFilterPills
                options={topicOptions}
                selectedTopic={selectedTopic}
                onSelectTopic={setSelectedTopic}
                ariaLabel="FAQ topic filters"
              />
            )}
          </div>
        </div>
        {canEdit && (
          <div className="faq-action-buttons">
            <button
              className="faq-action-btn"
              type="button"
              onClick={() => { setAskInput(""); setAskAnswer(null); setShowAskModal(true); }}
            >
              <ChatBubbleLeftIcon className="faq-action-btn__icon" />
              Ask a Question
            </button>
            <button
              className="faq-action-btn"
              type="button"
              onClick={() => setShowManualModal(true)}
            >
              <PlusIcon className="faq-action-btn__icon" />
              Create a Question
            </button>
            <button
              className="faq-action-btn faq-action-btn--generate"
              type="button"
              onClick={() => openGenerateModal()}
              disabled={pendingGenerations.size > 0}
            >
              <SparklesIcon className="faq-action-btn__icon" />
              Generate for me
            </button>
          </div>
        )}
      </div>

      <div className="faq-grid">
        {isLoading && (
          <div className="faq-grid-card faq-grid-card--loading">
            <p className="muted">Loading FAQs...</p>
          </div>
        )}
        {error && (
          <div className="faq-grid-card">
            <p className="muted">Failed to load FAQs.</p>
          </div>
        )}
        {pagedFaqs.map((faq) => (
          <div
            key={faq.id}
            className={`faq-grid-card${archivingIds.has(faq.id) ? ' faq-grid-card--archiving' : ''}`}
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
            <div className="faq-grid-card__question-zone">
              <h3 className="faq-grid-card__question">{truncate(faq.question, 120)}</h3>
            </div>
            <div className="faq-grid-card__body">
              <p className="faq-grid-card__answer">{cardPreview(faq.answer)}</p>
              <div className="faq-grid-card__footer" onClick={(e) => e.stopPropagation()}>
                <span className="faq-grid-card__confidence">{Math.round((faq.confidence || 0) * 100)}%</span>
              <div className="faq-grid-card__actions">
                <button
                  className="faq-grid-card__action-btn"
                  type="button"
                  title={faq.is_pinned ? 'Unpin' : 'Pin'}
                  onClick={() => toggleFavourite(faq)}
                >
                  {faq.is_pinned ? <StarSolid className="faq-grid-card__action-icon faq-grid-card__action-icon--pinned" /> : <StarOutline className="faq-grid-card__action-icon" />}
                </button>
                {canEdit && (
                  <div className="hub-card-menu">
                    <button
                      className="faq-grid-card__action-btn"
                      type="button"
                      aria-label="FAQ options"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(openMenuId === faq.id ? null : faq.id);
                      }}
                    >
                      <EllipsisVerticalIcon className="faq-grid-card__action-icon" />
                    </button>
                    {openMenuId === faq.id && (
                      <div className="hub-card-menu__dropdown">
                        <button
                          className="hub-card-menu__item"
                          type="button"
                          onClick={() => {
                            openFaq(faq);
                            startEditing(faq);
                            setOpenMenuId(null);
                          }}
                        >
                          Edit
                          <PencilSquareIcon className="hub-card-menu__item-icon" />
                        </button>
                        <button
                          className="hub-card-menu__item hub-card-menu__item--danger"
                          type="button"
                          onClick={() => handleArchive(faq)}
                        >
                          Archive
                          <TrashIcon className="hub-card-menu__item-icon" />
                        </button>
                        <button
                          className="hub-card-menu__item hub-card-menu__item--danger"
                          type="button"
                          onClick={() => {
                            setFlagTargetId(faq.id);
                            setOpenMenuId(null);
                          }}
                        >
                          Flag
                          <FlagIcon className="hub-card-menu__item-icon" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            </div>
          </div>
        ))}

        {!isLoading && !error && entries.length === 0 && (
          <div className="faq-grid-card faq-grid-card--empty">
            <p className="muted">
              {filterTab === 'favourites'
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
            ? `Showing ${pageStart + 1}-${Math.min(pageStart + pageLimit, entries.length)} of ${entries.length} entries`
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

      {showGenerateModal && (
        <div className="modal-backdrop" onClick={() => setShowGenerateModal(false)}>
          <div className="gmodal gmodal--sm" onClick={(e) => e.stopPropagation()}>
            <div className="gmodal__header">
              <span className="gmodal__badge">GENERATE</span>
              <button className="gmodal__icon-btn" type="button" onClick={() => setShowGenerateModal(false)}>
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
                <ChevronRightIcon className="hdash__icon--sm" />
              </button>
            </div>
          </div>
        </div>
      )}

      {showManualModal && (
        <div className="modal-backdrop" onClick={() => setShowManualModal(false)}>
          <div className="gmodal gmodal--sm" onClick={(e) => e.stopPropagation()}>
            <div className="gmodal__header">
              <span className="gmodal__badge">NEW FAQ</span>
              <button className="gmodal__icon-btn" type="button" onClick={() => setShowManualModal(false)}>
                <XMarkIcon />
              </button>
            </div>
            <h2 className="gmodal__title">Add FAQ</h2>
            <div className="gmodal__create-form">
              <label className="hdash__form-label">
                <span className="hdash__form-label-text">Question</span>
                <textarea
                  className="hdash__form-input hdash__form-textarea"
                  value={manualQuestion}
                  onChange={(e) => setManualQuestion(e.target.value)}
                  placeholder="e.g. How do I reset my password?"
                  rows={2}
                  autoFocus
                />
              </label>
              <label className="hdash__form-label">
                <span className="hdash__form-label-text">Answer</span>
                <textarea
                  className="hdash__form-input hdash__form-textarea"
                  value={manualAnswer}
                  onChange={(e) => setManualAnswer(e.target.value)}
                  placeholder="Type the answer..."
                  rows={4}
                />
              </label>
              <button
                className="guide-card__draft-btn"
                type="button"
                onClick={() => createMutation.mutate({ hub_id: hubId, question: manualQuestion.trim(), answer: manualAnswer.trim() })}
                disabled={!manualQuestion.trim() || !manualAnswer.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? "Adding..." : "Add FAQ"}
                <ChevronRightIcon className="hdash__icon--sm" />
              </button>
            </div>
          </div>
        </div>
      )}

      {showAskModal && (
        <div className="modal-backdrop" onClick={() => { if (!askLoading) setShowAskModal(false); }}>
          <div className="gmodal gmodal--sm" onClick={(e) => e.stopPropagation()}>
            <div className="gmodal__header">
              <span className="gmodal__badge">ASK</span>
              <button className="gmodal__icon-btn" type="button" onClick={() => { if (!askLoading) setShowAskModal(false); }}>
                <XMarkIcon />
              </button>
            </div>
            <h2 className="gmodal__title">Ask a Question</h2>
            <p className="gmodal__subtitle">Ask a question and we&apos;ll search your sources for an answer.</p>
            <div className="gmodal__create-form">
              <label className="hdash__form-label">
                <span className="hdash__form-label-text">Question</span>
                <textarea
                  className="hdash__form-input hdash__form-textarea"
                  value={askInput}
                  onChange={(e) => setAskInput(e.target.value)}
                  placeholder="e.g. What is our data retention policy?"
                  rows={2}
                  autoFocus
                  disabled={askLoading}
                />
              </label>
              {!askAnswer && (
                <button
                  className="guide-card__draft-btn"
                  type="button"
                  onClick={() => {
                    setAskLoading(true);
                    setAskAnswer(null);
                    askQuestion({ hub_id: hubId, scope: 'hub', question: askInput.trim() })
                      .then((res) => setAskAnswer(res.answer))
                      .catch((err) => setStatusMessage((err as Error).message))
                      .finally(() => setAskLoading(false));
                  }}
                  disabled={!askInput.trim() || askLoading}
                >
                  {askLoading ? "Searching..." : "Search sources"}
                  <ChevronRightIcon className="hdash__icon--sm" />
                </button>
              )}
              {askAnswer && (
                <>
                  <label className="hdash__form-label">
                    <span className="hdash__form-label-text">Answer</span>
                    <div className="faq-ask-answer">{askAnswer}</div>
                  </label>
                  <div className="faq-ask-actions">
                    <button
                      className="guide-card__draft-btn"
                      type="button"
                      onClick={() => {
                        createMutation.mutate(
                          { hub_id: hubId, question: askInput.trim(), answer: askAnswer },
                          { onSuccess: () => { setShowAskModal(false); setAskInput(""); setAskAnswer(null); } },
                        );
                      }}
                      disabled={createMutation.isPending}
                    >
                      {createMutation.isPending ? "Saving..." : "Save as FAQ"}
                      <ChevronRightIcon className="hdash__icon--sm" />
                    </button>
                    <button
                      className="gmodal__step-edit-btn"
                      type="button"
                      onClick={() => setAskAnswer(null)}
                    >
                      Try again
                    </button>
                  </div>
                </>
              )}
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
                  {faq.is_pinned && <span className="gmodal__badge faq-modal__badge--pinned">FAVOURITE</span>}
                </div>
                <div className="gmodal__header-actions">
                  {canEdit && (
                    <>
                      <button
                        className="hub-favourite-button"
                        type="button"
                        title={faq.is_pinned ? 'Unfavourite' : 'Favourite'}
                        onClick={() => toggleFavourite(faq)}
                      >
                        {faq.is_pinned ? <StarSolid className="hub-favourite-icon filled" /> : <StarOutline className="hub-favourite-icon" />}
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
                  <button
                    className="gmodal__icon-btn"
                    type="button"
                    title="Flag"
                    onClick={() => setFlagTargetId(faq.id)}
                  >
                    <FlagIcon />
                  </button>
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
        <div className="modal-backdrop modal-backdrop--raised" onClick={() => setActiveCitation(null)}>
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

      {flagTargetId && (
        <FlagModal
          label="FAQ"
          submitting={flagMutation.isPending}
          onClose={() => setFlagTargetId(null)}
          onSubmit={(reason, notes) => flagMutation.mutate({ faqId: flagTargetId, reason, notes })}
        />
      )}
    </div>
  );
}
