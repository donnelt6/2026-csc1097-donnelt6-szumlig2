export type AuthLinkIntent = "recovery" | "confirmation" | "unknown";

export interface AuthLinkState {
  code: string | null;
  tokenHash: string | null;
  type: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  errorDescription: string | null;
  intent: AuthLinkIntent;
}

export interface AuthRedirectConfig {
  url: string | null;
  error: string | null;
}

export type SignupResultStatus = "verification-pending" | "ambiguous";

export function buildAuthCallbackUrl(siteUrl?: string): string | null {
  return resolveAuthRedirectConfig(siteUrl).url;
}

export function buildRecoveryRedirectUrl(siteUrl?: string): string | null {
  return buildAuthCallbackUrl(siteUrl);
}

export function getAuthRedirectConfigError(siteUrl?: string): string | null {
  return resolveAuthRedirectConfig(siteUrl).error;
}

export function readAuthLinkState(locationLike?: { search?: string; hash?: string }): AuthLinkState {
  const currentLocation =
    locationLike ??
    (typeof window !== "undefined"
      ? { search: window.location.search, hash: window.location.hash }
      : undefined);

  const searchParams = new URLSearchParams(currentLocation?.search ?? "");
  const hashParams = new URLSearchParams((currentLocation?.hash ?? "").replace(/^#/, ""));

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash") ?? hashParams.get("token_hash");
  const searchType = searchParams.get("type");
  const hashType = hashParams.get("type");
  const type = searchType ?? hashType;
  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");
  const errorDescription = searchParams.get("error_description") ?? hashParams.get("error_description");

  return {
    code,
    tokenHash,
    type,
    accessToken,
    refreshToken,
    errorDescription,
    intent: inferAuthLinkIntent({ code, tokenHash, type, accessToken }),
  };
}

export function hasRecoveryEvidence(state: AuthLinkState): boolean {
  return state.intent === "recovery" && Boolean(state.code || state.tokenHash || state.accessToken);
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
    return "This link is invalid or has expired. Request a new email and try again.";
  }
  if (normalized.includes("password")) {
    return "The password does not meet the required format.";
  }
  if (normalized.includes("email")) {
    return "We could not send that email right now. Try again in a moment.";
  }
  return fallback;
}

export function shouldShowVerificationPending(result: {
  user: {
    email?: string | null;
    identities?: Array<unknown> | null;
  } | null;
  session: unknown;
} | null | undefined, requestedEmail: string): boolean {
  return classifySignupResult(result, requestedEmail) === "verification-pending";
}

export function classifySignupResult(result: {
  user: {
    email?: string | null;
  } | null;
  session: unknown;
} | null | undefined, requestedEmail: string): SignupResultStatus {
  if (!result) {
    return "ambiguous";
  }

  const normalizedEmail = requestedEmail.trim().toLowerCase();
  const userEmail = result.user?.email?.trim().toLowerCase() ?? "";

  if (!normalizedEmail || !userEmail || userEmail !== normalizedEmail) {
    return "ambiguous";
  }
  if (result.session) {
    return "ambiguous";
  }

  return "verification-pending";
}

function inferAuthLinkIntent(state: {
  code: string | null;
  tokenHash: string | null;
  type: string | null;
  accessToken: string | null;
}): AuthLinkIntent {
  if (state.type === "recovery") {
    return "recovery";
  }
  if (
    state.type === "signup" ||
    state.type === "invite" ||
    state.type === "magiclink" ||
    state.type === "email_change" ||
    state.type === "email"
  ) {
    return "confirmation";
  }
  return "unknown";
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function resolveAuthRedirectConfig(siteUrl?: string): AuthRedirectConfig {
  const currentOrigin = getWindowOrigin();
  if (currentOrigin && isLocalOrigin(currentOrigin)) {
    return {
      url: new URL("/auth/callback", currentOrigin).toString(),
      error: null,
    };
  }

  const configuredBaseUrl = siteUrl?.trim() || process.env.NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL?.trim() || "";
  if (!configuredBaseUrl) {
    return {
      url: null,
      error: "Email links are not configured for this environment. Set NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL to your deployed site URL.",
    };
  }

  try {
    const baseUrl = new URL(withTrailingSlash(configuredBaseUrl));
    if (looksLikePlaceholderHost(baseUrl.hostname)) {
      return {
        url: null,
        error: "Email links are still pointing at a placeholder site URL. Set NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL to the real deployed site.",
      };
    }

    return {
      url: new URL("/auth/callback", baseUrl).toString(),
      error: null,
    };
  } catch {
    return {
      url: null,
      error: "Email links are misconfigured. Fix NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL and try again.",
    };
  }
}

function getWindowOrigin(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.location.origin;
}

function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function looksLikePlaceholderHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "placeholder.netlify.app" || normalized.startsWith("placeholder.");
}
