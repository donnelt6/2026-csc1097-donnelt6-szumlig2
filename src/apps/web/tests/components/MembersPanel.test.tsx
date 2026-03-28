import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MembersPanel } from "../../components/MembersPanel";
import { listMembers, transferHubOwnership } from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

vi.mock("../../lib/api", () => ({
  inviteMember: vi.fn(),
  listMembers: vi.fn(),
  removeMember: vi.fn(),
  transferHubOwnership: vi.fn(),
  updateMemberRole: vi.fn(),
}));

vi.mock("../../components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "owner-1" },
  }),
}));

describe("MembersPanel", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not expose direct owner assignment controls", async () => {
    vi.mocked(listMembers).mockResolvedValue([
      {
        hub_id: "hub-1",
        user_id: "owner-1",
        role: "owner",
        accepted_at: "2026-03-22T10:00:00Z",
        email: "owner@example.com",
      },
      {
        hub_id: "hub-1",
        user_id: "admin-1",
        role: "admin",
        accepted_at: "2026-03-22T10:00:00Z",
        email: "admin@example.com",
      },
      {
        hub_id: "hub-1",
        user_id: "viewer-1",
        role: "viewer",
        accepted_at: "2026-03-22T10:00:00Z",
        email: "viewer@example.com",
      },
    ]);

    renderWithQueryClient(<MembersPanel hubId="hub-1" role="owner" />);

    await waitFor(() => expect(screen.getByText("owner@example.com")).toBeInTheDocument());
    // Owner row shows a static "Owner" label, not a dropdown
    const ownerRow = screen.getByText("owner@example.com").closest(".members__row") as HTMLElement;
    const roleCell = within(ownerRow).getByText("Owner");
    expect(roleCell.classList.contains("members__role-label")).toBe(true);
    // No dropdown button in the owner's role cell
    const roleCellContainer = roleCell.closest(".members__cell--role") as HTMLElement;
    expect(within(roleCellContainer).queryByRole("button")).not.toBeInTheDocument();
  });

  it("limits ownership transfer targets to accepted admins", async () => {
    vi.mocked(listMembers).mockResolvedValue([
      {
        hub_id: "hub-1",
        user_id: "owner-1",
        role: "owner",
        accepted_at: "2026-03-22T10:00:00Z",
        email: "owner@example.com",
      },
      {
        hub_id: "hub-1",
        user_id: "admin-1",
        role: "admin",
        accepted_at: "2026-03-22T10:00:00Z",
        email: "admin@example.com",
      },
      {
        hub_id: "hub-1",
        user_id: "viewer-1",
        role: "viewer",
        accepted_at: "2026-03-22T10:00:00Z",
        email: "viewer@example.com",
      },
    ]);

    const user = userEvent.setup();
    renderWithQueryClient(<MembersPanel hubId="hub-1" role="owner" />);

    // Open the transfer modal
    await user.click(await screen.findByRole("button", { name: "Transfer Ownership" }));

    // Open the admin dropdown inside the modal
    const modal = screen.getByText("Transfer Ownership", { selector: "h3" }).closest(".modal") as HTMLElement;
    const dropdownBtn = within(modal).getAllByRole("button").find(
      (btn) => btn.classList.contains("members__dropdown-btn")
    )!;
    await user.click(dropdownBtn);

    // Should contain the admin but not the viewer
    expect(within(modal).getByText("admin@example.com")).toBeInTheDocument();
    expect(within(modal).queryByText("viewer@example.com")).not.toBeInTheDocument();
  });

  it("requires confirmation before transferring ownership", async () => {
    vi.mocked(listMembers).mockResolvedValue([
      {
        hub_id: "hub-1",
        user_id: "owner-1",
        role: "owner",
        accepted_at: "2026-03-22T10:00:00Z",
        email: "owner@example.com",
      },
      {
        hub_id: "hub-1",
        user_id: "admin-1",
        role: "admin",
        accepted_at: "2026-03-22T10:00:00Z",
        email: "admin@example.com",
      },
    ]);
    vi.stubGlobal("confirm", vi.fn(() => false));

    const user = userEvent.setup();
    renderWithQueryClient(<MembersPanel hubId="hub-1" role="owner" />);

    // Open the transfer modal
    await user.click(await screen.findByRole("button", { name: "Transfer Ownership" }));

    // Select the admin from the dropdown
    const modal = screen.getByText("Transfer Ownership", { selector: "h3" }).closest(".modal") as HTMLElement;
    const dropdownBtn = within(modal).getAllByRole("button").find(
      (btn) => btn.classList.contains("members__dropdown-btn")
    )!;
    await user.click(dropdownBtn);
    await user.click(within(modal).getByText("admin@example.com"));

    // Click "Transfer ownership" button
    await user.click(within(modal).getByRole("button", { name: "Transfer ownership" }));

    // confirm() returned false, so the API should not have been called
    expect(transferHubOwnership).not.toHaveBeenCalled();
  });
});
