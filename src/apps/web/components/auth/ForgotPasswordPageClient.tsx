'use client';

import Link from "next/link";
import { useState } from "react";
import { buildRecoveryRedirectUrl, mapAuthErrorMessage } from "../../lib/authRecovery";
import { supabase } from "../../lib/supabaseClient";

export function ForgotPasswordPageClient() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const requestReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus(null);

    if (!supabase) {
      setStatus("Supabase is not configured. Add your env vars to enable password recovery.");
      return;
    }

    const redirectTo = buildRecoveryRedirectUrl();
    if (!redirectTo) {
      setStatus("Password recovery is not configured yet. Set the recovery redirect URL and try again.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    setLoading(false);

    if (error) {
      console.error("auth.recovery.request_failed", error);
      setStatus(mapAuthErrorMessage(error, "We could not send a reset email right now. Try again."));
      return;
    }

    setStatus("If that email is registered, a password reset link has been sent.");
  };

  return (
    <main className="page grid" style={{ gap: "24px" }}>
      <header className="card">
        <h1 style={{ margin: 0 }}>Reset your password</h1>
        <p className="muted">Enter your account email and we will send you a recovery link.</p>
      </header>
      <form onSubmit={requestReset} className="card grid">
        <label>
          <span className="muted">Email</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </label>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <button className="button" type="submit" disabled={loading}>
            {loading ? "Sending..." : "Send reset email"}
          </button>
          <Link href="/auth" className="button button--secondary" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            Back to sign in
          </Link>
        </div>
        {status && <p className="muted">{status}</p>}
      </form>
    </main>
  );
}
