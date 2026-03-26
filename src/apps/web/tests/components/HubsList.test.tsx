import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HubsList } from "../../components/HubsList";
import type { HubsFilterState } from "../../components/HubsToolbar";
import { archiveHub, listHubs, toggleHubFavourite, unarchiveHub, updateHub } from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("../../lib/api", () => ({
  listHubs: vi.fn(),
  toggleHubFavourite: vi.fn(),
  updateHub: vi.fn(),
  archiveHub: vi.fn(),
  unarchiveHub: vi.fn(),
}));

const defaultFilters: HubsFilterState = {
  sortField: "accessed",
  sortDirection: "desc",
  selectedRoles: new Set(),
  typeTab: "all",
  statusTab: "all",
};

describe("HubsList", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders hubs returned from the API", async () => {
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-1",
        owner_id: "user-1",
        name: "Onboarding Hub",
        description: "Docs",
        created_at: "2025-01-01T00:00:00Z",
        role: "owner",
      },
    ]);

    renderWithQueryClient(
      <HubsList searchQuery="" filters={defaultFilters} />
    );

    expect(screen.getByText("Loading hubs...")).toBeInTheDocument();
    expect(await screen.findByText("Onboarding Hub")).toBeInTheDocument();
  });

  it("filters hubs by search query", async () => {
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-1",
        owner_id: "user-1",
        name: "Onboarding Hub",
        description: "Docs",
        created_at: "2025-01-01T00:00:00Z",
        role: "owner",
      },
      {
        id: "hub-2",
        owner_id: "user-1",
        name: "Marketing Hub",
        description: "Marketing materials",
        created_at: "2025-01-02T00:00:00Z",
        role: "editor",
      },
    ]);

    renderWithQueryClient(
      <HubsList searchQuery="marketing" filters={defaultFilters} />
    );

    await screen.findByText("Marketing Hub");
    expect(screen.queryByText("Onboarding Hub")).not.toBeInTheDocument();
  });

  it("filters active and archived hubs using the status tab", async () => {
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-active",
        owner_id: "user-1",
        name: "Active Hub",
        description: "Docs",
        created_at: "2025-01-01T00:00:00Z",
        role: "owner",
      },
      {
        id: "hub-archived",
        owner_id: "user-1",
        name: "Archived Hub",
        description: "Docs",
        created_at: "2025-01-02T00:00:00Z",
        archived_at: "2025-02-01T00:00:00Z",
        role: "owner",
      },
    ]);

    renderWithQueryClient(
      <HubsList searchQuery="" filters={{ ...defaultFilters, statusTab: "active" }} />
    );
    expect(await screen.findByText("Active Hub")).toBeInTheDocument();
    expect(screen.queryByText("Archived Hub")).not.toBeInTheDocument();
  });

  it("renders persisted hub appearance on the card", async () => {
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-1",
        owner_id: "user-1",
        name: "Launch Hub",
        description: "Docs",
        icon_key: "rocket",
        color_key: "blue",
        created_at: "2025-01-01T00:00:00Z",
        role: "owner",
      },
    ]);

    renderWithQueryClient(<HubsList searchQuery="" filters={defaultFilters} />);

    const icon = await screen.findByTestId("hub-icon-hub-1");
    expect(icon).toHaveAttribute("data-icon-key", "rocket");
    expect(icon).toHaveAttribute("data-color-key", "blue");
  });

  it("falls back to the default appearance when none is stored", async () => {
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-1",
        owner_id: "user-1",
        name: "Fallback Hub",
        description: "Docs",
        created_at: "2025-01-01T00:00:00Z",
        role: "owner",
      },
    ]);

    renderWithQueryClient(<HubsList searchQuery="" filters={defaultFilters} />);

    const icon = await screen.findByTestId("hub-icon-hub-1");
    expect(icon).toHaveAttribute("data-icon-key", "stack");
    expect(icon).toHaveAttribute("data-color-key", "slate");
  });

  it("opens the hub editor from the card menu and saves name, description, and appearance changes", async () => {
    const user = userEvent.setup();
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-1",
        owner_id: "user-1",
        name: "Launch Hub",
        description: "Docs",
        icon_key: "rocket",
        color_key: "blue",
        created_at: "2025-01-01T00:00:00Z",
        role: "owner",
      },
    ]);
    vi.mocked(updateHub).mockResolvedValue({
      id: "hub-1",
      owner_id: "user-1",
      name: "Launch Hub Updated",
      description: "Updated docs",
      icon_key: "shield",
      color_key: "emerald",
      created_at: "2025-01-01T00:00:00Z",
      role: "owner",
    });

    renderWithQueryClient(<HubsList searchQuery="" filters={defaultFilters} />);

    await screen.findByText("Launch Hub");
    await user.click(screen.getByLabelText("Hub options for Launch Hub"));
    await user.click(screen.getByRole("button", { name: "Edit hub" }));
    await user.clear(screen.getByLabelText("Hub title"));
    await user.type(screen.getByLabelText("Hub title"), "Launch Hub Updated");
    await user.clear(screen.getByPlaceholderText("What is this hub for?"));
    await user.type(screen.getByPlaceholderText("What is this hub for?"), "Updated docs");
    await user.click(screen.getByLabelText("Select Secure icon"));
    await user.click(screen.getByLabelText("Select Emerald color"));
    await user.click(screen.getByRole("button", { name: "Save hub" }));

    expect(updateHub).toHaveBeenCalledWith("hub-1", {
      name: "Launch Hub Updated",
      description: "Updated docs",
      icon_key: "shield",
      color_key: "emerald",
    });
  });

  it("lets admins open the hub editor and save changes", async () => {
    const user = userEvent.setup();
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-admin",
        owner_id: "user-2",
        name: "Admin Hub",
        description: "Docs",
        icon_key: "book",
        color_key: "violet",
        created_at: "2025-01-03T00:00:00Z",
        role: "admin",
      },
    ]);
    vi.mocked(updateHub).mockResolvedValue({
      id: "hub-admin",
      owner_id: "user-2",
      name: "Admin Hub Updated",
      description: "Admin docs",
      icon_key: "shield",
      color_key: "emerald",
      created_at: "2025-01-03T00:00:00Z",
      role: "admin",
    });

    renderWithQueryClient(<HubsList searchQuery="" filters={defaultFilters} />);

    await screen.findByText("Admin Hub");
    await user.click(screen.getByLabelText("Hub options for Admin Hub"));
    await user.click(screen.getByRole("button", { name: "Edit hub" }));
    await user.clear(screen.getByLabelText("Hub title"));
    await user.type(screen.getByLabelText("Hub title"), "Admin Hub Updated");
    await user.clear(screen.getByPlaceholderText("What is this hub for?"));
    await user.type(screen.getByPlaceholderText("What is this hub for?"), "Admin docs");
    await user.click(screen.getByLabelText("Select Secure icon"));
    await user.click(screen.getByLabelText("Select Emerald color"));
    await user.click(screen.getByRole("button", { name: "Save hub" }));

    expect(updateHub).toHaveBeenCalledWith("hub-admin", {
      name: "Admin Hub Updated",
      description: "Admin docs",
      icon_key: "shield",
      color_key: "emerald",
    });
  });

  it("disables save and blocks submission when the trimmed hub name is blank", async () => {
    const user = userEvent.setup();
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-1",
        owner_id: "user-1",
        name: "Launch Hub",
        description: "Docs",
        icon_key: "rocket",
        color_key: "blue",
        created_at: "2025-01-01T00:00:00Z",
        role: "owner",
      },
    ]);

    renderWithQueryClient(<HubsList searchQuery="" filters={defaultFilters} />);

    await screen.findByText("Launch Hub");
    await user.click(screen.getByLabelText("Hub options for Launch Hub"));
    await user.click(screen.getByRole("button", { name: "Edit hub" }));
    await user.clear(screen.getByLabelText("Hub title"));
    await user.type(screen.getByLabelText("Hub title"), "   ");

    const saveButton = screen.getByRole("button", { name: "Save hub" });
    expect(saveButton).toBeDisabled();
    expect(updateHub).not.toHaveBeenCalled();
  });

  it("shows an inline error when saving hub changes fails", async () => {
    const user = userEvent.setup();
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-1",
        owner_id: "user-1",
        name: "Launch Hub",
        description: "Docs",
        icon_key: "rocket",
        color_key: "blue",
        created_at: "2025-01-01T00:00:00Z",
        role: "owner",
      },
    ]);
    vi.mocked(updateHub).mockRejectedValue(new Error("Owner or admin role required."));

    renderWithQueryClient(<HubsList searchQuery="" filters={defaultFilters} />);

    await screen.findByText("Launch Hub");
    await user.click(screen.getByLabelText("Hub options for Launch Hub"));
    await user.click(screen.getByRole("button", { name: "Edit hub" }));
    await user.clear(screen.getByLabelText("Hub title"));
    await user.type(screen.getByLabelText("Hub title"), "Launch Hub Updated");
    await user.click(screen.getByRole("button", { name: "Save hub" }));

    expect(await screen.findByText("Failed to save hub changes: Owner or admin role required.")).toBeInTheDocument();
  });

  it("only shows the appearance menu for owners and admins", async () => {
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-owner",
        owner_id: "user-1",
        name: "Owner Hub",
        description: "Docs",
        created_at: "2025-01-01T00:00:00Z",
        role: "owner",
      },
      {
        id: "hub-admin",
        owner_id: "user-2",
        name: "Admin Hub",
        description: "Docs",
        created_at: "2025-01-03T00:00:00Z",
        role: "admin",
      },
      {
        id: "hub-editor",
        owner_id: "user-2",
        name: "Editor Hub",
        description: "Docs",
        created_at: "2025-01-02T00:00:00Z",
        role: "editor",
      },
    ]);

    renderWithQueryClient(<HubsList searchQuery="" filters={defaultFilters} />);

    expect(await screen.findByText("Owner Hub")).toBeInTheDocument();
    expect(screen.getByLabelText("Hub options for Owner Hub")).toBeInTheDocument();
    expect(screen.getByLabelText("Hub options for Admin Hub")).toBeInTheDocument();
    expect(screen.queryByLabelText("Hub options for Editor Hub")).not.toBeInTheDocument();
  });

  it("shows archive hub only for owners and calls archiveHub on confirm", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-owner",
        owner_id: "user-1",
        name: "Owner Hub",
        description: "Docs",
        created_at: "2025-01-01T00:00:00Z",
        role: "owner",
      },
      {
        id: "hub-admin",
        owner_id: "user-2",
        name: "Admin Hub",
        description: "Docs",
        created_at: "2025-01-03T00:00:00Z",
        role: "admin",
      },
    ]);
    vi.mocked(archiveHub).mockResolvedValue({
      id: "hub-owner",
      owner_id: "user-1",
      name: "Owner Hub",
      description: "Docs",
      created_at: "2025-01-01T00:00:00Z",
      archived_at: "2025-02-01T00:00:00Z",
      role: "owner",
    });

    renderWithQueryClient(<HubsList searchQuery="" filters={defaultFilters} />);

    await screen.findByText("Owner Hub");
    await user.click(screen.getByLabelText("Hub options for Owner Hub"));
    expect(screen.getByRole("button", { name: "Archive hub" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archive hub" }));

    expect(confirmSpy).toHaveBeenCalledWith('Archive "Owner Hub"? You can still view it in Archived.');
    expect(archiveHub).toHaveBeenCalledWith("hub-owner");

    await user.click(screen.getByLabelText("Hub options for Admin Hub"));
    expect(screen.queryByRole("button", { name: "Archive hub" })).not.toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("shows unarchive hub for archived owner hubs and calls unarchiveHub on confirm", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-owner",
        owner_id: "user-1",
        name: "Owner Hub",
        description: "Docs",
        created_at: "2025-01-01T00:00:00Z",
        archived_at: "2025-02-01T00:00:00Z",
        role: "owner",
      },
    ]);
    vi.mocked(unarchiveHub).mockResolvedValue({
      id: "hub-owner",
      owner_id: "user-1",
      name: "Owner Hub",
      description: "Docs",
      created_at: "2025-01-01T00:00:00Z",
      archived_at: null,
      role: "owner",
    });

    renderWithQueryClient(<HubsList searchQuery="" filters={{ ...defaultFilters, statusTab: "archived" }} />);

    await screen.findByText("Owner Hub");
    await user.click(screen.getByLabelText("Hub options for Owner Hub"));
    expect(screen.getByRole("button", { name: "Unarchive hub" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Unarchive hub" }));

    expect(confirmSpy).toHaveBeenCalledWith('Unarchive "Owner Hub"? It will appear in Active again.');
    expect(unarchiveHub).toHaveBeenCalledWith("hub-owner");

    confirmSpy.mockRestore();
  });

  it("shows an inline error when archiving fails", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-owner",
        owner_id: "user-1",
        name: "Owner Hub",
        description: "Docs",
        created_at: "2025-01-01T00:00:00Z",
        role: "owner",
      },
    ]);
    vi.mocked(archiveHub).mockRejectedValue(new Error("Owner role required."));

    renderWithQueryClient(<HubsList searchQuery="" filters={defaultFilters} />);

    await screen.findByText("Owner Hub");
    await user.click(screen.getByLabelText("Hub options for Owner Hub"));
    await user.click(screen.getByRole("button", { name: "Archive hub" }));

    expect(await screen.findByText("Failed to archive hub: Owner role required.")).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("disables favouriting for optimistic hubs until creation finishes", async () => {
    const user = userEvent.setup();
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "temp-hub-123",
        owner_id: "pending",
        name: "Creating Hub",
        description: "Docs",
        created_at: "2025-01-01T00:00:00Z",
        role: "owner",
        is_favourite: false,
      },
    ]);

    renderWithQueryClient(<HubsList searchQuery="" filters={defaultFilters} />);

    const button = await screen.findByLabelText("Hub is still being created");
    expect(button).toBeDisabled();

    await user.click(button);

    expect(toggleHubFavourite).not.toHaveBeenCalled();
  });

  it("disables favouriting while a newly created hub is still syncing", async () => {
    const user = userEvent.setup();
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-1",
        owner_id: "user-1",
        name: "Fresh Hub",
        description: "Docs",
        created_at: "2025-01-01T00:00:00Z",
        role: "owner",
        is_favourite: false,
        _isPendingClientSync: true,
      },
    ]);

    renderWithQueryClient(<HubsList searchQuery="" filters={defaultFilters} />);

    const button = await screen.findByLabelText("Hub is still being created");
    expect(button).toBeDisabled();

    await user.click(button);

    expect(toggleHubFavourite).not.toHaveBeenCalled();
  });

  it("hides pagination when no hubs match the current filters", async () => {
    vi.mocked(listHubs).mockResolvedValue([
      {
        id: "hub-1",
        owner_id: "user-1",
        name: "Onboarding Hub",
        description: "Docs",
        created_at: "2025-01-01T00:00:00Z",
        role: "owner",
      },
    ]);

    renderWithQueryClient(<HubsList searchQuery="missing" filters={defaultFilters} />);

    expect(await screen.findByText("No hubs found. Create your first hub to get started.")).toBeInTheDocument();
    expect(screen.queryByText(/Showing .* of 0 Hubs/)).not.toBeInTheDocument();
  });
});
