import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthCallbackPageClient } from "../../components/auth/AuthCallbackPageClient";

const replaceMock = vi.fn();
const { exchangeCodeForSession, verifyOtp, signOut } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("../../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      exchangeCodeForSession,
      verifyOtp,
      signOut,
    },
  },
}));

describe("AuthCallbackPageClient", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    exchangeCodeForSession.mockReset();
    verifyOtp.mockReset();
    signOut.mockReset();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/auth/callback");
  });

  it("routes recovery links into reset-password", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    window.history.replaceState({}, "", "/auth/callback?code=abc123&type=recovery");

    render(<AuthCallbackPageClient />);

    await waitFor(() => expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123"));
    expect(sessionStorage.getItem("caddie:recovery-intent")).toBe("1");
    expect(replaceMock).toHaveBeenCalledWith("/auth/reset-password");
  });

  it("routes hash-based recovery links into reset-password", async () => {
    window.history.replaceState({}, "", "/auth/callback#access_token=token123&refresh_token=refresh123&type=recovery");

    render(<AuthCallbackPageClient />);

    await waitFor(() => expect(sessionStorage.getItem("caddie:recovery-intent")).toBe("1"));
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalledWith("/auth/reset-password#access_token=token123&refresh_token=refresh123&type=recovery");
  });

  it("routes confirmation links back to sign-in with a verified flag", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    signOut.mockResolvedValue({ error: null });
    window.history.replaceState({}, "", "/auth/callback?code=verify123&type=signup");

    render(<AuthCallbackPageClient />);

    await waitFor(() => expect(exchangeCodeForSession).toHaveBeenCalledWith("verify123"));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(replaceMock).toHaveBeenCalledWith("/auth?mode=sign-in&verified=1");
  });

  it("verifies token-hash confirmation links before marking the email verified", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    signOut.mockResolvedValue({ error: null });
    window.history.replaceState({}, "", "/auth/callback?token_hash=confirm123&type=signup");

    render(<AuthCallbackPageClient />);

    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "confirm123", type: "signup" }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(replaceMock).toHaveBeenCalledWith("/auth?mode=sign-in&verified=1");
  });
});
