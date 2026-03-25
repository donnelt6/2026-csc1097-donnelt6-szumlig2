import { describe, expect, it, vi } from "vitest";
import { buildRecoveryRedirectUrl, mapAuthErrorMessage } from "../lib/authRecovery";

describe("authRecovery helpers", () => {
  it("builds a reset password URL from a configured base URL", () => {
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

  it("maps recovery link failures to a safe user message", () => {
    expect(mapAuthErrorMessage({ message: "OTP expired" }, "fallback")).toBe(
      "This recovery link is invalid or has expired. Request a new password reset email.",
    );
  });
});
