'use client';

// HubAnalyticsPanel.tsx: Hub usage analytics with charts and engagement metrics.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { getHubAnalyticsSummary, getHubAnalyticsTrends } from "../lib/api";
import { useIsPhone } from "../lib/useIsPhone";
import type { AnalyticsTopSource, ChatAnalyticsTrendPoint, MembershipRole } from "@shared/index";

const TOP_SOURCES_PAGE_SIZE_DESKTOP = 6;
const TOP_SOURCES_PAGE_SIZE_PHONE = 5;

type TopSourcesMode = "opens" | "returns" | "flags";

function HubAnalyticsMetricSkeleton({ index }: { index: number }) {
  return (
    <div className="hub-analytics__metric card hub-analytics__metric--skeleton" aria-hidden="true" data-testid={`hub-analytics-metric-skeleton-${index}`}>
      <span className="hub-analytics__metric-label-skeleton dash-skeleton" />
      <span className="hub-analytics__metric-value-skeleton dash-skeleton" />
      <span className="hub-analytics__metric-hint-skeleton dash-skeleton" />
    </div>
  );
}

function HubAnalyticsTrendSkeleton() {
  return (
    <section className="card hub-analytics__panel hub-analytics__panel--wide" aria-hidden="true" data-testid="hub-analytics-trend-skeleton">
      <div className="hub-analytics__panel-header">
        <span className="hub-analytics__panel-title-skeleton dash-skeleton" />
        <span className="hub-analytics__panel-meta-skeleton dash-skeleton" />
      </div>
      <div className="hub-analytics__trend hub-analytics__trend--skeleton">
        {Array.from({ length: 10 }, (_, index) => (
          <div key={index} className="hub-analytics__trend-day">
            <div className="hub-analytics__trend-bars hub-analytics__trend-bars--skeleton">
              <span
                className="hub-analytics__trend-bar hub-analytics__trend-bar--skeleton dash-skeleton"
                style={{ height: `${28 + (index % 5) * 8}px` }}
              />
              <span
                className="hub-analytics__trend-bar hub-analytics__trend-bar--unhelpful hub-analytics__trend-bar--skeleton dash-skeleton"
                style={{ height: `${12 + (index % 3) * 6}px` }}
              />
            </div>
            <span className="hub-analytics__trend-label-skeleton dash-skeleton" />
          </div>
        ))}
      </div>
      <div className="hub-analytics__trend-legend">
        <span className="hub-analytics__legend-skeleton dash-skeleton" />
        <span className="hub-analytics__legend-skeleton dash-skeleton" />
      </div>
    </section>
  );
}

function HubAnalyticsSourcesSkeleton() {
  const barHeights = [72, 58, 48, 40, 32, 24];
  const axisTicks = [0, 1, 2, 3];
  return (
    <section
      className="card hub-analytics__panel hub-analytics__panel--span-2"
      aria-hidden="true"
      data-testid="hub-analytics-sources-skeleton"
    >
      <div className="hub-analytics__panel-header">
        <span className="hub-analytics__panel-title-skeleton dash-skeleton" />
        <span className="hub-analytics__panel-meta-skeleton dash-skeleton" />
      </div>
      <div className="hub-analytics__bar-chart">
        <div className="hub-analytics__bar-chart-plot">
          <div className="hub-analytics__bar-chart-axis">
            {axisTicks.map((tick) => (
              <span key={tick} className="hub-analytics__bar-chart-tick-skeleton dash-skeleton" />
            ))}
          </div>
          <div className="hub-analytics__bar-chart-bars">
            {axisTicks.map((tick) => (
              <span
                key={`grid-${tick}`}
                className="hub-analytics__bar-chart-grid"
                style={{ bottom: `${(tick / (axisTicks.length - 1)) * 100}%` }}
              />
            ))}
            {barHeights.map((height, index) => (
              <div key={index} className="hub-analytics__bar-chart-bar">
                <span
                  className="hub-analytics__bar-chart-fill hub-analytics__bar-chart-fill--skeleton dash-skeleton"
                  style={{ height: `${height}%` }}
                />
                <span className="hub-analytics__bar-chart-label-skeleton dash-skeleton" />
              </div>
            ))}
          </div>
        </div>
        <div className="hub-analytics__bar-chart-footer">
          <span className="hub-analytics__bar-chart-caption-skeleton dash-skeleton" />
          <div className="hub-analytics__bar-chart-pager">
            <span className="hub-analytics__bar-chart-pager-skeleton dash-skeleton" />
            <span className="hub-analytics__bar-chart-pager-count-skeleton dash-skeleton" />
            <span className="hub-analytics__bar-chart-pager-skeleton dash-skeleton" />
          </div>
        </div>
      </div>
    </section>
  );
}

function HubAnalyticsUnusedSkeleton() {
  return (
    <section className="card hub-analytics__panel" aria-hidden="true" data-testid="hub-analytics-unused-skeleton">
      <div className="hub-analytics__panel-header">
        <span className="hub-analytics__panel-title-skeleton dash-skeleton" />
        <span className="hub-analytics__panel-meta-skeleton dash-skeleton" />
      </div>
      <div className="hub-analytics__chart hub-analytics__chart--dormant">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="hub-analytics__chart-row hub-analytics__chart-row--compact">
            <div className="hub-analytics__chart-label">
              <span className="hub-analytics__chart-name-skeleton dash-skeleton" />
              <span className="hub-analytics__chart-value-skeleton dash-skeleton" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HubAnalyticsLoadingSkeleton() {
  return (
    <div className="hub-analytics" data-testid="hub-analytics-loading-skeleton">
      <div className="hub-analytics__metrics">
        {Array.from({ length: 6 }, (_, index) => <HubAnalyticsMetricSkeleton key={index} index={index} />)}
      </div>
      <div className="hub-analytics__grid">
        <HubAnalyticsTrendSkeleton />
        <HubAnalyticsSourcesSkeleton />
        <HubAnalyticsUnusedSkeleton />
      </div>
    </div>
  );
}

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
  const [topSourcesMode, setTopSourcesMode] = useState<TopSourcesMode>("returns");
  const [topSourcesMenuOpen, setTopSourcesMenuOpen] = useState(false);
  const [topSourcesPage, setTopSourcesPage] = useState(0);
  const topSourcesMenuRef = useRef<HTMLDivElement>(null);
  const isPhone = useIsPhone();
  const topSourcesPageSize = isPhone ? TOP_SOURCES_PAGE_SIZE_PHONE : TOP_SOURCES_PAGE_SIZE_DESKTOP;

  useEffect(() => {
    setTopSourcesPage(0);
  }, [topSourcesMode, hubId]);

  const handleSourceClick = (sourceId: string) => {
    router.push(`/hubs/${hubId}?tab=sources&openSource=${sourceId}`);
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
    return <HubAnalyticsLoadingSkeleton />;
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
  const topSourcesPrimaryField: keyof AnalyticsTopSource =
    topSourcesMode === "opens" ? "citation_opens"
    : topSourcesMode === "returns" ? "citation_returns"
    : "citation_flags";
  const sortedTopSources = [...summary.top_sources]
    .filter((source) => Number(source[topSourcesPrimaryField] ?? 0) > 0)
    .sort((left, right) => compareTopSources(left, right, topSourcesMode));
  const topSourcesMaxValue = sortedTopSources.reduce(
    (max, source) => Math.max(max, Number(source[topSourcesPrimaryField] ?? 0)),
    0,
  );
  const topSourcesPageCount = Math.max(1, Math.ceil(sortedTopSources.length / topSourcesPageSize));
  const clampedPage = Math.min(topSourcesPage, topSourcesPageCount - 1);
  const pageStart = clampedPage * topSourcesPageSize;
  const pagedTopSources = sortedTopSources.slice(pageStart, pageStart + topSourcesPageSize);
  const topSourcesAxisMax = Math.max(topSourcesMaxValue, 1);
  const topSourcesYTicks = buildYAxisTicks(topSourcesAxisMax);
  const topSourcesUnitLabel =
    topSourcesMode === "opens" ? "opens"
    : topSourcesMode === "returns" ? "uses"
    : "flags";
  const topSourcesModeLabel =
    topSourcesMode === "opens" ? "By source opens"
    : topSourcesMode === "returns" ? "By times used"
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
          label="Source opens"
          value={String(summary.citation_open_count)}
          hint={`Across ${summary.total_answers} answers`}
        />
        <MetricCard
          label="Source flags"
          value={String(summary.citation_flag_count)}
          hint={`Across ${summary.total_answers} answers`}
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

        <section className="card hub-analytics__panel hub-analytics__panel--span-2">
          <div className="hub-analytics__panel-header">
            <h4>Top used sources</h4>
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
                    By source opens
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
                    By times used
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
                : "No source usage recorded yet."}
            </p>
          ) : (
            <div className="hub-analytics__bar-chart">
              <div className="hub-analytics__bar-chart-plot">
                <div className="hub-analytics__bar-chart-axis" aria-hidden="true">
                  {topSourcesYTicks.map((tick) => (
                    <span key={tick} className="hub-analytics__bar-chart-tick">{tick}</span>
                  ))}
                </div>
                <div className="hub-analytics__bar-chart-bars" role="list">
                  {topSourcesYTicks.map((tick) => (
                    <span
                      key={`grid-${tick}`}
                      className="hub-analytics__bar-chart-grid"
                      style={{ bottom: `${(tick / topSourcesAxisMax) * 100}%` }}
                      aria-hidden="true"
                    />
                  ))}
                  {pagedTopSources.map((source) => {
                    const primaryValue = Number(source[topSourcesPrimaryField] ?? 0);
                    const barHeight = topSourcesAxisMax > 0
                      ? Math.max(primaryValue > 0 ? 4 : 0, (primaryValue / topSourcesAxisMax) * 100)
                      : 0;
                    const displayName = source.source_name ?? source.source_id;
                    return (
                      <button
                        key={source.source_id}
                        type="button"
                        role="listitem"
                        className="hub-analytics__bar-chart-bar"
                        onClick={() => handleSourceClick(source.source_id)}
                        title={`${displayName}: ${primaryValue} ${topSourcesUnitLabel}`}
                        aria-label={`${displayName}: ${primaryValue} ${topSourcesUnitLabel}`}
                      >
                        <span className="hub-analytics__bar-chart-value">{primaryValue}</span>
                        <span
                          className="hub-analytics__bar-chart-fill"
                          style={{ height: `${barHeight}%` }}
                        />
                        <span className="hub-analytics__bar-chart-label">{displayName}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="hub-analytics__bar-chart-footer">
                <span className="muted">{`Citations (${topSourcesUnitLabel})`}</span>
                <div className="hub-analytics__bar-chart-pager">
                  <button
                    type="button"
                    className="hub-analytics__bar-chart-pager-btn"
                    onClick={() => setTopSourcesPage((current) => Math.max(0, current - 1))}
                    disabled={clampedPage === 0}
                    aria-label="Previous sources"
                  >
                    <ChevronLeftIcon />
                  </button>
                  <span className="muted">{`${clampedPage + 1} / ${topSourcesPageCount}`}</span>
                  <button
                    type="button"
                    className="hub-analytics__bar-chart-pager-btn"
                    onClick={() => setTopSourcesPage((current) => Math.min(topSourcesPageCount - 1, current + 1))}
                    disabled={clampedPage >= topSourcesPageCount - 1}
                    aria-label="Next sources"
                  >
                    <ChevronRightIcon />
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="card hub-analytics__panel">
          <div className="hub-analytics__panel-header">
            <h4>Unused sources</h4>
            <span className="muted">
              {totalCompleteSources > 0
                ? `${neverCitedCount} of ${totalCompleteSources} never used`
                : "No sources"}
            </span>
          </div>
          {neverCitedSources.length === 0 ? (
            <p className="muted">
              {neverCitedCount === 0 && totalCompleteSources > 0
                ? "Every source has been used at least once. Nice."
                : "No sources to show."}
            </p>
          ) : (
            <div className="hub-analytics__chart hub-analytics__chart--dormant hub-analytics__chart--scroll">
              {neverCitedSources.map((source) => (
                <button
                  key={source.source_id}
                  type="button"
                  className="hub-analytics__chart-row hub-analytics__chart-row--compact"
                  onClick={() => handleSourceClick(source.source_id)}
                  title={source.source_name ?? source.source_id}
                >
                  <div className="hub-analytics__chart-label">
                    <span className="hub-analytics__chart-name">{source.source_name ?? source.source_id}</span>
                    <span className="hub-analytics__chart-value hub-analytics__chart-value--muted">0 uses</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function buildYAxisTicks(max: number): number[] {
  if (max <= 1) return [0, 1];
  const step = Math.max(1, Math.ceil(max / 4));
  const ticks: number[] = [];
  for (let value = 0; value <= max; value += step) {
    ticks.push(value);
  }
  if (ticks[ticks.length - 1] !== max) {
    ticks.push(max);
  }
  return ticks;
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
