import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReminderCandidatesPanel } from "../../components/ReminderCandidatesPanel";
import { decideReminderCandidate, listReminderCandidates } from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

vi.mock("../../lib/api", () => ({
  listReminderCandidates: vi.fn(),
  decideReminderCandidate: vi.fn(),
}));

describe("ReminderCandidatesPanel", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the default message when adjusting due date", async () => {
    vi.mocked(listReminderCandidates).mockResolvedValue([
      {
        id: "cand-1",
        hub_id: "hub-1",
        source_id: "src-1",
        snippet: "Submit the onboarding form by 15 March 2026 at 5pm.",
        due_at: "2026-03-15T17:00:00Z",
        timezone: "UTC",
        title_suggestion: "Submit the onboarding form",
        confidence: 0.9,
        status: "pending",
        created_at: "2026-01-24T10:00:00Z",
      },
    ]);
    vi.mocked(decideReminderCandidate).mockResolvedValue({
      candidate: {
        id: "cand-1",
        hub_id: "hub-1",
        source_id: "src-1",
        snippet: "Submit the onboarding form by 15 March 2026 at 5pm.",
        due_at: "2026-03-15T17:00:00Z",
        timezone: "UTC",
        title_suggestion: "Submit the onboarding form",
        confidence: 0.9,
        status: "accepted",
        created_at: "2026-01-24T10:00:00Z",
      },
      reminder: {
        id: "rem-1",
        user_id: "user-1",
        hub_id: "hub-1",
        source_id: "src-1",
        due_at: "2026-03-16T17:00:00Z",
        timezone: "UTC",
        message: "Submit the onboarding form by 15 March 2026 at 5pm.",
        status: "scheduled",
        created_at: "2026-01-24T10:00:00Z",
      },
    });

    const user = userEvent.setup();
    renderWithQueryClient(<ReminderCandidatesPanel hubId="hub-1" />);

    expect(await screen.findByText(/15\/03\/2026/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dueInput = screen.getByLabelText("Due date") as HTMLInputElement;
    await user.clear(dueInput);
    await user.type(dueInput, "2026-03-16T17:00");

    await user.click(screen.getByRole("button", { name: "Accept" }));

    const expectedDue = new Date("2026-03-16T17:00").toISOString();

    await waitFor(() => {
      expect(decideReminderCandidate).toHaveBeenCalled();
    });

    const [, payload] = vi.mocked(decideReminderCandidate).mock.calls[0];
    expect(payload.action).toBe("accepted");
    expect(payload.edited_due_at).toBe(expectedDue);
    expect(payload.edited_message).toBe("Submit the onboarding form by 15 March 2026 at 5pm.");
  });
});
