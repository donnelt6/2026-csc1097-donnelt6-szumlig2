import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemindersSidebar } from "../../components/hub-dashboard/RemindersSidebar";
import { renderWithQueryClient } from "../test-utils";

vi.mock("../../lib/api", () => ({
  decideReminderCandidate: vi.fn(),
}));

describe("RemindersSidebar", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows AI insights in pages of three", async () => {
    const user = userEvent.setup();

    renderWithQueryClient(
      <RemindersSidebar
        hubId="hub-1"
        candidates={[
          {
            id: "cand-1",
            hub_id: "hub-1",
            source_id: "src-1",
            snippet: "Snippet 1",
            due_at: "2026-05-01T09:00:00Z",
            timezone: "UTC",
            title_suggestion: "Candidate 1",
            confidence: 0.9,
            status: "pending",
            created_at: "2026-04-01T09:00:00Z",
          },
          {
            id: "cand-2",
            hub_id: "hub-1",
            source_id: "src-2",
            snippet: "Snippet 2",
            due_at: "2026-05-02T09:00:00Z",
            timezone: "UTC",
            title_suggestion: "Candidate 2",
            confidence: 0.8,
            status: "pending",
            created_at: "2026-04-02T09:00:00Z",
          },
          {
            id: "cand-3",
            hub_id: "hub-1",
            source_id: "src-3",
            snippet: "Snippet 3",
            due_at: "2026-05-03T09:00:00Z",
            timezone: "UTC",
            title_suggestion: "Candidate 3",
            confidence: 0.85,
            status: "pending",
            created_at: "2026-04-03T09:00:00Z",
          },
          {
            id: "cand-4",
            hub_id: "hub-1",
            source_id: "src-4",
            snippet: "Snippet 4",
            due_at: "2026-05-04T09:00:00Z",
            timezone: "UTC",
            title_suggestion: "Candidate 4",
            confidence: 0.95,
            status: "pending",
            created_at: "2026-04-04T09:00:00Z",
          },
        ]}
        onCreateClick={() => undefined}
      />
    );

    expect(screen.getByText("Candidate 1")).toBeInTheDocument();
    expect(screen.getByText("Candidate 2")).toBeInTheDocument();
    expect(screen.getByText("Candidate 3")).toBeInTheDocument();
    expect(screen.queryByText("Candidate 4")).not.toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.queryByText("Candidate 1")).not.toBeInTheDocument();
    expect(screen.getByText("Candidate 4")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });
});
