import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthPageClient } from "../../components/auth/AuthPageClient";

const replaceMock = vi.fn();
let currentSearch = "";
const { signInWithPassword, signUp } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => "/auth",
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

vi.mock("../../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      signInWithPassword,
      signUp,
    },
  },
}));

describe("AuthPageClient", () => {
  beforeEach(() => {
    currentSearch = "";
    replaceMock.mockReset();
    signInWithPassword.mockReset();
    signUp.mockReset();
  });

  it("renders the sign-in mode by default", () => {
    render(<AuthPageClient />);

    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
  });

  it("renders the create-account mode fields", () => {
    currentSearch = "mode=create-account";
    render(<AuthPageClient />);

    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
  });

  it("does not submit account creation until the required fields are filled", async () => {
    currentSearch = "mode=create-account";
    render(<AuthPageClient />);

    const createButton = screen.getByRole("button", { name: "Create account" });
    expect(createButton).toBeDisabled();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Full name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "password-123");

    expect(createButton).not.toBeDisabled();
  });

  it("shows a verification-pending state after signup", async () => {
    currentSearch = "mode=create-account";
    signUp.mockResolvedValue({
      data: {
        user: {
          email: "ada@example.com",
        },
        session: null,
      },
      error: null,
    });

    render(<AuthPageClient />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Full name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "password-123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(signUp).toHaveBeenCalled());
    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        password: "password-123",
        options: expect.objectContaining({
          emailRedirectTo: expect.stringContaining("/auth/callback"),
          data: expect.objectContaining({
            full_name: "Ada Lovelace",
            avatar_mode: "preset",
            avatar_key: "ava",
            avatar_color: null,
          }),
        }),
      }),
    );
    expect(screen.getByText(/We sent a verification link to/i)).toBeInTheDocument();
  });

  it("keeps duplicate-email signup on the create-account form", async () => {
    currentSearch = "mode=create-account";
    signUp.mockResolvedValue({ data: { user: null, session: null }, error: { message: "User already registered" } });

    render(<AuthPageClient />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Full name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "password-123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(signUp).toHaveBeenCalled());
    expect(screen.getByText("An account with that email already exists.")).toBeInTheDocument();
    expect(screen.queryByText(/We sent a verification link to/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
  });

  it("shows a generic inline error for ambiguous non-error signup responses", async () => {
    currentSearch = "mode=create-account";
    signUp.mockResolvedValue({
      data: {
        user: {
          email: "different@example.com",
        },
        session: null,
      },
      error: null,
    });

    render(<AuthPageClient />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Full name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "password-123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(signUp).toHaveBeenCalled());
    expect(screen.getByText("We could not confirm account creation. Try again or check your email settings.")).toBeInTheDocument();
    expect(screen.queryByText(/We sent a verification link to/i)).not.toBeInTheDocument();
  });
});
