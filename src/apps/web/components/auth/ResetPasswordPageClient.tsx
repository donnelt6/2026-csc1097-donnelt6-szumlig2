'use client';

import Link from "next/link";
import { useEffect, useState } from "react";
import { mapAuthErrorMessage } from "../../lib/authRecovery";
import { supabase } from "../../lib/supabaseClient";

type RecoveryState = "loading" | "ready" | "invalid" | "success";

export function ResetPasswordPageClient() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recoveryState, setRecoveryState] = useState<RecoveryState>("loading");
  const client = supabase;

  useEffect(() => {
    if (!client) {
      setRecoveryState("invalid");
      setStatus("Supabase is not configured. Add your env vars to enable password recovery.");
      return;
    }

    let mounted = true;

    const finishRecoveryCheck = async () => {
      try {
        const code = new URLSearchParams(window.location.search).get("code");
        if (code) {
          const { error } = await client.auth.exchangeCodeForSession(code);
          if (error) {
            throw error;
          }
        }

        const { data, error } = await client.auth.getSession();
        if (error) {
          throw error;
        }
        if (!mounted) {
          return;
        }
        if (data.session) {
          setRecoveryState("ready");
          return;
        }

        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        if (hashParams.get("type") === "recovery" || hashParams.get("access_token")) {
          window.setTimeout(async () => {
            const { data: delayedData } = await client.auth.getSession();
            if (!mounted) {
              return;
            }
            if (delayedData.session) {
              setRecoveryState("ready");
              return;
            }
            setRecoveryState("invalid");
            setStatus("This recovery link is invalid or has expired. Request a new password reset email.");
          }, 0);
          return;
        }

        setRecoveryState("invalid");
        setStatus("This recovery link is invalid or has expired. Request a new password reset email.");
      } catch (error) {
        console.error("auth.recovery.session_failed", error);
        if (!mounted) {
          return;
        }
        setRecoveryState("invalid");
        setStatus(mapAuthErrorMessage(error, "This recovery link is invalid or has expired. Request a new password reset email."));
      }
    };

    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (!mounted) {
        return;
      }
      if (event === "PASSWORD_RECOVERY" || session) {
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

    if (!client) {
      setStatus("Supabase is not configured. Add your env vars to enable password recovery.");
      return;
    }
    if (password !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }

    setLoading(true);
    const { error } = await client.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      console.error("auth.recovery.update_failed", error);
      setStatus(mapAuthErrorMessage(error, "We could not update your password right now. Try again."));
      return;
    }

    setRecoveryState("success");
    setStatus("Your password has been updated. You can continue into Caddie now.");
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

        {recoveryState === "success" && (
          <>
            <p className="muted">{status}</p>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <Link href="/" className="button">
                Go to Caddie
              </Link>
              <Link href="/auth" className="button button--secondary">
                Back to sign in
              </Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
