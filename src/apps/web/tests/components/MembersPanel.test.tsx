import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MembersPanel } from "../../components/MembersPanel";
import { listMembers, removeMember, transferHubOwnership } from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

let mockUserId = "owner-1";

vi.mock("../../lib/api", () => ({
  inviteMember: vi.fn(),
  listMembers: vi.fn(),
  removeMember: vi.fn(),
  transferHubOwnership: vi.fn(),
  updateMemberRole: vi.fn(),
}));

vi.mock("../../components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: mockUserId },
  }),
}));

const pushMock = vi.fn();
const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
  }),
}));

describe("MembersPanel", () => {
  afterEach(() => {
    mockUserId = "owner-1";
    pushMock.mockReset();
    replaceMock.mockReset();
    vi.clearAllMocks();
  });

  it("renders member skeleton rows while loading", () => {
    const pending = new Promise<never>(() => {});
    vi.mocked(listMembers).mockReturnValue(pending);

    renderWithQueryClient(<MembersPanel hubId="hub-1" role="owner" />);

    expect(screen.getByText("Member")).toBeInTheDocument();
    expect(screen.getByTestId("members-header-btn-skeleton-0")).toBeInTheDocument();
    expect(screen.getByTestId("members-header-btn-skeleton-1")).toBeInTheDocument();
    expect(screen.getByTestId("members-filter-pill-skeleton-0")).toBeInTheDocument();
    expect(screen.getByTestId("members-filter-pill-skeleton-6")).toBeInTheDocument();
    expect(screen.getByTestId("members-row-skeleton-0")).toBeInTheDocument();
    expect(screen.getByTestId("members-row-skeleton-4")).toBeInTheDocument();
    expect(screen.queryByText("Loading members...")).not.toBeInTheDocument();
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

  it("shows admin remove actions only for editor and viewer members", async () => {
    mockUserId = "admin-1";
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
        user_id: "admin-2",
        role: "admin",
        accepted_at: "2026-03-22T10:00:00Z",
        email: "admin2@example.com",
      },
      {
        hub_id: "hub-1",
        user_id: "editor-1",
        role: "editor",
        accepted_at: "2026-03-22T10:00:00Z",
        email: "editor@example.com",
      },
      {
        hub_id: "hub-1",
        user_id: "viewer-1",
        role: "viewer",
        accepted_at: "2026-03-22T10:00:00Z",
        email: "viewer@example.com",
      },
    ]);

    renderWithQueryClient(<MembersPanel hubId="hub-1" role="admin" />);

    const ownerRow = (await screen.findByText("owner@example.com")).closest(".members__row") as HTMLElement;
    const selfRow = screen.getByText("admin@example.com").closest(".members__row") as HTMLElement;
    const otherAdminRow = screen.getByText("admin2@example.com").closest(".members__row") as HTMLElement;
    const editorRow = screen.getByText("editor@example.com").closest(".members__row") as HTMLElement;
    const viewerRow = screen.getByText("viewer@example.com").closest(".members__row") as HTMLElement;

    expect(within(ownerRow).queryByTitle("Remove member")).not.toBeInTheDocument();
    expect(within(selfRow).queryByTitle("Remove member")).not.toBeInTheDocument();
    expect(within(otherAdminRow).queryByTitle("Remove member")).not.toBeInTheDocument();
    expect(within(editorRow).getByTitle("Remove member")).toBeInTheDocument();
    expect(within(viewerRow).getByTitle("Remove member")).toBeInTheDocument();
  });

  it("keeps owner separate from admin in role filter counts", async () => {
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
        user_id: "admin-2",
        role: "admin",
        accepted_at: "2026-03-22T10:00:00Z",
        email: "admin2@example.com",
      },
    ]);

    renderWithQueryClient(<MembersPanel hubId="hub-1" role="owner" />);

    await screen.findByText("owner@example.com");
    expect(screen.getByRole("button", { name: "Owner (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Admin (2)" })).toBeInTheDocument();
  });

  it("shows a leave hub action below capacity for non-owners", async () => {
    mockUserId = "editor-1";
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
        user_id: "editor-1",
        role: "editor",
        accepted_at: "2026-03-22T10:00:00Z",
        email: "editor@example.com",
      },
    ]);

    renderWithQueryClient(<MembersPanel hubId="hub-1" role="editor" />);

    await screen.findByText("editor@example.com");
    expect(screen.getByRole("button", { name: "Leave this hub" })).toBeInTheDocument();
  });

  it("lets non-owners leave the hub from the sidebar action", async () => {
    mockUserId = "viewer-1";
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
        user_id: "viewer-1",
        role: "viewer",
        accepted_at: "2026-03-22T10:00:00Z",
        email: "viewer@example.com",
      },
    ]);
    vi.mocked(removeMember).mockResolvedValue(undefined);
    vi.stubGlobal("confirm", vi.fn(() => true));

    const user = userEvent.setup();
    renderWithQueryClient(<MembersPanel hubId="hub-1" role="viewer" />);

    await user.click(await screen.findByRole("button", { name: "Leave this hub" }));

    await waitFor(() => expect(removeMember).toHaveBeenCalledWith("hub-1", "viewer-1"));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/hubs"));
  });
});
