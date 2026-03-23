import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MembersPanel } from "../../components/MembersPanel";
import { listMembers } from "../../lib/api";
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
    expect(screen.queryByRole("option", { name: "Owner" })).not.toBeInTheDocument();
    expect(screen.getByText("Owner role is fixed.")).toBeInTheDocument();
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

    renderWithQueryClient(<MembersPanel hubId="hub-1" role="owner" />);

    await waitFor(() => {
      const options = Array.from((screen.getByLabelText("Target admin") as HTMLSelectElement).options).map(
        (option) => option.text
      );
      expect(options).toContain("admin@example.com");
    });
    const transferSelect = screen.getByLabelText("Target admin") as HTMLSelectElement;
    const options = Array.from(transferSelect.options).map((option) => option.text);
    expect(options).toContain("admin@example.com");
    expect(options).not.toContain("viewer@example.com");
  });
});
