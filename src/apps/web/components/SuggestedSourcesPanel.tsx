'use client';

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowTopRightOnSquareIcon, GlobeAltIcon, PlayCircleIcon } from "@heroicons/react/24/outline";
import { decideSourceSuggestion, listSourceSuggestions } from "../lib/api";
import type { SourceSuggestion } from "../lib/types";

interface Props {
  hubId: string;
  canReview: boolean;
  onAccepted?: () => void;
}

export function SuggestedSourcesPanel({ hubId, canReview, onAccepted }: Props) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["source-suggestions", hubId],
    queryFn: () => listSourceSuggestions({ hubId, status: "pending" }),
    refetchInterval: 4000,
  });

  const decisionMutation = useMutation({
    mutationFn: ({ suggestionId, action }: { suggestionId: string; action: "accepted" | "declined" }) =>
      decideSourceSuggestion(suggestionId, { action }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["source-suggestions", hubId] });
      if (variables.action === "accepted") {
        queryClient.invalidateQueries({ queryKey: ["sources", hubId] });
        onAccepted?.();
      }
    },
  });

  const suggestions = data ?? [];

  return (
    <div className="card grid" style={{ gap: "12px" }}>
      <div>
        <h3 style={{ margin: 0 }}>Suggested sources</h3>
        <p className="muted" style={{ marginTop: "4px" }}>
          Review automatically discovered web pages and videos related to this hub.
        </p>
      </div>
      {isLoading && <p className="muted">Loading suggestions...</p>}
      {error && <p className="muted">Failed to load suggestions: {(error as Error).message}</p>}
      {!isLoading && !error && suggestions.length === 0 && (
        <p className="muted">No pending source suggestions.</p>
      )}
      <div className="grid" style={{ gap: "12px" }}>
        {suggestions.map((suggestion) => {
          const isBusy = decisionMutation.isPending;
          return (
            <div key={suggestion.id} className="card" style={{ borderColor: "#283042" }}>
              <div className="grid" style={{ gap: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start" }}>
                  <div style={{ display: "flex", gap: "10px" }}>
                    {suggestion.type === "web" ? (
                      <GlobeAltIcon className="sources__type-icon sources__type-icon--web" />
                    ) : (
                      <PlayCircleIcon className="sources__type-icon sources__type-icon--youtube" />
                    )}
                    <div>
                      <strong>{suggestion.title || readableTarget(suggestion)}</strong>
                      <p className="muted" style={{ margin: "4px 0 0" }}>
                        {suggestion.type === "web" ? "Web page" : "YouTube"} | Confidence {Math.round(suggestion.confidence * 100)}%
                      </p>
                    </div>
                  </div>
                  <a
                    className="button--small"
                    href={suggestion.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    Inspect
                    <ArrowTopRightOnSquareIcon style={{ width: "16px", height: "16px" }} />
                  </a>
                </div>
                <p className="muted" style={{ margin: 0 }}>{readableTarget(suggestion)}</p>
                {suggestion.description && <p style={{ margin: 0 }}>{suggestion.description}</p>}
                {suggestion.rationale && <p className="muted" style={{ margin: 0 }}>{suggestion.rationale}</p>}
                {canReview ? (
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <button
                      className="button"
                      type="button"
                      onClick={() => decisionMutation.mutate({ suggestionId: suggestion.id, action: "accepted" })}
                      disabled={isBusy}
                    >
                      {isBusy ? "Saving..." : "Accept"}
                    </button>
                    <button
                      className="button"
                      type="button"
                      onClick={() => decisionMutation.mutate({ suggestionId: suggestion.id, action: "declined" })}
                      disabled={isBusy}
                    >
                      Decline
                    </button>
                  </div>
                ) : (
                  <p className="muted" style={{ margin: 0 }}>Only owners and editors can review suggestions.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function readableTarget(suggestion: SourceSuggestion) {
  try {
    const parsed = new URL(suggestion.url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (suggestion.type === "youtube" && suggestion.video_id) {
      return `${host} • ${suggestion.video_id}`;
    }
    return `${host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return suggestion.url;
  }
}
