import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NotificationsMenu } from "../../components/navigation/NotificationsMenu";
import {
  acceptInvite,
  dismissInviteNotification,
  dismissReminderNotification,
  listInviteNotifications,
  listReminderNotifications,
  updateReminder,
} from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

vi.mock("../../lib/api", () => ({
  acceptInvite: vi.fn(),
  dismissInviteNotification: vi.fn(),
  dismissReminderNotification: vi.fn(),
  listInviteNotifications: vi.fn(),
  listReminderNotifications: vi.fn(),
  updateReminder: vi.fn(),
}));

vi.mock("../../components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
  }),
}));

describe("NotificationsMenu", () => {
  let inviteNotifications: Array<{
    hub: {
      id: string;
      owner_id: string;
      name: string;
      created_at: string;
    };
    role: string;
    invited_at: string;
  }>;
  let reminderNotificationsState: Array<{
    id: string;
    reminder_id: string;
    channel: "in_app";
    status: "sent";
    scheduled_for: string;
    sent_at: string;
    reminder: {
      id: string;
      hub_id: string;
      hub_name?: string;
      due_at: string;
      message: string;
      status: "scheduled";
    };
  }>;

  beforeEach(() => {
    vi.clearAllMocks();
    inviteNotifications = [
      {
        hub: {
          id: "hub-1",
          owner_id: "owner-1",
          name: "Operating Systems",
          created_at: "2026-01-01T12:00:00Z",
        },
        role: "viewer",
        invited_at: "2026-01-02T12:00:00Z",
      },
    ];
    reminderNotificationsState = [
      {
        id: "notice-1",
        reminder_id: "reminder-1",
        channel: "in_app",
        status: "sent",
        scheduled_for: "2026-01-03T12:00:00Z",
        sent_at: "2026-01-03T12:00:00Z",
        reminder: {
          id: "reminder-1",
          hub_id: "hub-1",
          hub_name: "Operating Systems",
          due_at: "2026-01-04T12:00:00Z",
          message: "Submit assignment",
          status: "scheduled",
        },
      },
    ];
    vi.mocked(listInviteNotifications).mockImplementation(async () => inviteNotifications);
    vi.mocked(listReminderNotifications).mockImplementation(async () => reminderNotificationsState);
    vi.mocked(acceptInvite).mockResolvedValue({
      hub_id: "hub-1",
      user_id: "user-1",
      role: "viewer",
      invited_at: "2026-01-02T12:00:00Z",
      accepted_at: "2026-01-03T12:00:00Z",
    });
    vi.mocked(dismissInviteNotification).mockImplementation(async (hubId: string) => {
      inviteNotifications = inviteNotifications.filter((invite) => invite.hub.id !== hubId);
    });
    vi.mocked(dismissReminderNotification).mockImplementation(async (notificationId: string) => {
      const dismissed = reminderNotificationsState.find((notice) => notice.id === notificationId);
      reminderNotificationsState = reminderNotificationsState.filter((notice) => notice.id !== notificationId);
      return {
        ...dismissed!,
        dismissed_at: "2026-01-03T13:00:00Z",
      };
    });
    vi.mocked(updateReminder).mockImplementation(async (reminderId: string) => {
      reminderNotificationsState = reminderNotificationsState.filter((notice) => notice.reminder_id !== reminderId);
      return {
        id: reminderId,
        user_id: "user-1",
        hub_id: "hub-1",
        due_at: "2026-01-04T12:00:00Z",
        timezone: "UTC",
        message: "Submit assignment",
        status: "completed",
        created_at: "2026-01-03T10:00:00Z",
        completed_at: "2026-01-03T13:00:00Z",
      };
    });
  });

  it("dismisses invite notifications through the API", async () => {
    renderWithQueryClient(<NotificationsMenu />);

    await waitFor(() => expect(screen.getByText("You have a new hub invite")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Dismiss" })[1]);

    await waitFor(() => expect(screen.queryByText("You have a new hub invite")).not.toBeInTheDocument());
    await waitFor(() => expect(dismissInviteNotification).toHaveBeenCalledWith("hub-1"));
  });

  it("dismisses reminder notifications through the API", async () => {
    renderWithQueryClient(<NotificationsMenu />);

    await waitFor(() => expect(screen.getByText("Submit assignment")).toBeInTheDocument());
    expect(screen.getAllByText("Operating Systems").length).toBeGreaterThan(0);

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Dismiss" })[0]);

    await waitFor(() => expect(screen.queryByText("Submit assignment")).not.toBeInTheDocument());
    await waitFor(() => expect(dismissReminderNotification).toHaveBeenCalledWith("notice-1"));
  });

  it("completes reminder notifications through the API", async () => {
    renderWithQueryClient(<NotificationsMenu />);

    await waitFor(() => expect(screen.getByText("Submit assignment")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Complete" }));

    await waitFor(() => expect(screen.queryByText("Submit assignment")).not.toBeInTheDocument());
    await waitFor(() => expect(updateReminder).toHaveBeenCalledWith("reminder-1", { action: "complete" }));
  });
});
