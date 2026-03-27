'use client';

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  ArrowTopRightOnSquareIcon,
  ChevronDownIcon,
  GlobeAltIcon,
  PlayCircleIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import { decideSourceSuggestion, listSourceSuggestions } from "../lib/api";
import type { SourceSuggestion } from "../lib/types";

interface Props {
  hubId: string;
  canReview: boolean;
  onAccepted?: () => void;
}

export function SuggestedSourcesPanel({ hubId, canReview, onAccepted }: Props) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["source-suggestions", hubId],
    queryFn: () => listSourceSuggestions({ hubId, status: "pending" }),
    refetchInterval: 4000,
  });

  const decisionMutation = useMutation({
    mutationFn: ({ suggestionId, action }: { suggestionId: string; action: "accepted" | "declined" }) =>
      decideSourceSuggestion(suggestionId, { action }),
    onMutate: ({ suggestionId }) => {
      setBusySuggestionId(suggestionId);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["source-suggestions", hubId] });
      if (variables.action === "accepted") {
        queryClient.invalidateQueries({ queryKey: ["sources", hubId] });
        onAccepted?.();
      }
    },
    onSettled: () => {
      setBusySuggestionId(null);
    },
  });

  // Click-outside to close
  useEffect(() => {
    if (!expanded) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expanded]);

  const suggestions = data ?? [];

  if (!isLoading && !error && suggestions.length === 0) return null;

  return (
    <div className={`suggested-sources${expanded ? " suggested-sources--open" : ""}`} ref={containerRef}>
      <button
        type="button"
        className="suggested-sources__toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="suggested-sources__toggle-left">
          <SparklesIcon className="suggested-sources__toggle-icon" />
          <span className="suggested-sources__toggle-text">
            {isLoading ? "Loading..." : `${suggestions.length} Suggested Source${suggestions.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <ChevronDownIcon className={`suggested-sources__toggle-chevron${expanded ? " suggested-sources__toggle-chevron--open" : ""}`} />
      </button>

      {expanded && (
        <div className="suggested-sources__body">
          <h4 className="suggested-sources__heading">Suggested Sources</h4>
          {error && <p className="suggested-sources__error">Failed to load suggestions.</p>}

          {suggestions.map((suggestion) => {
            const isBusy = busySuggestionId === suggestion.id;
            return (
              <div key={suggestion.id} className="suggested-sources__item">
                <div className={`sources__resource-icon sources__resource-icon--${suggestion.type}`}>
                  {suggestion.type === "web" ? (
                    <GlobeAltIcon className="sources__type-icon sources__type-icon--web" />
                  ) : (
                    <PlayCircleIcon className="sources__type-icon sources__type-icon--youtube" />
                  )}
                </div>

                <div className="suggested-sources__item-content">
                  <span className="suggested-sources__item-name">
                    {suggestion.title || readableTarget(suggestion)}
                  </span>
                  <div className="suggested-sources__item-meta">
                    <span className="suggested-sources__item-type">
                      {suggestion.type === "web" ? "Web" : "YouTube"}
                    </span>
                    <span className="suggested-sources__item-match">
                      {Math.round(suggestion.confidence * 100)}% match
                    </span>
                  </div>
                  {suggestion.description && (
                    <span className="suggested-sources__item-desc">
                      {suggestion.description}
                    </span>
                  )}
                </div>

                <div className="suggested-sources__item-actions">
                  <a
                    className="suggested-sources__inspect"
                    href={suggestion.url}
                    target="_blank"
                    rel="noreferrer"
                    title="Open in new tab"
                  >
                    <ArrowTopRightOnSquareIcon className="suggested-sources__inspect-icon" />
                  </a>
                  {canReview ? (
                    <>
                      <button
                        className="suggested-sources__btn suggested-sources__btn--accept"
                        type="button"
                        onClick={() => decisionMutation.mutate({ suggestionId: suggestion.id, action: "accepted" })}
                        disabled={isBusy}
                      >
                        {isBusy ? "..." : "Accept"}
                      </button>
                      <button
                        className="suggested-sources__btn suggested-sources__btn--decline"
                        type="button"
                        onClick={() => decisionMutation.mutate({ suggestionId: suggestion.id, action: "declined" })}
                        disabled={isBusy}
                      >
                        Decline
                      </button>
                    </>
                  ) : (
                    <span className="suggested-sources__no-permission">Review not permitted</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function readableTarget(suggestion: SourceSuggestion) {
  try {
    const parsed = new URL(suggestion.url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (suggestion.type === "youtube" && suggestion.video_id) {
      return `${host} \u2022 ${suggestion.video_id}`;
    }
    return `${host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return suggestion.url;
  }
}
