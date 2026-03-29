import { screen } from "@testing-library/react";
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
<<<<<<< Updated upstream
    expect(screen.getByText(/Turn the contents of this hub into a concise study guide/i)).toBeInTheDocument();
    expect(screen.queryByText(/Compare the sources in this hub and highlight any contradictions/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").filter((button) => button.className.includes("dash-prompt-card"))).toHaveLength(2);
    expect(screen.queryByText(/most recent documents/i)).not.toBeInTheDocument();
=======
    expect(screen.queryByText(/most recent documents/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").filter((button) => button.className.includes("dash-prompt-card"))).toHaveLength(2);
    expect(
      screen.queryByText(/Turn the contents of this hub into a concise study guide/i)
      || screen.queryByText(/Compare the sources in this hub and highlight any contradictions/i)
      || screen.queryByText(/Identify the main risks, blockers, unanswered questions, or unresolved issues in this hub/i)
    ).toBeTruthy();
>>>>>>> Stashed changes
  });
});
