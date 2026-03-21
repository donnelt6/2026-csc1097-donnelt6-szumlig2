import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HubsList } from "../../components/HubsList";
import type { HubsFilterState } from "../../components/HubsToolbar";
import { listHubs } from "../../lib/api";
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
});
