import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HubAnalyticsPanel } from "../../components/HubAnalyticsPanel";
import { getHubAnalyticsSummary, getHubAnalyticsTrends } from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("../../lib/api", () => ({
  getHubAnalyticsSummary: vi.fn(),
  getHubAnalyticsTrends: vi.fn(),
}));

describe("HubAnalyticsPanel", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders analytics skeletons while data is loading", () => {
    const pending = new Promise<never>(() => {});
    vi.mocked(getHubAnalyticsSummary).mockReturnValue(pending);
    vi.mocked(getHubAnalyticsTrends).mockReturnValue(pending);

    renderWithQueryClient(<HubAnalyticsPanel hubId="hub-1" hubRole="owner" />);

    expect(screen.getByTestId("hub-analytics-loading-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("hub-analytics-metric-skeleton-0")).toBeInTheDocument();
    expect(screen.getByTestId("hub-analytics-trend-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("hub-analytics-sources-skeleton")).toBeInTheDocument();
  });

  it("renders analytics metrics and top sources for owners", async () => {
    vi.mocked(getHubAnalyticsSummary).mockResolvedValue({
      window_days: 30,
      total_questions: 12,
      total_answers: 12,
      helpful_count: 5,
      not_helpful_count: 1,
      helpful_rate: 0.833,
      average_citations_per_answer: 1.8,
      citation_open_count: 8,
      citation_open_rate: 0.667,
      citation_flag_count: 1,
      citation_flag_rate: 0.083,
      average_latency_ms: 1820,
      total_tokens: 3400,
      rewrite_usage_rate: 0.25,
      zero_hit_rate: 0.08,
      top_sources: [
        {
          source_id: "src-1",
          source_name: "Welcome Pack.pdf",
          citation_returns: 2,
          citation_opens: 6,
          citation_flags: 1,
        },
        {
          source_id: "src-2",
          source_name: "Overview.pdf",
          citation_returns: 7,
          citation_opens: 1,
          citation_flags: 0,
        },
      ],
    });
    vi.mocked(getHubAnalyticsTrends).mockResolvedValue({
      window_days: 14,
      points: [
        { date: "2026-03-20", questions: 1, answers: 1, helpful: 1, citation_opens: 0, citation_flags: 0 },
        { date: "2026-03-21", questions: 3, answers: 3, helpful: 2, citation_opens: 2, citation_flags: 0 },
      ],
    });

    renderWithQueryClient(<HubAnalyticsPanel hubId="hub-1" hubRole="owner" />);

    expect(await screen.findByText("Questions")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Overview.pdf")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /Overview\.pdf: 7 uses/i })).toBeInTheDocument();
    expect(screen.getByText(/Citations \(uses\)/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Across 12 answers/)[0]).toBeInTheDocument();
    expect(screen.getByText("Fast")).toBeInTheDocument();
  });

  it("shows a permission notice for viewers", () => {
    renderWithQueryClient(<HubAnalyticsPanel hubId="hub-1" hubRole="viewer" />);
    expect(screen.getByText(/Only hub owners and admins can view AI analytics/i)).toBeInTheDocument();
  });

  it("shows a trends error when the trends request fails", async () => {
    vi.mocked(getHubAnalyticsSummary).mockResolvedValue({
      window_days: 30,
      total_questions: 12,
      total_answers: 12,
      helpful_count: 5,
      not_helpful_count: 1,
      helpful_rate: 0.833,
      average_citations_per_answer: 1.8,
      citation_open_count: 8,
      citation_open_rate: 0.667,
      citation_flag_count: 1,
      citation_flag_rate: 0.083,
      average_latency_ms: 1820,
      total_tokens: 3400,
      rewrite_usage_rate: 0.25,
      zero_hit_rate: 0.08,
      top_sources: [],
    });
    vi.mocked(getHubAnalyticsTrends).mockRejectedValue(new Error("trends unavailable"));

    renderWithQueryClient(<HubAnalyticsPanel hubId="hub-1" hubRole="owner" />);

    expect(await screen.findByText(/Failed to load analytics trends: trends unavailable/i)).toBeInTheDocument();
  });

  it("allows switching top sources from citation opens to citations returned", async () => {
    vi.mocked(getHubAnalyticsSummary).mockResolvedValue({
      window_days: 30,
      total_questions: 12,
      total_answers: 12,
      helpful_count: 5,
      not_helpful_count: 1,
      helpful_rate: 0.833,
      average_citations_per_answer: 1.8,
      citation_open_count: 8,
      citation_open_rate: 0.667,
      citation_flag_count: 1,
      citation_flag_rate: 0.083,
      average_latency_ms: 1820,
      total_tokens: 3400,
      rewrite_usage_rate: 0.25,
      zero_hit_rate: 0.08,
      top_sources: [
        {
          source_id: "src-1",
          source_name: "Welcome Pack.pdf",
          citation_returns: 2,
          citation_opens: 6,
          citation_flags: 1,
        },
        {
          source_id: "src-2",
          source_name: "Overview.pdf",
          citation_returns: 7,
          citation_opens: 1,
          citation_flags: 0,
        },
      ],
    });
    vi.mocked(getHubAnalyticsTrends).mockResolvedValue({
      window_days: 14,
      points: [
        { date: "2026-03-20", questions: 1, answers: 1, helpful: 1, citation_opens: 0, citation_flags: 0 },
      ],
    });

    renderWithQueryClient(<HubAnalyticsPanel hubId="hub-1" hubRole="owner" />);

    await screen.findByText("Overview.pdf");
    fireEvent.click(screen.getByRole("button", { name: /By times used/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /By source opens/i }));

    const sourceNames = screen.getAllByText(/\.pdf$/i).map((node) => node.textContent);
    expect(sourceNames[0]).toBe("Welcome Pack.pdf");
  });
});
