'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { mapAuthErrorMessage, readAuthLinkState } from "../../lib/authRecovery";
import { supabase } from "../../lib/supabaseClient";

const RECOVERY_SESSION_KEY = "caddie:recovery-intent";

export function AuthCallbackPageClient() {
  const router = useRouter();
  const [status, setStatus] = useState("Finishing sign-in link...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setError("Supabase is not configured. Add your env vars to enable email auth.");
      return;
    }
    const supabaseClient = supabase;

    let cancelled = false;

    const finishEmailLink = async () => {
      const state = readAuthLinkState();
      if (state.errorDescription) {
        setError(state.errorDescription);
        return;
      }

      try {
        if (state.intent === "recovery") {
          setStatus("Opening password recovery...");
          if (state.code) {
            const { error: exchangeError } = await supabaseClient.auth.exchangeCodeForSession(state.code);
            if (exchangeError) {
              throw exchangeError;
            }
          } else if (state.tokenHash && state.type === "recovery") {
            const { error: verifyError } = await supabaseClient.auth.verifyOtp({
              token_hash: state.tokenHash,
              type: "recovery",
            });
            if (verifyError) {
              throw verifyError;
            }
          }

          if (cancelled) {
            return;
          }

          sessionStorage.setItem(RECOVERY_SESSION_KEY, "1");
          const nextUrl = new URL("/auth/reset-password", window.location.origin);
          if (window.location.hash) {
            nextUrl.hash = window.location.hash.replace(/^#/, "");
          }
          router.replace(nextUrl.toString().replace(window.location.origin, ""));
          return;
        }

        if (state.intent === "confirmation") {
          setStatus("Confirming your email...");
          if (state.code) {
            const { error: exchangeError } = await supabaseClient.auth.exchangeCodeForSession(state.code);
            if (exchangeError) {
              throw exchangeError;
            }
          } else if (state.tokenHash && isSupportedConfirmationType(state.type)) {
            const { error: verifyError } = await supabaseClient.auth.verifyOtp({
              token_hash: state.tokenHash,
              type: state.type,
            });
            if (verifyError) {
              throw verifyError;
            }
          } else {
            throw new Error("Unsupported confirmation link");
          }

          await supabaseClient.auth.signOut();
          if (!cancelled) {
            router.replace("/auth?mode=sign-in&verified=1");
          }
          return;
        }

        setError("This email link is invalid or has expired. Request a new one and try again.");
      } catch (cause) {
        console.error("auth.callback.failed", cause);
        if (!cancelled) {
          setError(
            mapAuthErrorMessage(cause, "This email link is invalid or has expired. Request a new one and try again."),
          );
        }
      }
    };

    void finishEmailLink();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="page grid" style={{ gap: "24px" }}>
      <header className="card">
        <h1 style={{ margin: 0 }}>Caddie</h1>
        <p className="muted">{error ?? status}</p>
      </header>
      {error && (
        <section className="card" style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <Link href="/auth" className="button">
            Back to sign in
          </Link>
          <Link href="/auth/forgot-password" className="button button--secondary">
            Reset password
          </Link>
        </section>
      )}
    </main>
  );
}

function isSupportedConfirmationType(value: string | null): value is "signup" | "invite" | "magiclink" | "email_change" | "email" {
  return value === "signup" || value === "invite" || value === "magiclink" || value === "email_change" || value === "email";
}
