import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardHome } from "../../components/dashboard/DashboardHome";
import { listActivity, listChatSessions, listHubs, listReminders } from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("../../components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com" },
  }),
}));

vi.mock("../../lib/api", () => ({
  listHubs: vi.fn(),
  listReminders: vi.fn(),
  listChatSessions: vi.fn(),
  listActivity: vi.fn(),
}));

describe("DashboardHome", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders dashboard skeletons while home data is loading", () => {
    const pending = new Promise<never>(() => {});
    vi.mocked(listHubs).mockReturnValue(pending);
    vi.mocked(listReminders).mockReturnValue(pending);
    vi.mocked(listActivity).mockReturnValue(pending);
    vi.mocked(listChatSessions).mockReturnValue(pending);

    renderWithQueryClient(<DashboardHome />);

    expect(screen.getByTestId("dashboard-hub-skeleton-0")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-hub-skeleton-1")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-hub-skeleton-2")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-activity-skeleton-0")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-activity-skeleton-4")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-reminder-empty-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-prompt-skeleton-0")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-prompt-skeleton-1")).toBeInTheDocument();
  });

  it("renders persisted appearance for recent hubs", async () => {
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-1",
        owner_id: "user-1",
        name: "Launch Hub",
        description: "Product launch",
        icon_key: "rocket",
        color_key: "blue",
        created_at: "2025-01-01T00:00:00Z",
      },
      {
        id: "hub-2",
        owner_id: "user-1",
        name: "Research Hub",
        description: "Research notes",
        icon_key: "beaker",
        color_key: "emerald",
        created_at: "2025-01-02T00:00:00Z",
      },
      {
        id: "hub-3",
        owner_id: "user-1",
        name: "Support Hub",
        description: "Support scripts",
        icon_key: "chat",
        color_key: "orange",
        created_at: "2025-01-03T00:00:00Z",
      },
    ]);
    vi.mocked(listReminders).mockResolvedValue([]);
    vi.mocked(listActivity).mockResolvedValue([]);
    vi.mocked(listChatSessions).mockResolvedValue([]);

    renderWithQueryClient(<DashboardHome />);

    const firstIcon = await screen.findByTestId("dashboard-hub-icon-hub-1");
    expect(firstIcon).toHaveAttribute("data-icon-key", "rocket");
    expect(firstIcon).toHaveAttribute("data-color-key", "blue");

    const secondIcon = await screen.findByTestId("dashboard-hub-icon-hub-2");
    expect(secondIcon).toHaveAttribute("data-icon-key", "beaker");
    expect(secondIcon).toHaveAttribute("data-color-key", "emerald");

    const thirdIcon = await screen.findByTestId("dashboard-hub-icon-hub-3");
    expect(thirdIcon).toHaveAttribute("data-icon-key", "chat");
    expect(thirdIcon).toHaveAttribute("data-color-key", "orange");
  });

  it("shows actor attribution in recent activity entries", async () => {
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-1",
        owner_id: "owner-1",
        name: "Launch Hub",
        description: null,
        created_at: "2025-01-01T00:00:00Z",
      },
    ]);
    vi.mocked(listReminders).mockResolvedValue([]);
    vi.mocked(listChatSessions).mockResolvedValue([]);
    vi.mocked(listActivity).mockResolvedValue([
      {
        id: "activity-1",
        hub_id: "hub-1",
        user_id: "user-2",
        action: "invited",
        resource_type: "member",
        metadata: {
          actor_label: "Alice",
          email: "target@example.com",
          role: "viewer",
        },
        created_at: "2025-01-02T00:00:00Z",
      },
      {
        id: "activity-2",
        hub_id: "hub-1",
        user_id: "user-1",
        action: "created",
        resource_type: "hub",
        metadata: {
          actor_label: "You",
          name: "Launch Hub",
        },
        created_at: "2025-01-03T00:00:00Z",
      },
    ]);

    renderWithQueryClient(<DashboardHome />);

    expect(await screen.findByText("Alice invited")).toBeInTheDocument();
    expect(screen.getByText("target@example.com (viewer)")).toBeInTheDocument();
    expect(screen.getByText("You created hub")).toBeInTheDocument();
    expect(screen.getAllByText("Launch Hub")[0]).toBeInTheDocument();
  });

  it("shows rule-based suggested prompts for the most relevant hubs", async () => {
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-1",
        owner_id: "user-1",
        name: "Launch Project",
        description: "Sprint planning and delivery notes",
        sources_count: 4,
        created_at: "2025-01-01T00:00:00Z",
      },
      {
        id: "hub-2",
        owner_id: "user-1",
        name: "CSC1097 Revision",
        description: "Lecture notes and exam prep",
        sources_count: 2,
        created_at: "2025-01-02T00:00:00Z",
      },
      {
        id: "hub-3",
        owner_id: "user-1",
        name: "Empty Hub",
        description: "No sources yet",
        sources_count: 0,
        created_at: "2025-01-03T00:00:00Z",
      },
    ]);
    vi.mocked(listReminders).mockResolvedValue([
      {
        id: "rem-1",
        user_id: "user-1",
        hub_id: "hub-1",
        due_at: "2025-01-10T09:00:00Z",
        timezone: "Europe/Dublin",
        status: "scheduled",
        created_at: "2025-01-05T00:00:00Z",
      },
    ]);
    vi.mocked(listActivity).mockResolvedValue([]);
    vi.mocked(listChatSessions).mockResolvedValue([]);

    renderWithQueryClient(<DashboardHome />);

    expect(await screen.findByText(/Extract the main action items, deadlines, and responsibilities/i)).toBeInTheDocument();
    expect(screen.queryByText(/most recent documents/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").filter((button) => button.className.includes("dash-prompt-card"))).toHaveLength(2);
    expect(
      screen.queryByText(/Turn the contents of this hub into a concise study guide/i)
      || screen.queryByText(/Compare the sources in this hub and highlight any contradictions/i)
      || screen.queryByText(/Identify the main risks, blockers, unanswered questions, or unresolved issues in this hub/i)
    ).toBeTruthy();
  });

  it("refreshes the displayed suggested prompts", async () => {
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-1",
        owner_id: "user-1",
        name: "Launch Project",
        description: "Sprint planning and delivery notes",
        sources_count: 4,
        created_at: "2025-01-01T00:00:00Z",
      },
      {
        id: "hub-2",
        owner_id: "user-1",
        name: "CSC1097 Revision",
        description: "Lecture notes and exam prep",
        sources_count: 2,
        created_at: "2025-01-02T00:00:00Z",
      },
    ]);
    vi.mocked(listReminders).mockResolvedValue([
      {
        id: "rem-1",
        user_id: "user-1",
        hub_id: "hub-1",
        due_at: "2025-01-10T09:00:00Z",
        timezone: "Europe/Dublin",
        status: "scheduled",
        created_at: "2025-01-05T00:00:00Z",
      },
    ]);
    vi.mocked(listActivity).mockResolvedValue([]);
    vi.mocked(listChatSessions).mockResolvedValue([]);

    renderWithQueryClient(<DashboardHome />);

    expect(await screen.findByText(/Extract the main action items, deadlines, and responsibilities/i)).toBeInTheDocument();
    expect(screen.getAllByText("Launch Project").length).toBeGreaterThan(0);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Refresh suggested prompts" }));

    expect(screen.getAllByText("Launch Project").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CSC1097 Revision").length).toBeGreaterThan(0);
  });

  it("includes later eligible hubs in refreshed prompt suggestions", async () => {
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-1",
        owner_id: "user-1",
        name: "Launch Project",
        description: "Sprint planning and delivery notes",
        sources_count: 4,
        created_at: "2025-01-01T00:00:00Z",
      },
      {
        id: "hub-2",
        owner_id: "user-1",
        name: "Empty Hub A",
        description: "No sources yet",
        sources_count: 0,
        created_at: "2025-01-02T00:00:00Z",
      },
      {
        id: "hub-3",
        owner_id: "user-1",
        name: "Empty Hub B",
        description: "No sources yet",
        sources_count: 0,
        created_at: "2025-01-03T00:00:00Z",
      },
      {
        id: "hub-4",
        owner_id: "user-1",
        name: "CSC1097 Revision",
        description: "Lecture notes and exam prep",
        sources_count: 2,
        created_at: "2025-01-04T00:00:00Z",
      },
    ]);
    vi.mocked(listReminders).mockResolvedValue([
      {
        id: "rem-1",
        user_id: "user-1",
        hub_id: "hub-1",
        due_at: "2025-01-10T09:00:00Z",
        timezone: "Europe/Dublin",
        status: "scheduled",
        created_at: "2025-01-05T00:00:00Z",
      },
    ]);
    vi.mocked(listActivity).mockResolvedValue([]);
    vi.mocked(listChatSessions).mockResolvedValue([]);

    renderWithQueryClient(<DashboardHome />);

    expect(await screen.findByText(/Extract the main action items, deadlines, and responsibilities/i)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Refresh suggested prompts" }));

    expect(screen.getAllByText("CSC1097 Revision").length).toBeGreaterThan(0);
  });

  it("shows only future scheduled reminders in the home upcoming list", async () => {
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-1",
        owner_id: "user-1",
        name: "Admin Hub",
        description: "Operations",
        created_at: "2026-04-01T00:00:00Z",
      },
    ]);
    vi.mocked(listReminders).mockResolvedValue([
      {
        id: "rem-past",
        user_id: "user-1",
        hub_id: "hub-1",
        due_at: "2000-03-31T11:46:00Z",
        timezone: "Europe/Dublin",
        message: "popup",
        status: "scheduled",
        created_at: "2026-03-01T00:00:00Z",
      },
      {
        id: "rem-complete",
        user_id: "user-1",
        hub_id: "hub-1",
        due_at: "2099-03-31T11:42:00Z",
        timezone: "Europe/Dublin",
        message: "complete",
        status: "completed",
        created_at: "2026-03-01T00:00:00Z",
      },
      {
        id: "rem-future",
        user_id: "user-1",
        hub_id: "hub-1",
        due_at: "2099-04-15T09:30:00Z",
        timezone: "Europe/Dublin",
        message: "Submit report",
        status: "scheduled",
        created_at: "2026-04-10T00:00:00Z",
      },
    ]);
    vi.mocked(listActivity).mockResolvedValue([]);
    vi.mocked(listChatSessions).mockResolvedValue([]);

    renderWithQueryClient(<DashboardHome />);

    expect(await screen.findByText("Submit report")).toBeInTheDocument();
    expect(screen.queryByText("popup")).not.toBeInTheDocument();
    expect(screen.queryByText("complete")).not.toBeInTheDocument();
  });
});
