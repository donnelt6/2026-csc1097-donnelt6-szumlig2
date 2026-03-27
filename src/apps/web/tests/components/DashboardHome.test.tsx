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
});
