'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { hasRecoveryEvidence, mapAuthErrorMessage, readAuthLinkState } from "../../lib/authRecovery";
import { supabase } from "../../lib/supabaseClient";

type RecoveryState = "loading" | "ready" | "invalid";

const RECOVERY_SESSION_KEY = "caddie:recovery-intent";

export function ResetPasswordPageClient() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recoveryState, setRecoveryState] = useState<RecoveryState>("loading");

  useEffect(() => {
    if (!supabase) {
      setRecoveryState("invalid");
      setStatus("Supabase is not configured. Add your env vars to enable password recovery.");
      return;
    }
    const supabaseClient = supabase;

    let mounted = true;
    let recoveryReady = false;

    const finishRecoveryCheck = async () => {
      const linkState = readAuthLinkState();
      const storedRecoveryIntent = sessionStorage.getItem(RECOVERY_SESSION_KEY) === "1";
      const recoveryEvidence = hasRecoveryEvidence(linkState);

      if (linkState.errorDescription) {
        setRecoveryState("invalid");
        setStatus(linkState.errorDescription);
        return;
      }
      if (!recoveryEvidence && !storedRecoveryIntent) {
        setRecoveryState("invalid");
        setStatus("This recovery link is invalid or has expired. Request a new password reset email.");
        return;
      }

      try {
        if (linkState.code && linkState.intent === "recovery") {
          const { error } = await supabaseClient.auth.exchangeCodeForSession(linkState.code);
          if (error) {
            throw error;
          }
        } else if (linkState.tokenHash && linkState.intent === "recovery") {
          const { error } = await supabaseClient.auth.verifyOtp({
            token_hash: linkState.tokenHash,
            type: "recovery",
          });
          if (error) {
            throw error;
          }
        } else if (linkState.accessToken && linkState.intent === "recovery") {
          const session = await waitForRecoverySession();
          if (!mounted || recoveryReady) {
            return;
          }
          if (!session) {
            setRecoveryState("invalid");
            setStatus("This recovery link is invalid or has expired. Request a new password reset email.");
            return;
          }

          sessionStorage.setItem(RECOVERY_SESSION_KEY, "1");
          recoveryReady = true;
          setRecoveryState("ready");
          return;
        }

        const { data, error } = await supabaseClient.auth.getSession();
        if (error) {
          throw error;
        }

        if (!mounted || recoveryReady) {
          return;
        }

        if (!data.session) {
          setRecoveryState("invalid");
          setStatus("This recovery link is invalid or has expired. Request a new password reset email.");
          return;
        }

        sessionStorage.setItem(RECOVERY_SESSION_KEY, "1");
        recoveryReady = true;
        setRecoveryState("ready");
      } catch (cause) {
        console.error("auth.recovery.session_failed", cause);
        if (!mounted) {
          return;
        }
        setRecoveryState("invalid");
        setStatus(
          mapAuthErrorMessage(cause, "This recovery link is invalid or has expired. Request a new password reset email."),
        );
      }
    };

    const { data: listener } = supabaseClient.auth.onAuthStateChange((event, session) => {
      if (!mounted) {
        return;
      }
      if (event === "PASSWORD_RECOVERY" && session) {
        sessionStorage.setItem(RECOVERY_SESSION_KEY, "1");
        recoveryReady = true;
        setRecoveryState("ready");
        setStatus(null);
      }
    });

    void finishRecoveryCheck();

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus(null);

    if (!supabase) {
      setStatus("Supabase is not configured. Add your env vars to enable password recovery.");
      return;
    }
    const supabaseClient = supabase;
    if (password !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }

    setLoading(true);
    const { error } = await supabaseClient.auth.updateUser({ password });

    if (error) {
      setLoading(false);
      console.error("auth.recovery.update_failed", error);
      setStatus(mapAuthErrorMessage(error, "We could not update your password right now. Try again."));
      return;
    }

    sessionStorage.removeItem(RECOVERY_SESSION_KEY);
    await supabaseClient.auth.signOut();
    setLoading(false);
    router.replace("/auth?reset=success");
  };

  return (
    <main className="page grid" style={{ gap: "24px" }}>
      <header className="card">
        <h1 style={{ margin: 0 }}>Choose a new password</h1>
        <p className="muted">Complete your password recovery here.</p>
      </header>
      <section className="card grid">
        {recoveryState === "loading" && <p className="muted">Checking your recovery link...</p>}

        {recoveryState === "invalid" && (
          <>
            <p className="muted">{status}</p>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <Link href="/auth/forgot-password" className="button">
                Request a new link
              </Link>
              <Link href="/auth" className="button button--secondary">
                Back to sign in
              </Link>
            </div>
          </>
        )}

        {recoveryState === "ready" && (
          <form onSubmit={submitPassword} className="grid" style={{ gap: "16px" }}>
            <label>
              <span className="muted">New password</span>
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={8} required />
            </label>
            <label>
              <span className="muted">Confirm password</span>
              <input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" minLength={8} required />
            </label>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <button className="button" type="submit" disabled={loading}>
                {loading ? "Updating..." : "Update password"}
              </button>
              <Link href="/auth" className="button button--secondary">
                Cancel
              </Link>
            </div>
            {status && <p className="muted">{status}</p>}
          </form>
        )}
      </section>
    </main>
  );
}

async function waitForRecoverySession() {
  if (!supabase) {
    return null;
  }
  const supabaseClient = supabase;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
      throw error;
    }
    if (data.session) {
      return data.session;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  }

  return null;
}
