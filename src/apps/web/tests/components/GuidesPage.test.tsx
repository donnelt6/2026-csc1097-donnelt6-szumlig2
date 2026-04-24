import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuidesPage } from "../../components/hub-dashboard/GuidesPage";
import { listGuides } from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

vi.mock("../../lib/api", () => ({
  archiveGuide: vi.fn(),
  createGuideStep: vi.fn(),
  flagGuide: vi.fn(),
  generateGuide: vi.fn(),
  listGuides: vi.fn(),
  reorderGuideSteps: vi.fn(),
  updateGuide: vi.fn(),
  updateGuideStep: vi.fn(),
  updateGuideStepProgress: vi.fn(),
}));

describe("GuidesPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders guide topic pills and filters by selected topic", async () => {
    vi.mocked(listGuides).mockResolvedValue([
      {
        id: "guide-1",
        hub_id: "hub-1",
        title: "HR Guide 1",
        topic: "New Hire",
        topic_label: "HR",
        topic_labels: ["HR", "Security"],
        summary: null,
        source_ids: ["src-1"],
        is_favourited: false,
        created_at: "2026-01-01T00:00:00Z",
        steps: [],
      },
      {
        id: "guide-2",
        hub_id: "hub-1",
        title: "HR Guide 2",
        topic: "Benefits",
        topic_label: "HR",
        topic_labels: ["HR", "Security"],
        summary: null,
        source_ids: ["src-1"],
        is_favourited: true,
        created_at: "2026-01-02T00:00:00Z",
        steps: [],
      },
      {
        id: "guide-3",
        hub_id: "hub-1",
        title: "HR Guide 3",
        topic: "Leave Policy",
        topic_label: "HR",
        topic_labels: ["HR", "Security"],
        summary: null,
        source_ids: ["src-1"],
        is_favourited: false,
        created_at: "2026-01-03T00:00:00Z",
        steps: [],
      },
      {
        id: "guide-4",
        hub_id: "hub-1",
        title: "IT Guide",
        topic: "Accounts",
        topic_label: "IT",
        topic_labels: ["IT", "Security"],
        summary: null,
        source_ids: ["src-1"],
        is_favourited: false,
        created_at: "2026-01-04T00:00:00Z",
        steps: [],
      },
    ]);

    renderWithQueryClient(<GuidesPage hubId="hub-1" sources={[]} canEdit={false} />);

    await waitFor(() => expect(screen.getByText("HR Guide 1")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "HR (3)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Security (4)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "IT (1)" })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "HR (3)" }));

    expect(screen.getByText("HR Guide 1")).toBeInTheDocument();
    expect(screen.getByText("HR Guide 2")).toBeInTheDocument();
    expect(screen.getByText("HR Guide 3")).toBeInTheDocument();
    expect(screen.queryByText("IT Guide")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Security (4)" }));

    expect(screen.getByText("HR Guide 1")).toBeInTheDocument();
    expect(screen.getByText("HR Guide 2")).toBeInTheDocument();
    expect(screen.getByText("HR Guide 3")).toBeInTheDocument();
    expect(screen.getByText("IT Guide")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pinned (1)" }));

    expect(screen.getByText("HR Guide 2")).toBeInTheDocument();
    expect(screen.queryByText("HR Guide 1")).not.toBeInTheDocument();
    expect(screen.queryByText("HR Guide 3")).not.toBeInTheDocument();
  });
});
