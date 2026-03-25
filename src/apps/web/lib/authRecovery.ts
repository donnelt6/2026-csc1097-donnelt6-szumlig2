export function buildRecoveryRedirectUrl(siteUrl?: string): string | null {
  const baseUrl = siteUrl?.trim() || process.env.NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL?.trim() || "";
  if (!baseUrl) {
    if (typeof window === "undefined") {
      return null;
    }
    return new URL("/auth/reset-password", window.location.origin).toString();
  }

  try {
    return new URL("/auth/reset-password", withTrailingSlash(baseUrl)).toString();
  } catch {
    return null;
  }
}

export function mapAuthErrorMessage(error: unknown, fallback: string): string {
  const message = typeof error === "object" && error && "message" in error ? String(error.message ?? "") : "";
  const normalized = message.toLowerCase();

  if (!normalized) {
    return fallback;
  }
  if (normalized.includes("invalid login credentials")) {
    return "The email or password is incorrect.";
  }
  if (normalized.includes("user already registered")) {
    return "An account with that email already exists.";
  }
  if (normalized.includes("expired") || normalized.includes("invalid") || normalized.includes("otp")) {
    return "This recovery link is invalid or has expired. Request a new password reset email.";
  }
  if (normalized.includes("password")) {
    return "The password does not meet the required format.";
  }
  if (normalized.includes("email")) {
    return "We could not send that email right now. Try again in a moment.";
  }
  return fallback;
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
