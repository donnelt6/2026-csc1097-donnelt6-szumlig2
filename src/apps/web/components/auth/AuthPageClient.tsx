'use client';

import Link from "next/link";
import { useState } from "react";
import { mapAuthErrorMessage } from "../../lib/authRecovery";
import { supabase } from "../../lib/supabaseClient";

export function AuthPageClient() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!supabase) {
    return (
      <main className="page">
        <div className="card">
          <h1 style={{ marginTop: 0 }}>Caddie</h1>
          <p className="muted">Supabase is not configured. Add your env vars to enable auth.</p>
        </div>
      </main>
    );
  }

  const client = supabase;
  const resetStatus = () => setStatus(null);

  const onSignIn = async (evt: React.FormEvent) => {
    evt.preventDefault();
    resetStatus();
    setLoading(true);
    const { error } = await client.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setStatus(mapAuthErrorMessage(error, "Sign-in failed. Check your details and try again."));
      return;
    }
    setStatus("Signed in. Redirecting...");
  };

  const onSignUp = async () => {
    resetStatus();
    setLoading(true);
    const { error } = await client.auth.signUp({ email, password });
    setLoading(false);
    if (error) {
      setStatus(mapAuthErrorMessage(error, "Account creation failed. Try again."));
      return;
    }
    setStatus("Check your email to confirm your account, then sign in.");
  };

  return (
    <main className="page grid" style={{ gap: "24px" }}>
      <header className="card">
        <h1 style={{ margin: 0 }}>Caddie</h1>
        <p className="muted">Sign in to access your hubs.</p>
      </header>
      <form onSubmit={onSignIn} className="card grid">
        <label>
          <span className="muted">Email</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </label>
        <label>
          <span className="muted">Password</span>
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
        </label>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <button className="button" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
          <button className="button" type="button" onClick={onSignUp} disabled={loading}>
            Create account
          </button>
        </div>
        <Link href="/auth/forgot-password" className="muted">
          Forgot password?
        </Link>
        {status && <p className="muted">{status}</p>}
      </form>
    </main>
  );
}
