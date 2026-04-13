'use client';

// ReminderCandidatesPanel.tsx: AI-suggested reminder candidates for review and approval.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { decideReminderCandidate, listReminderCandidates } from "../lib/api";
import type { ReminderCandidate } from "../lib/types";
import { formatLocal, toLocalInputValue, toIsoFromLocalInput } from "../lib/dateUtils";

interface Props {
  hubId: string;
}

interface DraftValues {
  dueAt: string;
  message: string;
}

export function ReminderCandidatesPanel({ hubId }: Props) {
  const queryClient = useQueryClient();
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, DraftValues>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ["reminder-candidates", hubId],
    queryFn: () => listReminderCandidates({ hubId, status: "pending" }),
    refetchInterval: 4000,
  });

  type ReminderDecisionPayload = Parameters<typeof decideReminderCandidate>[1];

  const decisionMutation = useMutation({
    mutationFn: ({ candidateId, payload }: { candidateId: string; payload: ReminderDecisionPayload }) =>
      decideReminderCandidate(candidateId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reminder-candidates", hubId] });
      queryClient.invalidateQueries({ queryKey: ["reminders", hubId] });
    },
  });

  const candidates = data ?? [];

  const toggleExpanded = (candidateId: string) => {
    setExpanded((prev) => ({ ...prev, [candidateId]: !prev[candidateId] }));
  };

  const buildDefaultDraft = (candidate: ReminderCandidate): DraftValues => ({
    dueAt: toLocalInputValue(candidate.due_at),
    message: candidate.snippet || candidate.title_suggestion || "",
  });

  const getDraft = (candidate: ReminderCandidate) => {
    return drafts[candidate.id] ?? buildDefaultDraft(candidate);
  };

  const updateDraft = (candidate: ReminderCandidate, updates: Partial<DraftValues>) => {
    setDrafts((prev) => ({
      ...prev,
      [candidate.id]: { ...(prev[candidate.id] ?? buildDefaultDraft(candidate)), ...updates },
    }));
  };

  const handleDecision = (candidate: ReminderCandidate, action: "accepted" | "declined") => {
    const draft = getDraft(candidate);
    const payload: ReminderDecisionPayload = { action };
    if (action === "accepted") {
      payload.timezone = timezone;
      if (draft.dueAt) {
        const editedDue = toIsoFromLocalInput(draft.dueAt);
        if (editedDue) payload.edited_due_at = editedDue;
      }
      if (draft.message.trim()) {
        payload.edited_message = draft.message.trim();
      }
    }
    decisionMutation.mutate({ candidateId: candidate.id, payload });
  };

  return (
    <div className="card grid">
      <div>
        <h3 style={{ margin: 0 }}>Suggested reminders</h3>
        <p className="muted">Review detected deadlines and confirm the ones you want.</p>
      </div>
      {isLoading && <p className="muted">Loading suggestions...</p>}
      {error && <p className="muted">Failed to load suggestions: {(error as Error).message}</p>}
      {!isLoading && !error && candidates.length === 0 && (
        <p className="muted">No pending reminder suggestions.</p>
      )}
      <div className="grid" style={{ gap: "12px" }}>
        {candidates.map((candidate) => {
          const draft = getDraft(candidate);
          const isExpanded = !!expanded[candidate.id];
          return (
            <div key={candidate.id} className="card" style={{ borderColor: "#283042" }}>
              <div className="grid" style={{ gap: "8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                  <div>
                    <strong>{candidate.title_suggestion ?? "Potential deadline"}</strong>
                    <p className="muted" style={{ marginTop: "4px" }}>
                      Due {formatLocal(candidate.due_at)} | Confidence {Math.round(candidate.confidence * 100)}%
                    </p>
                  </div>
                  <button className="button" type="button" onClick={() => toggleExpanded(candidate.id)}>
                    {isExpanded ? "Hide" : "Edit"}
                  </button>
                </div>
                <p className="muted" style={{ margin: 0 }}>{candidate.snippet}</p>
                {isExpanded && (
                  <div className="grid" style={{ gap: "8px" }}>
                    <label>
                      <span className="muted">Due date</span>
                      <input
                        type="datetime-local"
                        value={draft.dueAt}
                        onChange={(e) => updateDraft(candidate, { dueAt: e.target.value })}
                      />
                    </label>
                    <label>
                      <span className="muted">Message</span>
                      <textarea
                        value={draft.message}
                        onChange={(e) => updateDraft(candidate, { message: e.target.value })}
                        placeholder="Add a custom reminder message"
                      />
                    </label>
                  </div>
                )}
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <button
                    className="button"
                    type="button"
                    onClick={() => handleDecision(candidate, "accepted")}
                    disabled={decisionMutation.isPending}
                  >
                    {decisionMutation.isPending ? "Saving..." : "Accept"}
                  </button>
                  <button
                    className="button"
                    type="button"
                    onClick={() => handleDecision(candidate, "declined")}
                    disabled={decisionMutation.isPending}
                  >
                    Decline
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

