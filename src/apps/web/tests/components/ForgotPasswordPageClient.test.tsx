import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordPageClient } from "../../components/auth/ForgotPasswordPageClient";

const { resetPasswordForEmail } = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
}));

vi.mock("../../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail,
    },
  },
}));

describe("ForgotPasswordPageClient", () => {
  beforeEach(() => {
    resetPasswordForEmail.mockReset();
  });

  it("requests a reset email and shows a success state", async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null });

    render(<ForgotPasswordPageClient />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset email" }));

    await waitFor(() => {
      expect(resetPasswordForEmail).toHaveBeenCalledWith(
        "user@example.com",
        expect.objectContaining({
          redirectTo: expect.stringContaining("/auth/reset-password"),
        }),
      );
    });

    expect(screen.getByText("If that email is registered, a password reset link has been sent.")).toBeInTheDocument();
  });

  it("shows a safe error when the recovery request fails", async () => {
    resetPasswordForEmail.mockResolvedValue({ error: { message: "Email rate limit exceeded" } });

    render(<ForgotPasswordPageClient />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset email" }));

    await waitFor(() =>
      expect(screen.getByText("We could not send that email right now. Try again in a moment.")).toBeInTheDocument(),
    );
  });
});
