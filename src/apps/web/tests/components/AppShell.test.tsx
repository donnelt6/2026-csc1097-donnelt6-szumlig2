import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../../components/AppShell";
import { listChatSessions, listHubs, searchChatMessages } from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

const replaceMock = vi.fn();
let currentSearchParams = "tab=chat";
let currentActiveTab = "chat";
let currentActiveDashTab = "overview";
const setSearchQueryMock = vi.fn();
const setActiveDashTabMock = vi.fn();
const setActiveAdminTabMock = vi.fn();
const originalMatchMedia = window.matchMedia;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  usePathname: () => "/hubs/hub-1",
  useParams: () => ({ hubId: "hub-1" }),
  useSearchParams: () => new URLSearchParams(currentSearchParams),
}));

vi.mock("../../components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    loading: false,
  }),
}));

vi.mock("../../components/navigation/ProfileMenu", () => ({
  ProfileMenu: () => <div>profile</div>,
}));

vi.mock("../../components/navigation/NotificationsMenu", () => ({
  NotificationsMenu: () => <div>notifications</div>,
}));

vi.mock("../../lib/HubTabContext", () => ({
  useHubTab: () => ({
    activeTab: currentActiveTab,
  }),
  HubTabProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../../lib/HubDashboardTabContext", () => ({
  useHubDashboardTab: () => ({
    activeDashTab: currentActiveDashTab,
    setActiveDashTab: setActiveDashTabMock,
    activeAdminTab: "overview",
    setActiveAdminTab: setActiveAdminTabMock,
    pendingDate: null,
    setPendingDate: vi.fn(),
  }),
  HubDashboardTabProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../../lib/SearchContext", () => ({
  SearchProvider: ({ children }: { children: React.ReactNode }) => children,
  useSearch: () => ({
    searchQuery: "",
    setSearchQuery: setSearchQueryMock,
  }),
}));

vi.mock("../../lib/api", () => ({
  listHubs: vi.fn(),
  listChatSessions: vi.fn(),
  searchChatMessages: vi.fn(),
  deleteChatSession: vi.fn(),
  renameChatSession: vi.fn(),
}));

describe("AppShell", () => {
  beforeEach(() => {
    currentSearchParams = "tab=chat";
    currentActiveTab = "chat";
    currentActiveDashTab = "overview";
    replaceMock.mockReset();
    setSearchQueryMock.mockReset();
    setActiveDashTabMock.mockReset();
    setActiveAdminTabMock.mockReset();
    window.matchMedia = originalMatchMedia;
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-1",
        owner_id: "user-1",
        name: "Compiler Design",
        icon_key: "stack",
        color_key: "blue",
        created_at: "2026-01-01T00:00:00Z",
        role: "owner",
      },
    ]);
    vi.mocked(listChatSessions).mockResolvedValue([
      {
        id: "session-1",
        hub_id: "hub-1",
        title: "Assignments",
        scope: "hub",
        source_ids: [],
        created_at: "2026-01-01T00:00:00Z",
        last_message_at: "2026-01-02T00:00:00Z",
      },
      {
        id: "session-2",
        hub_id: "hub-1",
        title: "Revision plan",
        scope: "hub",
        source_ids: [],
        created_at: "2026-01-03T00:00:00Z",
        last_message_at: "2026-01-04T00:00:00Z",
      },
    ]);
    vi.mocked(searchChatMessages).mockResolvedValue([
      {
        session_id: "session-2",
        session_title: "Revision plan",
        hub_id: "hub-1",
        message_id: "message-7",
        matched_role: "assistant",
        snippet: "...assignments are due Friday...",
        matched_text: "assignments",
        created_at: "2026-01-04T00:00:00Z",
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.matchMedia = originalMatchMedia;
  });

  it("shows chat search results below the hub search bar and keeps sidebar chats visible", async () => {
    const { container } = renderWithQueryClient(<AppShell><div>content</div></AppShell>);

    await waitFor(() => expect(screen.getByText("Assignments")).toBeInTheDocument());
    expect(screen.getByText("Revision plan")).toBeInTheDocument();

    const user = userEvent.setup();
    const input = screen.getByPlaceholderText("Search conversations...");
    await user.type(input, "assignments");

    await waitFor(() => expect(searchChatMessages).toHaveBeenCalledWith("hub-1", "assignments"));
    expect(screen.getByText("Assignments")).toBeInTheDocument();
    expect(await screen.findByText((_, element) => element?.textContent === "Response")).toBeInTheDocument();
    expect(container.querySelector(".nav-chat-search-dropdown")).toBeTruthy();
  });

  it("opens the matching chat session and message when a search result is clicked", async () => {
    renderWithQueryClient(<AppShell><div>content</div></AppShell>);

    const user = userEvent.setup();
    const input = await screen.findByPlaceholderText("Search conversations...");
    await user.type(input, "assignments");

    const resultMeta = await screen.findByText("Caddie: ...assignments are due Friday...");
    await user.click(resultMeta.closest("button")!);

    expect(replaceMock).toHaveBeenCalledWith(
      "/hubs/hub-1?tab=chat&session=session-2&message=message-7",
      { scroll: false },
    );
  });

  it("opens the matching chat session without a message target for title matches", async () => {
    vi.mocked(searchChatMessages).mockResolvedValueOnce([
      {
        session_id: "session-1",
        session_title: "Assignments",
        hub_id: "hub-1",
        message_id: null,
        matched_role: "title",
        snippet: "Assignments",
        matched_text: "Assignments",
        created_at: "2026-01-02T00:00:00Z",
      },
    ]);

    renderWithQueryClient(<AppShell><div>content</div></AppShell>);

    const user = userEvent.setup();
    const input = await screen.findByPlaceholderText("Search conversations...");
    await user.type(input, "assignments");

    expect(await screen.findByText("Title")).toBeInTheDocument();
    const resultMeta = await screen.findByText("Title: Assignments");
    await user.click(resultMeta.closest("button")!);

    expect(replaceMock).toHaveBeenCalledWith(
      "/hubs/hub-1?tab=chat&session=session-1",
      { scroll: false },
    );
  });

  it("shows the dashboard nav search above the 1024px breakpoint", () => {
    currentActiveTab = "dashboard";
    currentActiveDashTab = "faqs";
    window.matchMedia = vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));

    renderWithQueryClient(<AppShell><div>content</div></AppShell>);

    expect(screen.getByPlaceholderText("Search FAQs...")).toBeInTheDocument();
  });

  it("removes the dashboard nav search at 1024px and below so the page-level fallback can take over", () => {
    currentActiveTab = "dashboard";
    currentActiveDashTab = "guides";
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === "(max-width: 1024px)",
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));

    renderWithQueryClient(<AppShell><div>content</div></AppShell>);

    expect(screen.queryByPlaceholderText("Search guides...")).not.toBeInTheDocument();
  });

});
