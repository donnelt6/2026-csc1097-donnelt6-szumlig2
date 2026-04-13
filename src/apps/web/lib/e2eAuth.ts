// e2eAuth.ts: In-browser Supabase auth shim for E2E tests without a live project.

import type { Session, User } from "@supabase/supabase-js";

const E2E_AUTH_STORAGE_KEY = "caddie:e2e-auth-session";
const DEFAULT_E2E_EMAIL = "e2e@example.com";
const DEFAULT_E2E_PASSWORD = "password123";

type AuthStateChangeEvent = "SIGNED_IN" | "SIGNED_OUT" | "PASSWORD_RECOVERY";
type AuthStateChangeCallback = (event: AuthStateChangeEvent, session: Session | null) => void;

interface SupabaseLikeAuthClient {
  getSession: () => Promise<{ data: { session: Session | null }; error: null }>;
  getUser: () => Promise<{ data: { user: User | null }; error: null }>;
  onAuthStateChange: (callback: AuthStateChangeCallback) => {
    data: {
      subscription: {
        unsubscribe: () => void;
      };
    };
  };
  signInWithPassword: (credentials: {
    email: string;
    password: string;
  }) => Promise<{ data: { user: User | null; session: Session | null }; error: { message: string } | null }>;
  signOut: () => Promise<{ error: null }>;
  signUp: (credentials: {
    email: string;
    password: string;
    options?: { data?: object };
  }) => Promise<{
    data: { user: User | null; session: Session | null };
    error: { message: string } | null;
  }>;
  resetPasswordForEmail: (
    email: string,
    options?: { redirectTo?: string },
  ) => Promise<{ data: object; error: { message: string } | null }>;
  exchangeCodeForSession: (
    code: string,
  ) => Promise<{ data: { session: Session | null; user: User | null }; error: { message: string } | null }>;
  verifyOtp: (payload: {
    token_hash: string;
    type: "recovery" | "signup" | "invite" | "magiclink" | "email_change" | "email";
  }) => Promise<{ data: { session: Session | null; user: User | null }; error: { message: string } | null }>;
  updateUser: (attributes: {
    password?: string;
    data?: object;
  }) => Promise<{ data: { user: User | null }; error: { message: string } | null }>;
}

interface SupabaseLikeClient {
  auth: SupabaseLikeAuthClient;
}

declare global {
  interface Window {
    __caddieE2EAuth?:
      | {
          email?: string;
          password?: string;
          user?: Partial<User> | null;
        }
      | undefined;
  }
}

const listeners = new Set<AuthStateChangeCallback>();

function readStoredSession(): Session | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(E2E_AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as Session;
  } catch {
    window.localStorage.removeItem(E2E_AUTH_STORAGE_KEY);
    return null;
  }
}

function writeStoredSession(session: Session | null) {
  if (typeof window === "undefined") {
    return;
  }
  if (session) {
    window.localStorage.setItem(E2E_AUTH_STORAGE_KEY, JSON.stringify(session));
  } else {
    window.localStorage.removeItem(E2E_AUTH_STORAGE_KEY);
  }
}

function buildE2EUser(email: string, overrides?: Partial<User> | null): User {
  return {
    id: overrides?.id ?? "e2e-user-1",
    app_metadata: overrides?.app_metadata ?? {},
    user_metadata: overrides?.user_metadata ?? {
      full_name: "E2E User",
      avatar_mode: "preset",
      avatar_key: "glass-01",
      avatar_color: "blue",
    },
    aud: overrides?.aud ?? "authenticated",
    confirmation_sent_at: overrides?.confirmation_sent_at ?? null,
    confirmed_at: overrides?.confirmed_at ?? "2026-04-10T12:00:00Z",
    created_at: overrides?.created_at ?? "2026-04-10T12:00:00Z",
    email,
    email_confirmed_at: overrides?.email_confirmed_at ?? "2026-04-10T12:00:00Z",
    factors: overrides?.factors ?? [],
    identities: overrides?.identities ?? [],
    invited_at: overrides?.invited_at ?? null,
    is_anonymous: overrides?.is_anonymous ?? false,
    last_sign_in_at: overrides?.last_sign_in_at ?? "2026-04-10T12:00:00Z",
    phone: overrides?.phone ?? "",
    role: overrides?.role ?? "authenticated",
    updated_at: overrides?.updated_at ?? "2026-04-10T12:00:00Z",
  } as User;
}

function buildE2ESession(email: string, overrides?: Partial<User> | null): Session {
  const user = buildE2EUser(email, overrides);
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: "e2e-access-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: "e2e-refresh-token",
    user,
  } as Session;
}

function readConfiguredAuth() {
  const override = typeof window !== "undefined" ? window.__caddieE2EAuth : undefined;
  return {
    email: override?.email ?? DEFAULT_E2E_EMAIL,
    password: override?.password ?? DEFAULT_E2E_PASSWORD,
    user: override?.user ?? null,
  };
}

function emitAuthState(event: AuthStateChangeEvent, session: Session | null) {
  for (const listener of listeners) {
    listener(event, session);
  }
}

function writeUserIntoStoredSession(nextUser: User) {
  const currentSession = readStoredSession();
  if (!currentSession) {
    return { user: nextUser };
  }
  const nextSession = { ...currentSession, user: nextUser } as Session;
  writeStoredSession(nextSession);
  emitAuthState("SIGNED_IN", nextSession);
  return { user: nextUser };
}

export function createE2ESupabaseClient(): SupabaseLikeClient {
  return {
    auth: {
      async getSession() {
        return { data: { session: readStoredSession() }, error: null };
      },
      async getUser() {
        return { data: { user: readStoredSession()?.user ?? null }, error: null };
      },
      onAuthStateChange(callback: AuthStateChangeCallback) {
        listeners.add(callback);
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                listeners.delete(callback);
              },
            },
          },
        };
      },
      async signInWithPassword(credentials) {
        const configured = readConfiguredAuth();
        if (
          credentials.email.trim().toLowerCase() !== configured.email.trim().toLowerCase() ||
          credentials.password !== configured.password
        ) {
          return {
            data: { user: null, session: null },
            error: { message: "Invalid login credentials" },
          };
        }
        const session = buildE2ESession(configured.email, configured.user);
        writeStoredSession(session);
        emitAuthState("SIGNED_IN", session);
        return { data: { user: session.user, session }, error: null };
      },
      async signOut() {
        writeStoredSession(null);
        emitAuthState("SIGNED_OUT", null);
        return { error: null };
      },
      async signUp(credentials) {
        const email = credentials.email.trim().toLowerCase();
        const user = buildE2EUser(email, {
          user_metadata: credentials.options?.data ?? {
            full_name: "E2E User",
          },
        });
        return {
          data: { user, session: null },
          error: null,
        };
      },
      async resetPasswordForEmail(email, options) {
        void email;
        void options;
        return { data: {}, error: null };
      },
      async exchangeCodeForSession(code) {
        void code;
        const configured = readConfiguredAuth();
        const session = buildE2ESession(configured.email, configured.user);
        writeStoredSession(session);
        emitAuthState("SIGNED_IN", session);
        return { data: { session, user: session.user }, error: null };
      },
      async verifyOtp(payload) {
        const configured = readConfiguredAuth();
        const session = buildE2ESession(configured.email, configured.user);
        writeStoredSession(session);
        emitAuthState(payload.type === "recovery" ? "PASSWORD_RECOVERY" : "SIGNED_IN", session);
        return { data: { session, user: session.user }, error: null };
      },
      async updateUser(attributes) {
        const currentSession = readStoredSession();
        if (!currentSession) {
          return { data: { user: null }, error: { message: "No active session" } };
        }
        const nextUser = {
          ...currentSession.user,
          user_metadata: attributes.data
            ? { ...currentSession.user.user_metadata, ...attributes.data }
            : currentSession.user.user_metadata,
          updated_at: "2026-04-10T12:05:00Z",
        } as User;
        if (attributes.password && attributes.password.length < 8) {
          return { data: { user: null }, error: { message: "Password should be at least 8 characters." } };
        }
        return { data: writeUserIntoStoredSession(nextUser), error: null };
      },
    },
  };
}
