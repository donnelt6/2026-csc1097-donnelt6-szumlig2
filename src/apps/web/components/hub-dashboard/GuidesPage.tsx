'use client';

// GuidesPage.tsx: Hub dashboard guides page with search, filtering, and flag actions.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  PlusIcon,
  EllipsisVerticalIcon,
  FlagIcon,
  TrashIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
  DocumentTextIcon,
  PencilSquareIcon,
  StarIcon as StarOutline,
} from "@heroicons/react/24/outline";
import { StarIcon as StarSolid } from "@heroicons/react/24/solid";
import {
  archiveGuide,
  createGuideStep,
  flagGuide,
  generateGuide,
  listGuides,
  reorderGuideSteps,
  updateGuide,
  updateGuideStep,
  updateGuideStepProgress,
} from "../../lib/api";
import type { Citation, FlagReason, GuideEntry, GuideStep, Source } from "../../lib/types";
import { FlagModal } from "./FlagModal";
import { formatRelativeTime } from "../../lib/utils";
import { useSearch } from "../../lib/SearchContext";

interface Props {
  hubId: string;
  sources: Source[];
  canEdit: boolean;
}

interface StepDraftValues {
  title: string;
  instruction: string;
}

const GUIDES_PER_PAGE = 7;

function SortableStepRow({
  step,
  index,
  canEdit,
  isEditing,
  draft,
  onToggleProgress,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onUpdateDraft,
  onCitationClick,
}: {
  step: GuideStep;
  index: number;
  canEdit: boolean;
  isEditing: boolean;
  draft: StepDraftValues;
  onToggleProgress: (step: GuideStep) => void;
  onStartEdit: (step: GuideStep) => void;
  onSaveEdit: (step: GuideStep) => void;
  onCancelEdit: () => void;
  onUpdateDraft: (step: GuideStep, updates: Partial<StepDraftValues>) => void;
  onCitationClick: (citation: Citation) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
    disabled: !canEdit,
  });
  const style = {
    transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  } satisfies React.CSSProperties;

  return (
    <div ref={setNodeRef} style={style} className={`gmodal__step${step.is_complete ? ' gmodal__step--done' : ''}`}>
      <div className="gmodal__step-row">
        <label className="gmodal__step-check">
          <input
            type="checkbox"
            checked={!!step.is_complete}
            onChange={() => onToggleProgress(step)}
            disabled={isDragging}
          />
          <span className="gmodal__step-check-box">
            {step.is_complete && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 5.5L4 7.5L8 3" />
              </svg>
            )}
          </span>
        </label>
        <span className="gmodal__step-num">{index + 1}</span>
        <div className="gmodal__step-content">
          {!isEditing ? (
            <>
              <strong className="gmodal__step-title">{step.title || `Step ${index + 1}`}</strong>
              <p className="gmodal__step-instruction">{step.instruction}</p>
              {step.citations.length > 0 && (
                <div className="gmodal__step-sources">
                  <span className="gmodal__step-sources-label">Sources:</span>
                  {step.citations.map((citation, ci) => (
                    <button
                      key={`${citation.source_id}-${citation.chunk_index ?? ci}`}
                      className="gmodal__step-source-pill"
                      type="button"
                      onClick={() => onCitationClick(citation)}
                    >
                      {citation.source_id.slice(0, 6)}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="gmodal__step-edit-form">
              <input
                type="text"
                className="hdash__form-input"
                placeholder="Step title (optional)"
                value={draft.title}
                onChange={(e) => onUpdateDraft(step, { title: e.target.value })}
              />
              <textarea
                className="hdash__form-input hdash__form-textarea"
                placeholder="Step instructions"
                value={draft.instruction}
                onChange={(e) => onUpdateDraft(step, { instruction: e.target.value })}
              />
            </div>
          )}
        </div>
        {canEdit && (
          <div className="gmodal__step-actions">
            {!isEditing ? (
              <button className="gmodal__step-edit-btn" type="button" onClick={() => onStartEdit(step)}>Edit</button>
            ) : (
              <>
                <button className="gmodal__step-edit-btn gmodal__step-edit-btn--save" type="button" onClick={() => onSaveEdit(step)}>Save</button>
                <button className="gmodal__step-edit-btn" type="button" onClick={onCancelEdit}>Cancel</button>
              </>
            )}
            <button
              className="gmodal__step-drag"
              type="button"
              aria-label="Reorder step"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <circle cx="4" cy="2" r="1.2" /><circle cx="8" cy="2" r="1.2" />
                <circle cx="4" cy="6" r="1.2" /><circle cx="8" cy="6" r="1.2" />
                <circle cx="4" cy="10" r="1.2" /><circle cx="8" cy="10" r="1.2" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function GuidesPage({ hubId, sources, canEdit }: Props) {
  const queryClient = useQueryClient();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [flagTargetId, setFlagTargetId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<'recent' | 'favourites'>('recent');

  const [topic, setTopic] = useState("");
  const [stepCountInput, setStepCountInput] = useState("5");
  const [createSourceIds, setCreateSourceIds] = useState<string[]>([]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pendingGenerations, setPendingGenerations] = useState<Set<string>>(new Set());

  const completeSources = useMemo(() => sources.filter((s) => s.status === 'complete'), [sources]);

  // Pre-select all sources when opening create modal
  const openCreateModal = () => {
    setCreateSourceIds(completeSources.map((s) => s.id));
    setShowCreateModal(true);
  };

  const toggleCreateSource = (id: string) => {
    setCreateSourceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  const [selectedGuide, setSelectedGuide] = useState<GuideEntry | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [stepDrafts, setStepDrafts] = useState<Record<string, StepDraftValues>>({});
  const [newStepDrafts, setNewStepDrafts] = useState<Record<string, StepDraftValues>>({});
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!statusMessage) return;
    const t = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(t);
  }, [statusMessage]);

  useEffect(() => {
    if (!openMenuId) return;
    const handler = () => setOpenMenuId(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [openMenuId]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["guides", hubId],
    queryFn: () => listGuides(hubId),
    staleTime: 0,
  });

  const { searchQuery } = useSearch();

  const allGuides = useMemo(() => data ?? [], [data]);
  const guides = useMemo(() => {
    let filtered = allGuides;
    if (filterTab === 'favourites') filtered = filtered.filter((g) => g.is_favourited);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter(
        (g) =>
          g.title.toLowerCase().includes(q) ||
          (g.topic && g.topic.toLowerCase().includes(q)) ||
          g.steps.some(
            (s) =>
              (s.title && s.title.toLowerCase().includes(q)) ||
              s.instruction.toLowerCase().includes(q)
          )
      );
    }
    return filtered;
  }, [allGuides, filterTab, searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [filterTab, searchQuery]);

  const favouriteCount = allGuides.filter((g) => g.is_favourited).length;

  useEffect(() => {
    if (!selectedGuide) return;
    const fresh = allGuides.find((g) => g.id === selectedGuide.id);
    if (fresh) {
      setSelectedGuide(fresh);
    } else {
      setSelectedGuide(null);
    }
  }, [allGuides]); // eslint-disable-line react-hooks/exhaustive-deps

  const canGenerate = canEdit && createSourceIds.length > 0;

  const pendingCount = pendingGenerations.size;
  const slotsForGuides = Math.max(1, GUIDES_PER_PAGE - pendingCount);
  const totalPages = Math.max(1, Math.ceil(guides.length / slotsForGuides));
  const safePage = Math.min(page, totalPages);
  const pagedGuides = guides.slice((safePage - 1) * slotsForGuides, safePage * slotsForGuides);

  const startGeneration = () => {
    const id = crypto.randomUUID();
    const count = Math.max(1, Math.min(20, Number(stepCountInput) || 5));
    const sourceIds = [...createSourceIds];
    const topicVal = topic.trim() || undefined;

    setPendingGenerations((prev) => new Set(prev).add(id));
    setShowCreateModal(false);
    setTopic("");

    generateGuide({
      hub_id: hubId,
      source_ids: sourceIds,
      topic: topicVal,
      step_count: count,
    })
      .then(async (data) => {
        const actual = data.entry?.steps?.length ?? 0;
        setStatusMessage(`Generated ${actual} of ${count} steps.`);
        await queryClient.invalidateQueries({ queryKey: ["guides", hubId] });
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

  const flagMutation = useMutation({
    mutationFn: ({ guideId, reason, notes }: { guideId: string; reason: FlagReason; notes?: string }) =>
      flagGuide(guideId, { reason, notes }),
    onSuccess: () => {
      setFlagTargetId(null);
      setStatusMessage("Guide flagged for review.");
      queryClient.invalidateQueries({ queryKey: ["flagged-content", hubId] });
    },
    onError: (err) => setStatusMessage((err as Error).message),
  });

  const favouriteMutation = useMutation({
    mutationFn: ({ guideId, is_favourited }: { guideId: string; is_favourited: boolean }) =>
      updateGuide(guideId, { is_favourited }),
    onMutate: async ({ guideId, is_favourited }) => {
      await queryClient.cancelQueries({ queryKey: ["guides", hubId] });
      const previous = queryClient.getQueryData<GuideEntry[]>(["guides", hubId]);
      if (previous) {
        queryClient.setQueryData(["guides", hubId],
          previous.map((g) => g.id === guideId ? { ...g, is_favourited } : g)
        );
      }
      return { previous };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["guides", hubId] }),
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["guides", hubId], ctx.previous);
      setStatusMessage((err as Error).message);
    },
  });

  const toggleFavourite = (guide: GuideEntry) => {
    favouriteMutation.mutate({ guideId: guide.id, is_favourited: !guide.is_favourited });
  };

  const updateGuideMutation = useMutation({
    mutationFn: ({ guideId, payload }: { guideId: string; payload: Parameters<typeof updateGuide>[1] }) =>
      updateGuide(guideId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["guides", hubId] }),
    onError: (err) => setStatusMessage((err as Error).message),
  });

  const updateStepMutation = useMutation({
    mutationFn: ({ stepId, payload }: { stepId: string; payload: Parameters<typeof updateGuideStep>[1] }) =>
      updateGuideStep(stepId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["guides", hubId] }),
    onError: (err) => setStatusMessage((err as Error).message),
  });

  const createStepMutation = useMutation({
    mutationFn: ({ guideId, payload }: { guideId: string; payload: Parameters<typeof createGuideStep>[1] }) =>
      createGuideStep(guideId, payload),
    onSuccess: (_data, variables) => {
      setNewStepDrafts((prev) => ({ ...prev, [variables.guideId]: { title: "", instruction: "" } }));
      queryClient.invalidateQueries({ queryKey: ["guides", hubId] });
    },
    onError: (err) => setStatusMessage((err as Error).message),
  });

  const progressMutation = useMutation({
    mutationFn: ({ stepId, is_complete }: { stepId: string; is_complete: boolean }) =>
      updateGuideStepProgress(stepId, { is_complete }),
    onMutate: async ({ stepId, is_complete }) => {
      await queryClient.cancelQueries({ queryKey: ["guides", hubId] });
      const previous = queryClient.getQueryData<GuideEntry[]>(["guides", hubId]);
      if (previous) {
        const next = previous.map((guide) => ({
          ...guide,
          steps: guide.steps.map((step) =>
            step.id === stepId ? { ...step, is_complete, completed_at: is_complete ? new Date().toISOString() : null } : step
          ),
        }));
        queryClient.setQueryData(["guides", hubId], next);
      }
      return { previous };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["guides", hubId] }),
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["guides", hubId], ctx.previous);
      setStatusMessage((err as Error).message);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (guideId: string) => archiveGuide(guideId),
    onSuccess: () => {
      setSelectedGuide(null);
      queryClient.invalidateQueries({ queryKey: ["guides", hubId] });
    },
    onError: (err) => setStatusMessage((err as Error).message),
  });

  const reorderMutation = useMutation({
    mutationFn: ({ guideId, orderedIds }: { guideId: string; orderedIds: string[] }) =>
      reorderGuideSteps(guideId, orderedIds),
    onMutate: async ({ guideId, orderedIds }) => {
      await queryClient.cancelQueries({ queryKey: ["guides", hubId] });
      const previous = queryClient.getQueryData<GuideEntry[]>(["guides", hubId]);
      if (previous) {
        const next = previous.map((guide) => {
          if (guide.id !== guideId) return guide;
          const stepMap = new Map(guide.steps.map((s) => [s.id, s]));
          const reordered = orderedIds
            .map((id) => stepMap.get(id))
            .filter((s): s is GuideStep => !!s)
            .map((s, i) => ({ ...s, step_index: i + 1 }));
          return { ...guide, steps: reordered };
        });
        queryClient.setQueryData(["guides", hubId], next);
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["guides", hubId], ctx.previous);
      setStatusMessage((err as Error).message);
    },
  });

  const buildStepDraft = (step: GuideStep): StepDraftValues => ({ title: step.title ?? "", instruction: step.instruction });
  const getStepDraft = (step: GuideStep) => stepDrafts[step.id] ?? buildStepDraft(step);

  const startStepEditing = (step: GuideStep) => {
    setEditingStepId(step.id);
    setStepDrafts((prev) => ({ ...prev, [step.id]: prev[step.id] ?? buildStepDraft(step) }));
  };

  const saveStepEditing = (step: GuideStep) => {
    const draft = getStepDraft(step);
    updateStepMutation.mutate({
      stepId: step.id,
      payload: { title: draft.title.trim() || undefined, instruction: draft.instruction.trim() },
    });
    setEditingStepId(null);
  };

  const updateStepDraft = (step: GuideStep, updates: Partial<StepDraftValues>) => {
    setStepDrafts((prev) => ({
      ...prev,
      [step.id]: { ...(prev[step.id] ?? buildStepDraft(step)), ...updates },
    }));
  };

  const getNewStepDraft = (guideId: string): StepDraftValues =>
    newStepDrafts[guideId] ?? { title: "", instruction: "" };

  const updateNewStepDraft = (guideId: string, updates: Partial<StepDraftValues>) => {
    setNewStepDrafts((prev) => ({
      ...prev,
      [guideId]: { ...(prev[guideId] ?? { title: "", instruction: "" }), ...updates },
    }));
  };

  const addStep = (guide: GuideEntry) => {
    const draft = getNewStepDraft(guide.id);
    if (!draft.instruction.trim()) {
      setStatusMessage("Step instructions are required.");
      return;
    }
    createStepMutation.mutate({
      guideId: guide.id,
      payload: { title: draft.title.trim() || undefined, instruction: draft.instruction.trim() },
    });
  };

  const handleDragEnd = (event: DragEndEvent, guide: GuideEntry) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = guide.steps.findIndex((s) => s.id === active.id);
    const newIndex = guide.steps.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const ordered = arrayMove(guide.steps, oldIndex, newIndex);
    const reorderedSteps = ordered.map((s, i) => ({ ...s, step_index: i + 1 }));
    setSelectedGuide({ ...guide, steps: reorderedSteps });
    reorderMutation.mutate({ guideId: guide.id, orderedIds: ordered.map((s) => s.id) });
  };

  const handleArchive = (guide: GuideEntry) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Archive this guide? You can generate a new one later.");
      if (!confirmed) return;
    }
    archiveMutation.mutate(guide.id);
    setOpenMenuId(null);
  };

  const openGuide = (guide: GuideEntry) => {
    setSelectedGuide(guide);
    setEditingStepId(null);
    setEditingTitleId(null);
  };

  return (
    <div className={`hdash__guides${totalPages > 1 ? ' hdash__guides--with-pagination' : ''}`}>
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
            className={`hubs-tab${filterTab === 'favourites' ? ' hubs-tab--active' : ''}`}
            onClick={() => setFilterTab('favourites')}
          >
            Favourites{favouriteCount > 0 ? ` (${favouriteCount})` : ''}
          </button>
        </div>
      </div>

      <div className="hubs-grid hubs-grid--4col">
        {canEdit && safePage === 1 && (
          <div
            className="hub-card hub-card--create"
            onClick={() => openCreateModal()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') openCreateModal(); }}
          >
            <div className="hub-card-create-icon">
              <PlusIcon />
            </div>
            <h3 className="hub-card-create-title">Create New Guide</h3>
            <p className="hub-card-create-desc">Generate a step-by-step checklist from your sources</p>
          </div>
        )}

        {!showCreateModal && Array.from(pendingGenerations).map((id) => (
          <div key={id} className="hub-card guide-card guide-card--generating">
            <div className="guide-card__generating-inner">
              <span className="gmodal__spinner gmodal__spinner--accent" />
              <p className="guide-card__generating-text">Generating guide...</p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="hub-card guide-card guide-card--loading">
            <p className="muted">Loading guides...</p>
          </div>
        )}
        {error && (
          <div className="hub-card guide-card">
            <p className="muted">Failed to load guides.</p>
          </div>
        )}
        {pagedGuides.map((guide) => {
          const total = guide.steps.length;
          const completed = guide.steps.filter((s) => s.is_complete).length;
          const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
          return (
            <div
              key={guide.id}
              className="hub-card guide-card"
              onClick={() => openGuide(guide)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') openGuide(guide); }}
            >
              <div className="hub-card-top">
                <div className="guide-card__icon">
                  <DocumentTextIcon />
                </div>
                <div className="hub-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="hub-favourite-button"
                    type="button"
                    title={guide.is_favourited ? 'Unfavourite' : 'Favourite'}
                    onClick={() => toggleFavourite(guide)}
                  >
                    {guide.is_favourited ? <StarSolid className="hub-favourite-icon filled" /> : <StarOutline className="hub-favourite-icon" />}
                  </button>
                  {canEdit && (
                    <div className="hub-card-menu">
                      <button
                        className="hub-menu-button"
                        type="button"
                        aria-label="Guide options"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(openMenuId === guide.id ? null : guide.id);
                        }}
                      >
                        <EllipsisVerticalIcon className="hdash__icon--lg" />
                      </button>
                      {openMenuId === guide.id && (
                        <div className="hub-card-menu__dropdown">
                          <button
                            className="hub-card-menu__item"
                            type="button"
                            onClick={() => {
                              openGuide(guide);
                              setEditingTitleId(guide.id);
                              setTitleDraft(guide.title);
                              setOpenMenuId(null);
                            }}
                          >
                            Edit
                            <PencilSquareIcon className="hub-card-menu__item-icon" />
                          </button>
                          <button
                            className="hub-card-menu__item hub-card-menu__item--danger"
                            type="button"
                            onClick={() => handleArchive(guide)}
                          >
                            Archive
                            <TrashIcon className="hub-card-menu__item-icon" />
                          </button>
                          <button
                            className="hub-card-menu__item hub-card-menu__item--danger"
                            type="button"
                            onClick={() => {
                              setFlagTargetId(guide.id);
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
              <h3 className="hub-card-title">{guide.title}</h3>
              {guide.topic && <p className="hub-card-description">{guide.topic}</p>}
              <div className="guide-card__footer">
                <div className="guide-card__meta">
                  <span className="guide-card__steps-badge">{total} {total === 1 ? 'STEP' : 'STEPS'}</span>
                  <span className="guide-card__date">Created {formatRelativeTime(guide.created_at)}</span>
                </div>
                {total > 0 && (
                  <div className="guide-card__progress">
                    <div className="guide-card__progress-bar">
                      <div className="guide-card__progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="guide-card__progress-label">{pct}%</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {!isLoading && !error && guides.length === 0 && (
          <div className="hub-card guide-card">
            <p className="muted hdash__empty-hint">
              {filterTab === 'favourites'
                ? 'No favourite guides yet.'
                : canEdit
                  ? 'No guides yet. Create one from your sources.'
                  : 'No guides yet.'}
            </p>
          </div>
        )}
      </div>

      <div className="hubs-pagination">
        <span className="hubs-pagination-info">
          {guides.length > 0
            ? `Showing ${(safePage - 1) * slotsForGuides + 1}-${Math.min(safePage * slotsForGuides, guides.length)} of ${guides.length} guides`
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
              <span className="gmodal__badge">NEW GUIDE</span>
              <button className="gmodal__icon-btn" type="button" onClick={() => setShowCreateModal(false)}>
                <XMarkIcon />
              </button>
            </div>
            <h2 className="gmodal__title">Create New Guide</h2>
            <div className="gmodal__create-form">
              <label className="hdash__form-label">
                <span className="hdash__form-label-text">What do you want a guide for?</span>
                <input
                  type="text"
                  className="hdash__form-input"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. New hire onboarding"
                  autoFocus
                />
              </label>
              <label className="hdash__form-label">
                <span className="hdash__form-label-text">How many steps?</span>
                <input
                  type="number"
                  className="hdash__form-input"
                  min={1}
                  max={20}
                  value={stepCountInput}
                  onChange={(e) => setStepCountInput(e.target.value)}
                  onBlur={() => {
                    const v = Math.max(1, Math.min(20, Number(stepCountInput) || 5));
                    setStepCountInput(String(v));
                  }}
                />
              </label>
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
                  <p className="gmodal__create-hint">Upload and process sources first to generate guides.</p>
                )}
                {completeSources.length > 0 && createSourceIds.length === 0 && (
                  <p className="gmodal__create-hint">Select at least one source to generate guides.</p>
                )}
              </div>
              <button
                className="guide-card__draft-btn"
                onClick={() => startGeneration()}
                disabled={!canGenerate}
              >
                Draft Guide
                <ChevronRightIcon className="hdash__icon--sm" />
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedGuide && (() => {
        const guide = selectedGuide;
        const total = guide.steps.length;
        const completed = guide.steps.filter((s) => s.is_complete).length;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        const isEditingTitle = editingTitleId === guide.id;

        return (
          <div className="modal-backdrop" onClick={() => setSelectedGuide(null)}>
            <div className="gmodal" onClick={(e) => e.stopPropagation()}>
              <div className="gmodal__header">
                <span className="gmodal__badge">GUIDE</span>
                <div className="gmodal__header-actions">
                  <button
                    className="gmodal__icon-btn"
                    type="button"
                    title="Flag"
                    onClick={() => setFlagTargetId(guide.id)}
                  >
                    <FlagIcon />
                  </button>
                  {canEdit && (
                    <button
                      className="gmodal__icon-btn gmodal__icon-btn--danger"
                      type="button"
                      title="Archive"
                      onClick={() => handleArchive(guide)}
                    >
                      <TrashIcon />
                    </button>
                  )}
                  <button className="gmodal__icon-btn" type="button" title="Close" onClick={() => setSelectedGuide(null)}>
                    <XMarkIcon />
                  </button>
                </div>
              </div>

              {!isEditingTitle ? (
                <h2
                  className="gmodal__title"
                  onClick={() => {
                    if (!canEdit) return;
                    setEditingTitleId(guide.id);
                    setTitleDraft(guide.title);
                  }}
                  title={canEdit ? "Click to edit title" : undefined}
                  style={canEdit ? { cursor: 'pointer' } : undefined}
                >
                  {guide.title}
                </h2>
              ) : (
                <div className="gmodal__title-edit">
                  <input
                    type="text"
                    className="hdash__form-input gmodal__title-input"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        updateGuideMutation.mutate({ guideId: guide.id, payload: { title: titleDraft.trim() } });
                        setEditingTitleId(null);
                      }
                      if (e.key === 'Escape') setEditingTitleId(null);
                    }}
                  />
                  <div className="gmodal__title-edit-actions">
                    <button
                      className="gmodal__step-edit-btn gmodal__step-edit-btn--save"
                      type="button"
                      onClick={() => {
                        updateGuideMutation.mutate({ guideId: guide.id, payload: { title: titleDraft.trim() } });
                        setEditingTitleId(null);
                      }}
                    >
                      Save
                    </button>
                    <button className="gmodal__step-edit-btn" type="button" onClick={() => setEditingTitleId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {total > 0 && (
                <div className="gmodal__progress">
                  <div className="gmodal__progress-header">
                    <span className="gmodal__progress-label">PROGRESS</span>
                    <span className="gmodal__progress-pct">{pct}%</span>
                  </div>
                  <div className="gmodal__progress-bar">
                    <div className="gmodal__progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="gmodal__progress-updated">Last updated {formatRelativeTime(guide.updated_at ?? guide.created_at)}</span>
                </div>
              )}

              <div className="gmodal__steps-header">
                <span className="gmodal__steps-count">{completed} of {total} Steps Completed</span>
              </div>

              <div className="gmodal__steps-list">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(event) => handleDragEnd(event, guide)}
                >
                  <SortableContext items={guide.steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                    {guide.steps.map((step, i) => (
                      <SortableStepRow
                        key={step.id}
                        step={step}
                        index={i}
                        canEdit={canEdit}
                        isEditing={editingStepId === step.id}
                        draft={getStepDraft(step)}
                        onToggleProgress={(s) => progressMutation.mutate({ stepId: s.id, is_complete: !s.is_complete })}
                        onStartEdit={startStepEditing}
                        onSaveEdit={saveStepEditing}
                        onCancelEdit={() => setEditingStepId(null)}
                        onUpdateDraft={updateStepDraft}
                        onCitationClick={setActiveCitation}
                      />
                    ))}
                  </SortableContext>
                </DndContext>

                {canEdit && (
                  <div className="gmodal__add-step">
                    <input
                      type="text"
                      className="hdash__form-input"
                      placeholder="Step title (optional)"
                      value={getNewStepDraft(guide.id).title}
                      onChange={(e) => updateNewStepDraft(guide.id, { title: e.target.value })}
                    />
                    <textarea
                      className="hdash__form-input hdash__form-textarea"
                      placeholder="Step instructions"
                      value={getNewStepDraft(guide.id).instruction}
                      onChange={(e) => updateNewStepDraft(guide.id, { instruction: e.target.value })}
                    />
                    <button
                      className="guide-card__draft-btn"
                      type="button"
                      onClick={() => addStep(guide)}
                      disabled={createStepMutation.isPending}
                    >
                      {createStepMutation.isPending ? "Adding..." : "Add step"}
                    </button>
                  </div>
                )}
              </div>
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
          label="Guide"
          submitting={flagMutation.isPending}
          onClose={() => setFlagTargetId(null)}
          onSubmit={(reason, notes) => flagMutation.mutate({ guideId: flagTargetId, reason, notes })}
        />
      )}
    </div>
  );
}
