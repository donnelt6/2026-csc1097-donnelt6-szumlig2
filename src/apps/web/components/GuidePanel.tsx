'use client';

// GuidePanel.tsx: Study guide management panel for generating and viewing guides.

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
import { CSS } from "@dnd-kit/utilities";
import {
  archiveGuide,
  createGuideStep,
  generateGuide,
  listGuides,
  reorderGuideSteps,
  updateGuide,
  updateGuideStep,
  updateGuideStepProgress,
} from "../lib/api";
import type { Citation, GuideEntry, GuideStep } from "../lib/types";

interface Props {
  hubId: string;
  selectedSourceIds: string[];
  hasSelectableSources: boolean;
  canEdit: boolean;
}

interface StepDraftValues {
  title: string;
  instruction: string;
}

interface SortableStepProps {
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
}

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
}: SortableStepProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
    disabled: !canEdit,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={{ border: "1px solid #1e2535", borderRadius: "12px", padding: "10px", ...style }}
    >
      <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
        {canEdit && (
          <button
            className="drag-handle"
            type="button"
            aria-label="Reorder step"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
          >
            ⋮⋮
          </button>
        )}
        <input
          type="checkbox"
          checked={!!step.is_complete}
          onChange={() => onToggleProgress(step)}
          disabled={isDragging}
          className="guide-checkbox"
        />
        <div style={{ flex: 1 }}>
          <span className="muted">Step {index + 1}</span>
          {!isEditing && (
            <>
              {step.title && <strong>{step.title}</strong>}
              <p style={{ whiteSpace: "pre-wrap", marginTop: step.title ? "6px" : 0 }}>{step.instruction}</p>
            </>
          )}
          {isEditing && (
            <div className="grid" style={{ gap: "6px" }}>
              <input
                type="text"
                placeholder="Step title (optional)"
                value={draft.title}
                onChange={(event) => onUpdateDraft(step, { title: event.target.value })}
              />
              <textarea
                value={draft.instruction}
                onChange={(event) => onUpdateDraft(step, { instruction: event.target.value })}
              />
            </div>
          )}
          {step.citations.length > 0 && !isEditing && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "6px" }}>
              {step.citations.map((citation, citationIndex) => {
                const preview =
                  citation.snippet.length > 120 ? `${citation.snippet.slice(0, 120)}...` : citation.snippet;
                return (
                  <button
                    key={`${citation.source_id}-${citation.chunk_index ?? citationIndex}`}
                    onClick={() => onCitationClick(citation)}
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
        {canEdit && (
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {!isEditing && (
              <button className="button" type="button" onClick={() => onStartEdit(step)}>
                Edit
              </button>
            )}
            {isEditing && (
              <>
                <button className="button" type="button" onClick={() => onSaveEdit(step)}>
                  Save
                </button>
                <button className="button" type="button" onClick={onCancelEdit}>
                  Cancel
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function GuidePanel({ hubId, selectedSourceIds, hasSelectableSources, canEdit }: Props) {
  const queryClient = useQueryClient();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [stepCountInput, setStepCountInput] = useState("8");
  const [editingGuideId, setEditingGuideId] = useState<string | null>(null);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [guideDrafts, setGuideDrafts] = useState<Record<string, string>>({});
  const [stepDrafts, setStepDrafts] = useState<Record<string, StepDraftValues>>({});
  const [newStepDrafts, setNewStepDrafts] = useState<Record<string, StepDraftValues>>({});
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["guides", hubId],
    queryFn: () => listGuides(hubId),
  });

  const guides = useMemo(() => data ?? [], [data]);
  const hasSelection = selectedSourceIds.length > 0;
  const canGenerate = canEdit && hasSelection;

  const generateMutation = useMutation({
    mutationFn: () => {
      const requestedStepCount = Math.max(1, Math.min(20, Number(stepCountInput) || 1));
      return generateGuide({
        hub_id: hubId,
        source_ids: selectedSourceIds,
        topic: topic.trim() || undefined,
        step_count: requestedStepCount,
      });
    },
    onSuccess: (data) => {
      const requestedStepCount = Math.max(1, Math.min(20, Number(stepCountInput) || 1));
      const actualSteps = data.entry?.steps?.length ?? 0;
      setStatusMessage(`Generated ${actualSteps} of ${requestedStepCount} steps.`);
      queryClient.invalidateQueries({ queryKey: ["guides", hubId] });
    },
    onError: (err) => setStatusMessage((err as Error).message),
  });

  const updateGuideMutation = useMutation({
    mutationFn: ({ guideId, payload }: { guideId: string; payload: Parameters<typeof updateGuide>[1] }) =>
      updateGuide(guideId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["guides", hubId] });
    },
    onError: (err) => setStatusMessage((err as Error).message),
  });

  const updateStepMutation = useMutation({
    mutationFn: ({ stepId, payload }: { stepId: string; payload: Parameters<typeof updateGuideStep>[1] }) =>
      updateGuideStep(stepId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["guides", hubId] });
    },
    onError: (err) => setStatusMessage((err as Error).message),
  });

  const createStepMutation = useMutation({
    mutationFn: ({ guideId, payload }: { guideId: string; payload: Parameters<typeof createGuideStep>[1] }) =>
      createGuideStep(guideId, payload),
    onSuccess: (_data, variables) => {
      setNewStepDrafts((prev) => ({
        ...prev,
        [variables.guideId]: { title: "", instruction: "" },
      }));
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
            step.id === stepId
              ? {
                  ...step,
                  is_complete,
                  completed_at: is_complete ? new Date().toISOString() : null,
                }
              : step
          ),
        }));
        queryClient.setQueryData(["guides", hubId], next);
      }
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["guides", hubId] });
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["guides", hubId], context.previous);
      }
      setStatusMessage((err as Error).message);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (guideId: string) => archiveGuide(guideId),
    onSuccess: () => {
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
          const stepMap = new Map(guide.steps.map((step) => [step.id, step]));
          const reordered = orderedIds
            .map((id) => stepMap.get(id))
            .filter((step): step is GuideStep => !!step)
            .map((step, index) => ({ ...step, step_index: index + 1 }));
          return { ...guide, steps: reordered };
        });
        queryClient.setQueryData(["guides", hubId], next);
      }
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["guides", hubId] });
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["guides", hubId], context.previous);
      }
      setStatusMessage((err as Error).message);
    },
  });

  const buildStepDraft = (step: GuideStep): StepDraftValues => ({
    title: step.title ?? "",
    instruction: step.instruction,
  });

  const getStepDraft = (step: GuideStep) => stepDrafts[step.id] ?? buildStepDraft(step);

  const updateStepDraft = (step: GuideStep, updates: Partial<StepDraftValues>) => {
    setStepDrafts((prev) => ({
      ...prev,
      [step.id]: { ...(prev[step.id] ?? buildStepDraft(step)), ...updates },
    }));
  };

  const startGuideEditing = (guide: GuideEntry) => {
    setEditingGuideId(guide.id);
    setGuideDrafts((prev) => ({ ...prev, [guide.id]: prev[guide.id] ?? guide.title }));
  };

  const saveGuideEditing = (guide: GuideEntry) => {
    const draft = (guideDrafts[guide.id] ?? guide.title).trim();
    updateGuideMutation.mutate({ guideId: guide.id, payload: { title: draft } });
    setEditingGuideId(null);
  };

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
    const instruction = draft.instruction.trim();
    if (!instruction) {
      setStatusMessage("Step instructions are required.");
      return;
    }
    createStepMutation.mutate({
      guideId: guide.id,
      payload: { title: draft.title.trim() || undefined, instruction },
    });
  };

  const handleDragEnd = (event: DragEndEvent, guide: GuideEntry) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = guide.steps.findIndex((step) => step.id === active.id);
    const newIndex = guide.steps.findIndex((step) => step.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const ordered = arrayMove(guide.steps, oldIndex, newIndex);
    const orderedIds = ordered.map((step) => step.id);
    reorderMutation.mutate({ guideId: guide.id, orderedIds });
  };

  const toggleProgress = (step: GuideStep) => {
    progressMutation.mutate({ stepId: step.id, is_complete: !step.is_complete });
  };

  const handleArchive = (guide: GuideEntry) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Archive this guide? You can generate a new one later.");
      if (!confirmed) return;
    }
    archiveMutation.mutate(guide.id);
  };

  return (
    <div className="card grid">
      <div>
        <h3 style={{ margin: 0 }}>Guides</h3>
        <p className="muted">Generate step-by-step checklists from your selected sources.</p>
      </div>
      <div className="grid" style={{ gap: "10px" }}>
        <label>
          <span className="muted">What do you want a guide for?</span>
          <input
            type="text"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="e.g. New hire onboarding"
          />
        </label>
        <label>
          <span className="muted">How many steps?</span>
          <input
            type="number"
            min={1}
            max={20}
            value={stepCountInput}
            onChange={(event) => {
              setStepCountInput(event.target.value);
            }}
            onBlur={() => {
              const value = Math.max(1, Math.min(20, Number(stepCountInput) || 1));
              setStepCountInput(String(value));
            }}
          />
        </label>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          {canEdit && (
            <button className="button" onClick={() => generateMutation.mutate()} disabled={!canGenerate || generateMutation.isPending}>
              {generateMutation.isPending ? "Generating..." : "Generate Guide"}
            </button>
          )}
          {!hasSelectableSources && <p className="muted">Upload and process sources to generate guides.</p>}
          {hasSelectableSources && !hasSelection && (
            <p className="muted">Select at least one source to generate guides.</p>
          )}
          {!canEdit && <p className="muted">Only owners, admins, and editors can generate or edit guides.</p>}
        </div>
      </div>
      {statusMessage && <p className="muted">{statusMessage}</p>}
      {isLoading && <p className="muted">Loading guides...</p>}
      {error && <p className="muted">Failed to load guides: {(error as Error).message}</p>}
      {!isLoading && !error && guides.length === 0 && (
        <p className="muted">No guides yet. Generate one from your selected sources.</p>
      )}
      <div className="grid" style={{ gap: "12px" }}>
        {guides.map((guide) => {
          const isEditingGuide = editingGuideId === guide.id;
          const titleDraft = guideDrafts[guide.id] ?? guide.title;
          const totalSteps = guide.steps.length;
          const completedSteps = guide.steps.filter((step) => step.is_complete).length;
          return (
            <div key={guide.id} className="card" style={{ borderColor: "#1e2535" }}>
              <div className="grid" style={{ gap: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                  {!isEditingGuide && <strong>{guide.title}</strong>}
                  {isEditingGuide && (
                    <input
                      type="text"
                      value={titleDraft}
                      onChange={(event) =>
                        setGuideDrafts((prev) => ({ ...prev, [guide.id]: event.target.value }))
                      }
                    />
                  )}
                  {canEdit && (
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {!isEditingGuide && (
                        <button className="button" type="button" onClick={() => startGuideEditing(guide)}>
                          Edit title
                        </button>
                      )}
                      {isEditingGuide && (
                        <>
                          <button className="button" type="button" onClick={() => saveGuideEditing(guide)}>
                            Save
                          </button>
                          <button className="button" type="button" onClick={() => setEditingGuideId(null)}>
                            Cancel
                          </button>
                        </>
                      )}
                      <button className="button" type="button" onClick={() => handleArchive(guide)}>
                        Archive
                      </button>
                    </div>
                  )}
                </div>
                {guide.topic && <p className="muted" style={{ marginTop: 0 }}>Topic: {guide.topic}</p>}
                {totalSteps > 0 && (
                  <p className="muted" style={{ marginTop: 0 }}>
                    Progress: {completedSteps}/{totalSteps} complete
                  </p>
                )}
                <div className="grid" style={{ gap: "8px" }}>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(event) => handleDragEnd(event, guide)}
                  >
                    <SortableContext items={guide.steps.map((step) => step.id)} strategy={verticalListSortingStrategy}>
                      {guide.steps.map((step, index) => {
                        const isEditingStep = editingStepId === step.id;
                        const draft = getStepDraft(step);
                        return (
                          <SortableStepRow
                            key={step.id}
                            step={step}
                            index={index}
                            canEdit={canEdit}
                            isEditing={isEditingStep}
                            draft={draft}
                            onToggleProgress={toggleProgress}
                            onStartEdit={startStepEditing}
                            onSaveEdit={saveStepEditing}
                            onCancelEdit={() => setEditingStepId(null)}
                            onUpdateDraft={updateStepDraft}
                            onCitationClick={setActiveCitation}
                          />
                        );
                      })}
                    </SortableContext>
                  </DndContext>
                  {canEdit && (
                    <div className="card" style={{ borderColor: "#1e2535" }}>
                      <div className="grid" style={{ gap: "8px" }}>
                        <strong>Add a step</strong>
                        <input
                          type="text"
                          placeholder="Step title (optional)"
                          value={getNewStepDraft(guide.id).title}
                          onChange={(event) => updateNewStepDraft(guide.id, { title: event.target.value })}
                        />
                        <textarea
                          placeholder="Step instructions"
                          value={getNewStepDraft(guide.id).instruction}
                          onChange={(event) => updateNewStepDraft(guide.id, { instruction: event.target.value })}
                        />
                        <button
                          className="button"
                          type="button"
                          onClick={() => addStep(guide)}
                          disabled={createStepMutation.isPending}
                        >
                          {createStepMutation.isPending ? "Adding..." : "Add step"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
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
