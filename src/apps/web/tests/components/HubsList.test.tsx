// Tests HubsList rendering and create flow with mocked API responses.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HubsList } from "../../components/HubsList";
import { createHub, listHubs } from "../../lib/api";
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
  createHub: vi.fn(),
}));

describe("HubsList", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders hubs returned from the API", async () => {
    // Expect hub cards to appear after the list query resolves.
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

    renderWithQueryClient(<HubsList />);

    expect(screen.getByText("Loading hubs...")).toBeInTheDocument();
    expect(await screen.findByText("Onboarding Hub")).toBeInTheDocument();
  });

  it("submits a new hub through the create form", async () => {
    // Expect createHub to be called with typed form values.
    vi.mocked(listHubs).mockResolvedValue([]);
    vi.mocked(createHub).mockResolvedValue({
      id: "hub-2",
      owner_id: "user-1",
      name: "New Hub",
      description: "Team docs",
      created_at: "2025-01-02T00:00:00Z",
      role: "owner",
    });

    const user = userEvent.setup();
    renderWithQueryClient(<HubsList />);

    await user.type(screen.getByPlaceholderText("e.g. Onboarding hub"), "New Hub");
    await user.type(screen.getByPlaceholderText("What is this hub for?"), "Team docs");
    await user.click(screen.getByRole("button", { name: "Create hub" }));

    await waitFor(() => {
      expect(createHub).toHaveBeenCalledWith({ name: "New Hub", description: "Team docs" });
    });
  });
});
