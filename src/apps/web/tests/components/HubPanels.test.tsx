import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HubPanels } from "../../components/navigation/HubPanels";
import { CurrentHubProvider } from "../../lib/CurrentHubContext";
import { renderWithQueryClient } from "../test-utils";

const setActiveTabMock = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ hubId: "hub-1" }),
}));

vi.mock("../../lib/HubTabContext", async () => {
  const actual = await vi.importActual<typeof import("../../lib/HubTabContext")>("../../lib/HubTabContext");
  return {
    ...actual,
    useHubTab: () => ({
      activeTab: "chat",
      setActiveTab: setActiveTabMock,
    }),
  };
});

describe("HubPanels", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function renderHubPanels(role: "owner" | "admin" | "viewer") {
    return renderWithQueryClient(
      <CurrentHubProvider
        value={{
          currentHub: {
            id: "hub-1",
            owner_id: "owner-1",
            name: "Hub One",
            created_at: "2026-03-22T10:00:00Z",
            role,
          },
          isLoading: false,
        }}
      >
        <HubPanels />
      </CurrentHubProvider>
    );
  }

  it("shows the admin tab for hub moderators", async () => {
    renderHubPanels("admin");

    await waitFor(() => expect(screen.getByRole("button", { name: "Admin" })).toBeInTheDocument());
  });

  it("hides the admin tab for non-moderators", async () => {
    renderHubPanels("viewer");
    expect(screen.queryByRole("button", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("switches to the admin tab when selected", async () => {
    renderHubPanels("owner");

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "Admin" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Admin" }));

    expect(setActiveTabMock).toHaveBeenCalledWith("admin");
  });
});
