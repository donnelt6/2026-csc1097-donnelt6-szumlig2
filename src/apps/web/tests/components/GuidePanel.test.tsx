import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuidePanel } from "../../components/GuidePanel";
import { listGuides, updateGuideStepProgress } from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

vi.mock("../../lib/api", () => ({
  listGuides: vi.fn(),
  generateGuide: vi.fn(),
  updateGuide: vi.fn(),
  updateGuideStep: vi.fn(),
  createGuideStep: vi.fn(),
  reorderGuideSteps: vi.fn(),
  updateGuideStepProgress: vi.fn(),
  archiveGuide: vi.fn(),
}));

describe("GuidePanel", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("disables generation when no sources are selected", async () => {
    vi.mocked(listGuides).mockResolvedValue([]);

    renderWithQueryClient(
      <GuidePanel hubId="hub-1" selectedSourceIds={[]} hasSelectableSources={true} canEdit={true} />
    );

    const button = screen.getByRole("button", { name: "Generate Guide" });
    expect(button).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "How many steps?" })).toBeInTheDocument();
  });

  it("toggles step completion", async () => {
    vi.mocked(listGuides).mockResolvedValue([
      {
        id: "guide-1",
        hub_id: "hub-1",
        title: "Onboarding Guide",
        topic: "Onboarding",
        summary: null,
        source_ids: ["src-1"],
        created_at: "2026-01-01T00:00:00Z",
        steps: [
          {
            id: "step-1",
            guide_id: "guide-1",
            step_index: 1,
            title: "Step 1",
            instruction: "Do the thing.",
            citations: [{ source_id: "src-1", snippet: "Snippet" }],
            confidence: 0.9,
            created_at: "2026-01-01T00:00:00Z",
            is_complete: false,
          },
        ],
      },
    ]);
    vi.mocked(updateGuideStepProgress).mockResolvedValue({
      id: "step-1",
      guide_id: "guide-1",
      step_index: 1,
      title: "Step 1",
      instruction: "Do the thing.",
      citations: [{ source_id: "src-1", snippet: "Snippet" }],
      confidence: 0.9,
      created_at: "2026-01-01T00:00:00Z",
    });

    renderWithQueryClient(
      <GuidePanel hubId="hub-1" selectedSourceIds={["src-1"]} hasSelectableSources={true} canEdit={true} />
    );

    await waitFor(() => expect(screen.getByText("Do the thing.")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox"));

    expect(updateGuideStepProgress).toHaveBeenCalledWith("step-1", { is_complete: true });
  });
});
