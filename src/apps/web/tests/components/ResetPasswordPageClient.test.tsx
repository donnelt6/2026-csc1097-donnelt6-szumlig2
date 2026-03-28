import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResetPasswordPageClient } from "../../components/auth/ResetPasswordPageClient";

const replaceMock = vi.fn();
const { getSession, updateUser, exchangeCodeForSession, verifyOtp, signOut, unsubscribe } = vi.hoisted(() => ({
  getSession: vi.fn(),
  updateUser: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("../../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession,
      updateUser,
      exchangeCodeForSession,
      verifyOtp,
      signOut,
      onAuthStateChange: () => ({
        data: {
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
    verifyOtp.mockReset();
    signOut.mockReset();
    unsubscribe.mockReset();
    replaceMock.mockReset();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/auth/reset-password");
  });

  it("renders a password form when recovery intent has been confirmed", async () => {
    sessionStorage.setItem("caddie:recovery-intent", "1");
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null });

    render(<ResetPasswordPageClient />);

    expect(await screen.findByRole("button", { name: "Update password" })).toBeInTheDocument();
  });

  it("rejects non-recovery visits even when a regular session exists", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null });

    render(<ResetPasswordPageClient />);

    await waitFor(() =>
      expect(screen.getByText("This recovery link is invalid or has expired. Request a new password reset email.")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Update password" })).not.toBeInTheDocument();
  });

  it("waits for hash-token recovery sessions to hydrate before rejecting the link", async () => {
    getSession
      .mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockResolvedValueOnce({ data: { session: { user: { id: "user-1" } } }, error: null });
    window.history.replaceState({}, "", "/auth/reset-password#access_token=token123&refresh_token=refresh123&type=recovery");

    render(<ResetPasswordPageClient />);

    expect(await screen.findByRole("button", { name: "Update password" })).toBeInTheDocument();
  });

  it("updates the password, signs out, and redirects back to auth", async () => {
    sessionStorage.setItem("caddie:recovery-intent", "1");
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null });
    updateUser.mockResolvedValue({ error: null });
    signOut.mockResolvedValue({ error: null });

    render(<ResetPasswordPageClient />);

    await screen.findByRole("button", { name: "Update password" });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password-123" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "new-password-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: "new-password-123" }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(replaceMock).toHaveBeenCalledWith("/auth?reset=success");
  });
});
