import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuggestedSourcesPanel } from "../../components/SuggestedSourcesPanel";
import { decideSourceSuggestion, listSourceSuggestions } from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

vi.mock("../../lib/api", () => ({
  listSourceSuggestions: vi.fn(),
  decideSourceSuggestion: vi.fn(),
}));

describe("SuggestedSourcesPanel", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a suggestion and calls the acceptance callback", async () => {
    vi.mocked(listSourceSuggestions).mockResolvedValue([
      {
        id: "suggest-1",
        hub_id: "hub-1",
        type: "web",
        status: "pending",
        url: "https://example.com/docs",
        canonical_url: "https://example.com/docs",
        title: "Example docs",
        description: "Helpful documentation",
        rationale: "Covers onboarding topics mentioned in the hub.",
        confidence: 0.9,
        seed_source_ids: ["src-1"],
        created_at: "2026-03-17T10:00:00Z",
      },
    ]);
    vi.mocked(decideSourceSuggestion).mockResolvedValue({
      suggestion: {
        id: "suggest-1",
        hub_id: "hub-1",
        type: "web",
        status: "accepted",
        url: "https://example.com/docs",
        canonical_url: "https://example.com/docs",
        title: "Example docs",
        description: "Helpful documentation",
        rationale: "Covers onboarding topics mentioned in the hub.",
        confidence: 0.9,
        seed_source_ids: ["src-1"],
        created_at: "2026-03-17T10:00:00Z",
        accepted_source_id: "src-new-1",
      },
      source: {
        id: "src-new-1",
        hub_id: "hub-1",
        type: "web",
        original_name: "Example docs",
        status: "queued",
        created_at: "2026-03-17T10:01:00Z",
      },
    });

    const onAccepted = vi.fn();
    const user = userEvent.setup();
    renderWithQueryClient(<SuggestedSourcesPanel hubId="hub-1" canReview={true} onAccepted={onAccepted} />);

    expect(await screen.findByText("Example docs")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => {
      expect(decideSourceSuggestion).toHaveBeenCalledWith("suggest-1", { action: "accepted" });
      expect(onAccepted).toHaveBeenCalled();
    });
  });

  it("hides review actions for viewers", async () => {
    vi.mocked(listSourceSuggestions).mockResolvedValue([
      {
        id: "suggest-2",
        hub_id: "hub-1",
        type: "youtube",
        status: "pending",
        url: "https://www.youtube.com/watch?v=abc123def45",
        video_id: "abc123def45",
        title: "Demo video",
        confidence: 0.8,
        seed_source_ids: ["src-1"],
        created_at: "2026-03-17T10:00:00Z",
      },
    ]);

    renderWithQueryClient(<SuggestedSourcesPanel hubId="hub-1" canReview={false} />);

    expect(await screen.findByText("Demo video")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.getByText("Only owners and editors can review suggestions.")).toBeInTheDocument();
  });
});
