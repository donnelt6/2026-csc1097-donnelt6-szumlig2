'use client';

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  applyFlaggedChatRevision,
  createFlaggedChatRevision,
  dismissFlaggedChat,
  getFlaggedChat,
  listFlaggedChats,
  regenerateFlaggedChat,
} from "../lib/api";
import type { Citation, FlagCaseStatus, MessageRevision, MembershipRole } from "../lib/types";

const STATUS_OPTIONS: Array<{ value: "all" | FlagCaseStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_review", label: "In review" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
];

interface HubModerationPanelProps {
  hubId: string;
  hubRole?: MembershipRole | null;
}

export function HubModerationPanel({ hubId, hubRole }: HubModerationPanelProps) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"all" | FlagCaseStatus>("all");
  const [selectedFlagId, setSelectedFlagId] = useState<string | null>(null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string>("");
  const [draftContent, setDraftContent] = useState("");
  const [draftCitations, setDraftCitations] = useState("[]");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [loadedCaseId, setLoadedCaseId] = useState<string | null>(null);
  const [pendingRevisionSelectionId, setPendingRevisionSelectionId] = useState<string | null>(null);
  const [syncDraftFromDetail, setSyncDraftFromDetail] = useState(false);

  const canModerate = hubRole === "owner" || hubRole === "admin";

  const queueQuery = useQuery({
    queryKey: ["flagged-chats", hubId, statusFilter],
    queryFn: () =>
      listFlaggedChats(hubId, {
        status: statusFilter === "all" ? undefined : statusFilter,
      }),
    enabled: canModerate,
    refetchInterval: canModerate ? 5000 : false,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!selectedFlagId && queueQuery.data?.length) {
      setSelectedFlagId(queueQuery.data[0].id);
    }
    if (selectedFlagId && queueQuery.data && !queueQuery.data.some((item) => item.id === selectedFlagId)) {
      setSelectedFlagId(queueQuery.data[0]?.id ?? null);
    }
  }, [queueQuery.data, selectedFlagId]);

  const detailQuery = useQuery({
    queryKey: ["flagged-chat", hubId, selectedFlagId],
    queryFn: () => getFlaggedChat(hubId, selectedFlagId!),
    enabled: canModerate && !!selectedFlagId,
    refetchInterval: canModerate && !!selectedFlagId ? 5000 : false,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!detailQuery.data) {
      return;
    }
    const caseChanged = loadedCaseId !== detailQuery.data.case.id;
    const selectedRevisionStillExists = !!selectedRevisionId && detailQuery.data.revisions.some(
      (revision) => revision.id === selectedRevisionId
    );
    const desiredRevisionId =
      (pendingRevisionSelectionId && detailQuery.data.revisions.some((revision) => revision.id === pendingRevisionSelectionId)
        ? pendingRevisionSelectionId
        : selectedRevisionStillExists
          ? selectedRevisionId
          : detailQuery.data.revisions.find((revision) => revision.revision_type !== "original")?.id) ?? "";
    const shouldSyncDraft = caseChanged || syncDraftFromDetail || desiredRevisionId !== selectedRevisionId;
    const selectedRevision = detailQuery.data.revisions.find((revision) => revision.id === desiredRevisionId);

    if (desiredRevisionId !== selectedRevisionId) {
      setSelectedRevisionId(desiredRevisionId);
    }
    if (shouldSyncDraft) {
      setDraftContent(selectedRevision?.content ?? detailQuery.data.flagged_message.content);
      setDraftCitations(JSON.stringify(selectedRevision?.citations ?? detailQuery.data.flagged_message.citations, null, 2));
      setSyncDraftFromDetail(false);
    }
    if (pendingRevisionSelectionId && desiredRevisionId === pendingRevisionSelectionId) {
      setPendingRevisionSelectionId(null);
    }
    if (caseChanged) {
      setLoadedCaseId(detailQuery.data.case.id);
    }
  }, [detailQuery.data, loadedCaseId, pendingRevisionSelectionId, selectedRevisionId, syncDraftFromDetail]);

  const refreshQueries = async (flagId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["flagged-chats", hubId] }),
      queryClient.invalidateQueries({ queryKey: ["flagged-chat", hubId, flagId] }),
    ]);
  };

  const regenerateMutation = useMutation({
    mutationFn: (flagId: string) => regenerateFlaggedChat(hubId, flagId),
    onSuccess: async (revision, flagId) => {
      setDraftError(null);
      setPendingRevisionSelectionId(revision.id);
      setSyncDraftFromDetail(true);
      await refreshQueries(flagId);
    },
  });

  const manualRevisionMutation = useMutation({
    mutationFn: async (flagId: string) => {
      const trimmedContent = draftContent.trim();
      if (!trimmedContent) {
        throw new Error("Draft content cannot be blank.");
      }
      let citations: Citation[] = [];
      try {
        citations = JSON.parse(draftCitations) as Citation[];
      } catch {
        throw new Error("Citations must be valid JSON.");
      }
      return createFlaggedChatRevision(hubId, flagId, { content: trimmedContent, citations });
    },
    onSuccess: async (revision, flagId) => {
      setDraftError(null);
      setPendingRevisionSelectionId(revision.id);
      setSyncDraftFromDetail(true);
      await refreshQueries(flagId);
    },
    onError: (error) => {
      setDraftError((error as Error).message);
    },
  });

  const applyMutation = useMutation({
    mutationFn: ({ flagId, revisionId }: { flagId: string; revisionId: string }) =>
      applyFlaggedChatRevision(hubId, flagId, revisionId),
    onSuccess: async (_flagCase, variables) => {
      setPendingRevisionSelectionId(variables.revisionId);
      setSyncDraftFromDetail(true);
      await refreshQueries(variables.flagId);
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (flagId: string) => dismissFlaggedChat(hubId, flagId),
    onSuccess: async (_flagCase, flagId) => {
      setSyncDraftFromDetail(true);
      await refreshQueries(flagId);
    },
  });

  const selectedRevision: MessageRevision | undefined = detailQuery.data?.revisions.find(
    (revision) => revision.id === selectedRevisionId
  );
  const isDraftBlank = draftContent.trim().length === 0;

  if (!canModerate) {
    return (
      <section className="card">
        <h3 style={{ marginTop: 0 }}>Admin</h3>
        <p className="muted" style={{ marginBottom: 0 }}>
          Only hub owners and admins can access moderation tools for this hub.
        </p>
      </section>
    );
  }

  return (
    <div className="grid" style={{ gap: "18px" }}>
      <div className="card" style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <label>
          <span className="muted">Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | FlagCaseStatus)}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "minmax(320px, 420px) minmax(0, 1fr)" }}>
        <section className="card grid" style={{ gap: "10px", alignContent: "start" }}>
          <h3 style={{ margin: 0 }}>Flagged chats</h3>
          {queueQuery.isLoading && <p className="muted">Loading queue...</p>}
          {queueQuery.error && <p className="muted">Failed to load queue: {(queueQuery.error as Error).message}</p>}
          {!queueQuery.isLoading && !queueQuery.data?.length && (
            <p className="muted">No flagged chats match the current filter.</p>
          )}
          {queueQuery.data?.map((item) => (
            <button
              key={item.id}
              type="button"
              className="card"
              onClick={() => setSelectedFlagId(item.id)}
              style={{
                textAlign: "left",
                borderColor: selectedFlagId === item.id ? "var(--accent)" : "#1e2535",
                background: selectedFlagId === item.id ? "rgba(255,255,255,0.02)" : undefined,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                <strong>{item.session_title}</strong>
                <span className="role-pill">{item.status}</span>
              </div>
              <p style={{ margin: "10px 0 0" }}><strong>Q:</strong> {item.question_preview}</p>
              <p style={{ margin: "6px 0 0" }}><strong>A:</strong> {item.answer_preview}</p>
              <p className="muted" style={{ margin: "10px 0 0" }}>
                Reason: {item.reason} | Flagged {new Date(item.flagged_at).toLocaleString("en-IE")}
              </p>
            </button>
          ))}
        </section>

        <section className="card grid" style={{ gap: "16px" }}>
          {!selectedFlagId && <p className="muted">Select a flagged chat to review it.</p>}
          {detailQuery.isLoading && selectedFlagId && <p className="muted">Loading flagged chat...</p>}
          {detailQuery.error && <p className="muted">Failed to load flagged chat: {(detailQuery.error as Error).message}</p>}
          {detailQuery.data && (
            <>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                  <div>
                    <h3 style={{ margin: 0 }}>{detailQuery.data.hub_name}</h3>
                    <p className="muted" style={{ margin: "4px 0 0" }}>{detailQuery.data.session_title}</p>
                  </div>
                  <span className="role-pill">{detailQuery.data.case.status}</span>
                </div>
                <p className="muted" style={{ margin: "8px 0 0" }}>
                  Flag reason: {detailQuery.data.case.reason}
                </p>
                {detailQuery.data.case.notes && (
                  <p className="muted" style={{ margin: "6px 0 0" }}>{detailQuery.data.case.notes}</p>
                )}
              </div>

              <div className="grid" style={{ gap: "12px" }}>
                <div className="card" style={{ borderColor: "#1e2535" }}>
                  <strong>User question</strong>
                  <p style={{ margin: "10px 0 0", whiteSpace: "pre-wrap" }}>{detailQuery.data.question_message.content}</p>
                </div>
                <div className="card" style={{ borderColor: "#1e2535" }}>
                  <strong>Current visible answer</strong>
                  <p style={{ margin: "10px 0 0", whiteSpace: "pre-wrap" }}>{detailQuery.data.flagged_message.content}</p>
                </div>
              </div>

              <div className="grid" style={{ gap: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                  <h4 style={{ margin: 0 }}>Revisions</h4>
                  <button
                    className="button"
                    type="button"
                    onClick={() => regenerateMutation.mutate(detailQuery.data.case.id)}
                    disabled={regenerateMutation.isPending || !["open", "in_review"].includes(detailQuery.data.case.status)}
                  >
                    {regenerateMutation.isPending ? "Regenerating..." : "Regenerate draft"}
                  </button>
                </div>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  {detailQuery.data.revisions.map((revision) => (
                    <button
                      key={revision.id}
                      type="button"
                      className="button"
                      onClick={() => {
                        setPendingRevisionSelectionId(null);
                        setSyncDraftFromDetail(false);
                        setSelectedRevisionId(revision.id);
                        setDraftContent(revision.content);
                        setDraftCitations(JSON.stringify(revision.citations, null, 2));
                      }}
                      style={{
                        borderColor: selectedRevisionId === revision.id ? "var(--accent)" : undefined,
                      }}
                    >
                      {revision.revision_type}
                      {detailQuery.data.case.resolved_revision_id === revision.id ? " (live)" : ""}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                <div className="grid" style={{ gap: "8px" }}>
                  <h4 style={{ margin: 0 }}>Manual edit draft</h4>
                  <textarea
                    value={draftContent}
                    onChange={(event) => {
                      setDraftContent(event.target.value);
                      if (draftError) setDraftError(null);
                    }}
                    rows={12}
                    style={{ width: "100%" }}
                  />
                  <textarea
                    value={draftCitations}
                    onChange={(event) => {
                      setDraftCitations(event.target.value);
                      if (draftError) setDraftError(null);
                    }}
                    rows={8}
                    style={{ width: "100%", fontFamily: "monospace" }}
                  />
                  <button
                    className="button"
                    type="button"
                    onClick={() => manualRevisionMutation.mutate(detailQuery.data.case.id)}
                    disabled={
                      manualRevisionMutation.isPending ||
                      isDraftBlank ||
                      !["open", "in_review"].includes(detailQuery.data.case.status)
                    }
                  >
                    {manualRevisionMutation.isPending ? "Saving..." : "Save manual draft"}
                  </button>
                  {draftError && (
                    <p className="muted">{draftError}</p>
                  )}
                  {manualRevisionMutation.error && (
                    !draftError ? <p className="muted">Draft save failed: {(manualRevisionMutation.error as Error).message}</p> : null
                  )}
                </div>

                <div className="grid" style={{ gap: "8px" }}>
                  <h4 style={{ margin: 0 }}>Compare selected revision</h4>
                  <div className="card" style={{ borderColor: "#1e2535" }}>
                    <strong>Current answer</strong>
                    <p style={{ margin: "10px 0 0", whiteSpace: "pre-wrap" }}>{detailQuery.data.flagged_message.content}</p>
                  </div>
                  <div className="card" style={{ borderColor: "#1e2535" }}>
                    <strong>Selected revision</strong>
                    <p style={{ margin: "10px 0 0", whiteSpace: "pre-wrap" }}>
                      {selectedRevision?.content ?? "Select a revision to compare."}
                    </p>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button
                  className="button"
                  type="button"
                  disabled={
                    !selectedRevisionId ||
                    applyMutation.isPending ||
                    !selectedRevision ||
                    isDraftBlank ||
                    selectedRevision.revision_type === "original" ||
                    !["open", "in_review"].includes(detailQuery.data.case.status)
                  }
                  onClick={() =>
                    applyMutation.mutate({
                      flagId: detailQuery.data.case.id,
                      revisionId: selectedRevisionId,
                    })
                  }
                >
                  {applyMutation.isPending ? "Applying..." : "Apply selected draft"}
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={dismissMutation.isPending || !["open", "in_review"].includes(detailQuery.data.case.status)}
                  onClick={() => dismissMutation.mutate(detailQuery.data.case.id)}
                >
                  {dismissMutation.isPending ? "Dismissing..." : "Dismiss flag"}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
