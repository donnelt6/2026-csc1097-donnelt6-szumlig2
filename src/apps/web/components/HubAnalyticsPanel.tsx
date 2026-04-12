'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "@heroicons/react/24/outline";

import { getHubAnalyticsSummary, getHubAnalyticsTrends } from "../lib/api";
import type { AnalyticsTopSource, ChatAnalyticsTrendPoint, MembershipRole } from "../lib/types";

type TopSourcesMode = "opens" | "returns" | "flags";

function MetricCard({
  label,
  value,
  hint,
  hintClassName,
}: {
  label: string;
  value: string;
  hint?: string;
  hintClassName?: string;
}) {
  return (
    <div className="hub-analytics__metric card">
      <span className="hub-analytics__metric-label">{label}</span>
      <strong className="hub-analytics__metric-value">{value}</strong>
      {hint && <span className={`hub-analytics__metric-hint${hintClassName ? ` ${hintClassName}` : ""}`}>{hint}</span>}
    </div>
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function getLatencyStatus(latencyMs: number): { label: string; className: string } {
  if (latencyMs <= 3000) {
    return { label: "Fast", className: "hub-analytics__metric-hint--fast" };
  }
  if (latencyMs <= 8000) {
    return { label: "Normal", className: "hub-analytics__metric-hint--normal" };
  }
  return { label: "Slow", className: "hub-analytics__metric-hint--slow" };
}

export function HubAnalyticsPanel({
  hubId,
  hubRole,
}: {
  hubId: string;
  hubRole?: MembershipRole | null;
}) {
  const router = useRouter();
  const canViewAnalytics = hubRole === "owner" || hubRole === "admin";
  const [topSourcesMode, setTopSourcesMode] = useState<TopSourcesMode>("opens");
  const [topSourcesMenuOpen, setTopSourcesMenuOpen] = useState(false);
  const topSourcesMenuRef = useRef<HTMLDivElement>(null);

  const handleSourceClick = (sourceId: string) => {
    router.push(`/hubs/${hubId}?tab=sources&focusSource=${sourceId}`);
  };

  useEffect(() => {
    if (!topSourcesMenuOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (topSourcesMenuRef.current && !topSourcesMenuRef.current.contains(event.target as Node)) {
        setTopSourcesMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [topSourcesMenuOpen]);

  const summaryQuery = useQuery({
    queryKey: ["hub-analytics-summary", hubId],
    queryFn: () => getHubAnalyticsSummary(hubId),
    enabled: canViewAnalytics,
    staleTime: 30_000,
  });

  const trendsQuery = useQuery({
    queryKey: ["hub-analytics-trends", hubId],
    queryFn: () => getHubAnalyticsTrends(hubId),
    enabled: canViewAnalytics,
    staleTime: 30_000,
  });

  const maxQuestions = useMemo(() => {
    const values = (trendsQuery.data?.points ?? []).map((point) => point.questions);
    return Math.max(...values, 1);
  }, [trendsQuery.data]);

  if (!canViewAnalytics) {
    return <p className="muted">Only hub owners and admins can view AI analytics for this hub.</p>;
  }

  if (summaryQuery.isLoading || trendsQuery.isLoading) {
    return <p className="muted">Loading AI analytics...</p>;
  }

  if (summaryQuery.error) {
    return <p className="muted">Failed to load analytics: {(summaryQuery.error as Error).message}</p>;
  }

  if (trendsQuery.error) {
    return <p className="muted">Failed to load analytics trends: {(trendsQuery.error as Error).message}</p>;
  }

  const summary = summaryQuery.data;
  const trends = trendsQuery.data;
  if (!summary || !trends) {
    return <p className="muted">No analytics available yet.</p>;
  }

  if (summary.total_questions === 0) {
    return (
      <div className="card hub-analytics__empty">
        <strong>No AI analytics yet</strong>
        <p className="muted">
          Analytics appear after chat questions are asked and users interact with citations or feedback controls.
        </p>
      </div>
    );
  }

  const latencyStatus = getLatencyStatus(summary.average_latency_ms);
  const sortedTopSources = [...summary.top_sources]
    .filter((source) => topSourcesMode !== "flags" || source.citation_flags > 0)
    .sort((left, right) => compareTopSources(left, right, topSourcesMode))
    .slice(0, 5);
  const topSourcesModeLabel =
    topSourcesMode === "opens" ? "By citation opens"
    : topSourcesMode === "returns" ? "By citations returned"
    : "By flags";
  const neverCitedSources = summary.never_cited_sources ?? [];
  const neverCitedCount = summary.never_cited_count ?? neverCitedSources.length;
  const totalCompleteSources = summary.total_complete_sources ?? 0;

  return (
    <div className="hub-analytics">
      <div className="hub-analytics__metrics">
        <MetricCard label="Questions" value={String(summary.total_questions)} hint={`Last ${summary.window_days} days`} />
        <MetricCard label="Helpful rate" value={formatPercent(summary.helpful_rate)} hint={`${summary.helpful_count} helpful`} />
        <MetricCard
          label="Citation opens"
          value={String(summary.citation_open_count)}
          hint={`${formatPercent(summary.citation_open_rate)} of total citations returned`}
        />
        <MetricCard
          label="Citation flags"
          value={String(summary.citation_flag_count)}
          hint={`${formatPercent(summary.citation_flag_rate)} of total citations returned`}
        />
        <MetricCard
          label="Avg latency"
          value={`${Math.round(summary.average_latency_ms)} ms`}
          hint={latencyStatus.label}
          hintClassName={latencyStatus.className}
        />
        <MetricCard label="Rewrite usage" value={formatPercent(summary.rewrite_usage_rate)} hint={`Zero-hit ${formatPercent(summary.zero_hit_rate)}`} />
      </div>

      <div className="hub-analytics__grid">
        <section className="card hub-analytics__panel hub-analytics__panel--wide">
          <div className="hub-analytics__panel-header">
            <h4>Recent trend</h4>
            <span className="muted">{trends.window_days} days</span>
          </div>
          <div className="hub-analytics__trend">
            {trends.points.map((point) => (
              <TrendBar key={point.date} point={point} maxQuestions={maxQuestions} />
            ))}
          </div>
          <div className="hub-analytics__trend-legend">
            <span className="hub-analytics__trend-legend-item">
              <span className="hub-analytics__trend-legend-dot" /> Asked
            </span>
            <span className="hub-analytics__trend-legend-item">
              <span className="hub-analytics__trend-legend-dot hub-analytics__trend-legend-dot--unhelpful" /> Unhelpful
            </span>
          </div>
        </section>

        <section className="card hub-analytics__panel">
          <div className="hub-analytics__panel-header">
            <h4>Top cited sources</h4>
            <div className="hub-analytics__source-filter" ref={topSourcesMenuRef}>
              <button
                type="button"
                className="hub-analytics__source-filter-button"
                onClick={() => setTopSourcesMenuOpen((current) => !current)}
                aria-haspopup="menu"
                aria-expanded={topSourcesMenuOpen}
              >
                <span className="muted">{topSourcesModeLabel}</span>
                <ChevronDownIcon className={`hub-analytics__source-filter-icon${topSourcesMenuOpen ? " hub-analytics__source-filter-icon--open" : ""}`} />
              </button>
              {topSourcesMenuOpen && (
                <div className="hub-analytics__source-filter-menu" role="menu">
                  <button
                    type="button"
                    className="hub-analytics__source-filter-option"
                    onClick={() => {
                      setTopSourcesMode("opens");
                      setTopSourcesMenuOpen(false);
                    }}
                    role="menuitem"
                  >
                    By citation opens
                  </button>
                  <button
                    type="button"
                    className="hub-analytics__source-filter-option"
                    onClick={() => {
                      setTopSourcesMode("returns");
                      setTopSourcesMenuOpen(false);
                    }}
                    role="menuitem"
                  >
                    By citations returned
                  </button>
                  <button
                    type="button"
                    className="hub-analytics__source-filter-option"
                    onClick={() => {
                      setTopSourcesMode("flags");
                      setTopSourcesMenuOpen(false);
                    }}
                    role="menuitem"
                  >
                    By flags
                  </button>
                </div>
              )}
            </div>
          </div>
          {sortedTopSources.length === 0 ? (
            <p className="muted">
              {topSourcesMode === "flags"
                ? "No sources have been flagged in this window."
                : "No citation interactions recorded yet."}
            </p>
          ) : (
            <div className="hub-analytics__source-list">
              {sortedTopSources.map((source) => (
                <button
                  key={source.source_id}
                  type="button"
                  className="hub-analytics__source-row hub-analytics__source-row--clickable"
                  onClick={() => handleSourceClick(source.source_id)}
                  title={source.source_name ?? source.source_id}
                >
                  <strong className="hub-analytics__source-name">{source.source_name ?? source.source_id}</strong>
                  <div className="hub-analytics__source-stats">
                    <span>{source.citation_returns} returned</span>
                    <span>{source.citation_opens} opens</span>
                    <span>{source.citation_flags} flags</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="card hub-analytics__panel">
          <div className="hub-analytics__panel-header">
            <h4>Coverage gaps</h4>
            <span className="muted">
              {totalCompleteSources > 0
                ? `${neverCitedCount} of ${totalCompleteSources} never cited`
                : "No sources"}
            </span>
          </div>
          {neverCitedSources.length === 0 ? (
            <p className="muted">
              {neverCitedCount === 0 && totalCompleteSources > 0
                ? "Every source has been cited at least once. Nice."
                : "No sources to show."}
            </p>
          ) : (
            <div className="hub-analytics__source-list">
              {neverCitedSources.map((source) => (
                <button
                  key={source.source_id}
                  type="button"
                  className="hub-analytics__source-row hub-analytics__source-row--clickable"
                  onClick={() => handleSourceClick(source.source_id)}
                  title={source.source_name ?? source.source_id}
                >
                  <strong className="hub-analytics__source-name">{source.source_name ?? source.source_id}</strong>
                  <span className="hub-analytics__coverage-tag">Never cited</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function compareTopSources(left: AnalyticsTopSource, right: AnalyticsTopSource, mode: TopSourcesMode): number {
  const primaryBy = mode === "opens" ? "citation_opens" : mode === "returns" ? "citation_returns" : "citation_flags";
  const primary = right[primaryBy] - left[primaryBy];
  if (primary !== 0) {
    return primary;
  }
  // Secondary ordering: whichever other metric is most signal-rich
  const secondary = (right.citation_opens + right.citation_returns) - (left.citation_opens + left.citation_returns);
  if (secondary !== 0) {
    return secondary;
  }
  return left.source_id.localeCompare(right.source_id);
}

function TrendBar({ point, maxQuestions }: { point: ChatAnalyticsTrendPoint; maxQuestions: number }) {
  const height = point.questions > 0 ? Math.max(6, Math.round((point.questions / maxQuestions) * 72)) : 0;
  const notHelpful = point.not_helpful ?? 0;
  const unhelpfulHeight = notHelpful > 0 ? Math.max(4, Math.round((notHelpful / maxQuestions) * 72)) : 0;
  const title = `${point.date}: ${point.questions} questions, ${point.helpful} helpful, ${notHelpful} unhelpful`;
  return (
    <div className="hub-analytics__trend-day" title={title}>
      <div className="hub-analytics__trend-bars">
        {height > 0 ? <span className="hub-analytics__trend-bar" style={{ height }} /> : null}
        {unhelpfulHeight > 0 ? (
          <span className="hub-analytics__trend-bar hub-analytics__trend-bar--unhelpful" style={{ height: unhelpfulHeight }} />
        ) : null}
      </div>
      <span className="hub-analytics__trend-label">{point.date.slice(5)}</span>
    </div>
  );
}
