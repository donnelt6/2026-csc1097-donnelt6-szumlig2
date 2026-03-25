import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResetPasswordPageClient } from "../../components/auth/ResetPasswordPageClient";

const { getSession, updateUser, exchangeCodeForSession, unsubscribe } = vi.hoisted(() => ({
  getSession: vi.fn(),
  updateUser: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("../../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession,
      updateUser,
      exchangeCodeForSession,
      onAuthStateChange: () => ({
        data: {
          listener: undefined,
          subscription: {
            unsubscribe,
          },
        },
      }),
    },
  },
}));

describe("ResetPasswordPageClient", () => {
  beforeEach(() => {
    getSession.mockReset();
    updateUser.mockReset();
    exchangeCodeForSession.mockReset();
    unsubscribe.mockReset();
    window.history.replaceState({}, "", "/auth/reset-password");
  });

  it("renders a password form when a recovery session is present", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null });

    render(<ResetPasswordPageClient />);

    expect(await screen.findByRole("button", { name: "Update password" })).toBeInTheDocument();
  });

  it("shows a clean invalid-link message when no recovery session exists", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    render(<ResetPasswordPageClient />);

    await waitFor(() =>
      expect(screen.getByText("This recovery link is invalid or has expired. Request a new password reset email.")).toBeInTheDocument(),
    );
  });

  it("updates the password and shows a success state", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null });
    updateUser.mockResolvedValue({ error: null });

    render(<ResetPasswordPageClient />);

    await screen.findByRole("button", { name: "Update password" });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password-123" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "new-password-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: "new-password-123" }));
    expect(screen.getByText("Your password has been updated. You can continue into Caddie now.")).toBeInTheDocument();
  });
});
