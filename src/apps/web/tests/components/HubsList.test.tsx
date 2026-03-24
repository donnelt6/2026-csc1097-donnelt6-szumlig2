import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HubsList } from "../../components/HubsList";
import type { HubsFilterState } from "../../components/HubsToolbar";
import { archiveHub, listHubs, unarchiveHub, updateHub } from "../../lib/api";
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

  it("opens the appearance editor from the card menu and saves changes", async () => {
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
      name: "Launch Hub",
      description: "Docs",
      icon_key: "shield",
      color_key: "emerald",
      created_at: "2025-01-01T00:00:00Z",
      role: "owner",
    });

    renderWithQueryClient(<HubsList searchQuery="" filters={defaultFilters} />);

    await screen.findByText("Launch Hub");
    await user.click(screen.getByLabelText("Hub options for Launch Hub"));
    await user.click(screen.getByRole("button", { name: "Edit appearance" }));
    await user.click(screen.getByLabelText("Select Secure icon"));
    await user.click(screen.getByRole("tab", { name: "Color" }));
    await user.click(screen.getByLabelText("Select Emerald color"));
    await user.click(screen.getByRole("button", { name: "Save appearance" }));

    expect(updateHub).toHaveBeenCalledWith("hub-1", {
      icon_key: "shield",
      color_key: "emerald",
    });
  });

  it("lets admins open the appearance editor and save changes", async () => {
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
      name: "Admin Hub",
      description: "Docs",
      icon_key: "shield",
      color_key: "emerald",
      created_at: "2025-01-03T00:00:00Z",
      role: "admin",
    });

    renderWithQueryClient(<HubsList searchQuery="" filters={defaultFilters} />);

    await screen.findByText("Admin Hub");
    await user.click(screen.getByLabelText("Hub options for Admin Hub"));
    await user.click(screen.getByRole("button", { name: "Edit appearance" }));
    await user.click(screen.getByLabelText("Select Secure icon"));
    await user.click(screen.getByRole("tab", { name: "Color" }));
    await user.click(screen.getByLabelText("Select Emerald color"));
    await user.click(screen.getByRole("button", { name: "Save appearance" }));

    expect(updateHub).toHaveBeenCalledWith("hub-admin", {
      icon_key: "shield",
      color_key: "emerald",
    });
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
