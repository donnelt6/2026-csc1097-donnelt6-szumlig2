// Tests AuthGate routing behavior with mocked auth state and Next.js navigation.
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "../../components/auth/AuthGate";

let authState = { user: null as null | { id: string; email?: string | null }, loading: false };
const replaceSpy = vi.fn();
let pathname = "/";

vi.mock("../../components/auth/AuthProvider", () => ({
  useAuth: () => authState,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceSpy }),
  usePathname: () => pathname,
}));

describe("AuthGate", () => {
  beforeEach(() => {
    replaceSpy.mockReset();
    pathname = "/";
    authState = { user: null, loading: false };
  });

  it("shows a loading message while auth state is resolving", () => {
    // Expect the loading UI while the session is still being checked.
    authState = { user: null, loading: true };
    render(
      <AuthGate>
        <div>Private</div>
      </AuthGate>
    );
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  });

  it("redirects unauthenticated users to /auth", async () => {
    // Expect a redirect to /auth when no user is present.
    authState = { user: null, loading: false };
    render(
      <AuthGate>
        <div>Private</div>
      </AuthGate>
    );
    expect(screen.getByText("Redirecting to sign in...")).toBeInTheDocument();
    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/auth"));
  });

  it("redirects signed-in users away from the auth route", async () => {
    // Expect signed-in users to be routed off /auth.
    authState = { user: { id: "user-1", email: "user@example.com" }, loading: false };
    pathname = "/auth";
    render(
      <AuthGate>
        <div>Auth</div>
      </AuthGate>
    );
    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/"));
  });

  it("renders children for signed-in users on protected routes", () => {
    // Expect protected content to render when a user exists.
    authState = { user: { id: "user-1", email: "user@example.com" }, loading: false };
    render(
      <AuthGate>
        <div>Private</div>
      </AuthGate>
    );
    expect(screen.getByText("Private")).toBeInTheDocument();
  });
});
