import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../../components/navigation/Sidebar";
import { deleteChatSession, listChatSessions, renameChatSession } from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

const replaceMock = vi.fn();
const setActiveTabMock = vi.fn();
let currentSearchParams = "session=session-1&prompt=hello";
let activeTab: "chat" | "sources" | "dashboard" | "members" | "settings" | "admin" = "chat";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  usePathname: () => "/hubs/hub-1",
  useParams: () => ({ hubId: "hub-1" }),
  useSearchParams: () => new URLSearchParams(currentSearchParams),
}));

vi.mock("../../lib/api", () => ({
  listChatSessions: vi.fn(),
  deleteChatSession: vi.fn(),
  renameChatSession: vi.fn(),
}));

vi.mock("../../lib/HubTabContext", () => ({
  useHubTab: () => ({
    activeTab,
    setActiveTab: setActiveTabMock,
  }),
  HubTabProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../../lib/CurrentHubContext", () => ({
  useCurrentHub: () => ({
    currentHub: { id: "hub-1", role: "owner" },
  }),
}));

vi.mock("../../lib/SearchContext", () => ({
  useSearch: () => ({
    searchQuery: "",
  }),
}));

describe("Sidebar", () => {
  beforeEach(() => {
    currentSearchParams = "session=session-1&prompt=hello";
    activeTab = "chat";
    vi.mocked(listChatSessions).mockResolvedValue([
      {
        id: "session-1",
        hub_id: "hub-1",
        title: "Assignments",
        scope: "hub",
        source_ids: ["src-1"],
        created_at: "2026-01-02T12:00:00Z",
        last_message_at: "2026-01-02T12:00:00Z",
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("writes the selected hub tab to the URL and preserves other params", async () => {
    renderWithQueryClient(
      <Sidebar state="open" onStateChange={() => undefined} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sources" }));

    expect(setActiveTabMock).toHaveBeenCalledWith("sources");
    expect(replaceMock).toHaveBeenCalledWith(
      "/hubs/hub-1?session=session-1&prompt=hello&tab=sources",
      { scroll: false },
    );
  });

  it("shows an inline error when renaming a chat fails", async () => {
    vi.mocked(renameChatSession).mockRejectedValue(new Error("Rename failed"));

    renderWithQueryClient(
      <Sidebar state="open" onStateChange={() => undefined} />
    );

    await waitFor(() => expect(screen.getByText("Assignments")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Rename Assignments" }));
    const input = screen.getByDisplayValue("Assignments");
    await user.clear(input);
    await user.type(input, "New title{enter}");

    await waitFor(() => expect(screen.getByText("Error: Rename failed")).toBeInTheDocument());
    expect(renameChatSession).toHaveBeenCalledWith("session-1", "New title");
  });

  it("shows an inline error when deleting a chat fails", async () => {
    vi.mocked(deleteChatSession).mockRejectedValue(new Error("Delete failed"));
    vi.stubGlobal("confirm", vi.fn(() => true));

    renderWithQueryClient(
      <Sidebar state="open" onStateChange={() => undefined} />
    );

    await waitFor(() => expect(screen.getByText("Assignments")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete Assignments" }));

    await waitFor(() => expect(screen.getByText("Error: Delete failed")).toBeInTheDocument());
    expect(deleteChatSession).toHaveBeenCalledWith("session-1");
  });
});
