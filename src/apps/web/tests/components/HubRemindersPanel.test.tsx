import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HubRemindersPanel } from "../../components/HubRemindersPanel";
import { listReminders, updateReminder } from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

vi.mock("../../lib/api", () => ({
  listReminders: vi.fn(),
  updateReminder: vi.fn(),
  deleteReminder: vi.fn(),
  createReminder: vi.fn(),
}));

describe("HubRemindersPanel", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows postpone for scheduled and retrigger for sent reminders", async () => {
    vi.mocked(listReminders).mockResolvedValue([
      {
        id: "rem-1",
        user_id: "user-1",
        hub_id: "hub-1",
        due_at: "2026-01-24T12:34:00Z",
        timezone: "UTC",
        message: "Submit form",
        status: "scheduled",
        created_at: "2026-01-24T10:00:00Z",
      },
      {
        id: "rem-2",
        user_id: "user-1",
        hub_id: "hub-1",
        due_at: "2026-01-24T15:00:00Z",
        timezone: "UTC",
        message: "Follow up",
        status: "sent",
        created_at: "2026-01-24T10:00:00Z",
      },
    ]);

    renderWithQueryClient(<HubRemindersPanel hubId="hub-1" />);

    expect(await screen.findByText("Postpone")).toBeInTheDocument();
    expect(await screen.findByText("Retrigger")).toBeInTheDocument();
  });

  it("formats due dates in Irish format", async () => {
    vi.mocked(listReminders).mockResolvedValue([
      {
        id: "rem-3",
        user_id: "user-1",
        hub_id: "hub-1",
        due_at: "2026-01-24T12:34:00Z",
        timezone: "UTC",
        message: "Review document",
        status: "scheduled",
        created_at: "2026-01-24T10:00:00Z",
      },
    ]);

    renderWithQueryClient(<HubRemindersPanel hubId="hub-1" />);

    expect(await screen.findByText(/24\/01\/2026/)).toBeInTheDocument();
  });

  it("postpones using the selected date and time", async () => {
    const now = new Date("2026-01-24T12:00").getTime();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);

    vi.mocked(listReminders).mockResolvedValue([
      {
        id: "rem-4",
        user_id: "user-1",
        hub_id: "hub-1",
        due_at: "2026-01-24T12:10:00Z",
        timezone: "UTC",
        message: "Send follow up",
        status: "scheduled",
        created_at: "2026-01-24T10:00:00Z",
      },
    ]);
    vi.mocked(updateReminder).mockResolvedValue({
      id: "rem-4",
      user_id: "user-1",
      hub_id: "hub-1",
      due_at: "2026-01-24T12:30:00Z",
      timezone: "UTC",
      message: "Send follow up",
      status: "scheduled",
      created_at: "2026-01-24T10:00:00Z",
    });

    const user = userEvent.setup();
    renderWithQueryClient(<HubRemindersPanel hubId="hub-1" />);

    await screen.findByText("Postpone");
    await user.click(screen.getByRole("button", { name: "Postpone" }));

    const input = screen.getByLabelText("Date & time") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "2026-01-24T12:30");

    await user.click(screen.getByRole("button", { name: "Set time" }));

    const expectedMinutes = Math.round((new Date("2026-01-24T12:30").getTime() - now) / 60000);

    await waitFor(() =>
      expect(updateReminder).toHaveBeenCalledWith("rem-4", {
        action: "snooze",
        snooze_minutes: expectedMinutes,
      })
    );

    nowSpy.mockRestore();
  });
});
