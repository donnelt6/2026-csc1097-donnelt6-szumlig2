import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRecoveryRedirectUrl,
  classifySignupResult,
  getAuthRedirectConfigError,
  hasRecoveryEvidence,
  mapAuthErrorMessage,
  readAuthLinkState,
} from "../lib/authRecovery";

describe("authRecovery helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds an auth callback URL from a configured base URL", () => {
    vi.stubGlobal("window", undefined);

    expect(buildRecoveryRedirectUrl("https://caddie.example.com")).toBe(
      "https://caddie.example.com/auth/reset-password",
    );
  });

  it("falls back to the current window origin when no env base URL is provided", () => {
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:3000" },
    });

    expect(buildRecoveryRedirectUrl("")).toBe("http://localhost:3000/auth/reset-password");
  });

  it("rejects placeholder redirect URLs outside local development", () => {
    vi.stubGlobal("window", undefined);

    expect(buildRecoveryRedirectUrl("https://placeholder.netlify.app")).toBeNull();
    expect(getAuthRedirectConfigError("https://placeholder.netlify.app")).toContain("placeholder");
  });

  it("detects recovery links from Supabase callback params", () => {
    const state = readAuthLinkState({
      search: "?code=abc123&type=recovery",
      hash: "",
    });

    expect(state.intent).toBe("recovery");
    expect(hasRecoveryEvidence(state)).toBe(true);
  });

  it("detects recovery links from Supabase hash params", () => {
    const state = readAuthLinkState({
      search: "",
      hash: "#access_token=token123&refresh_token=refresh123&type=recovery",
    });

    expect(state.intent).toBe("recovery");
    expect(hasRecoveryEvidence(state)).toBe(true);
  });

  it("detects confirmation links only when the link type is explicit", () => {
    expect(
      readAuthLinkState({
        search: "?token_hash=confirm123&type=signup",
        hash: "",
      }).intent,
    ).toBe("confirmation");
    expect(
      readAuthLinkState({
        search: "",
        hash: "#access_token=token123&refresh_token=refresh123",
      }).intent,
    ).toBe("unknown");
  });

  it("classifies a new signup response as verification pending", () => {
    expect(
      classifySignupResult(
        {
          user: {
            email: "ada@example.com",
          },
          session: null,
        },
        "ada@example.com",
      ),
    ).toBe("verification-pending");
  });

  it("classifies ambiguous signup responses as ambiguous", () => {
    expect(
      classifySignupResult(
        {
          user: {
            email: "ada@example.com",
          },
          session: null,
        },
        "grace@example.com",
      ),
    ).toBe("ambiguous");
  });

  it("maps recovery link failures to a safe user message", () => {
    expect(mapAuthErrorMessage({ message: "OTP expired" }, "fallback")).toBe(
      "This link is invalid or has expired. Request a new email and try again.",
    );
  });
});
