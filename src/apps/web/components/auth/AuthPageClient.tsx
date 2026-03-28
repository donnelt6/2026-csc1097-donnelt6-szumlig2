'use client';

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  buildAuthCallbackUrl,
  classifySignupResult,
  getAuthRedirectConfigError,
  mapAuthErrorMessage,
} from "../../lib/authRecovery";
import {
  buildProfileFormValue,
  isValidProfileMetadata,
  toProfileMetadata,
} from "../../lib/profile";
import { supabase } from "../../lib/supabaseClient";
import { ProfilePicker } from "../profile/ProfilePicker";

type AuthMode = "sign-in" | "create-account";

export function AuthPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const mode = searchParams.get("mode") === "create-account" ? "create-account" : "sign-in";
  const verified = searchParams.get("verified") === "1";
  const resetSuccess = searchParams.get("reset") === "success";

  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [profileForm, setProfileForm] = useState(() => buildProfileFormValue());
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);

  const readyForSignup = useMemo(() => {
    return isValidProfileMetadata({
      ...profileForm,
      full_name: profileForm.full_name.trim(),
    }) && Boolean(signUpEmail.trim()) && Boolean(signUpPassword.trim());
  }, [profileForm, signUpEmail, signUpPassword]);

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
  const supabaseClient = supabase;

  const setMode = (nextMode: AuthMode) => {
    const params = new URLSearchParams();
    if (nextMode === "create-account") {
      params.set("mode", nextMode);
    }
    router.replace(params.toString() ? `${pathname}?${params}` : pathname);
    setStatus(null);
  };

  const onSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus(null);
    setLoading(true);
    const { error } = await supabaseClient.auth.signInWithPassword({
      email: signInEmail,
      password: signInPassword,
    });
    setLoading(false);

    if (error) {
      setStatus(mapAuthErrorMessage(error, "Sign-in failed. Check your details and try again."));
      return;
    }

    setStatus("Signed in. Redirecting...");
  };

  const onCreateAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus(null);

    const redirectTo = buildAuthCallbackUrl();
    if (!redirectTo) {
      setStatus(getAuthRedirectConfigError() ?? "Email verification is not configured yet. Set the auth callback URL and try again.");
      return;
    }

    const metadata = toProfileMetadata(profileForm);
    if (!isValidProfileMetadata(metadata)) {
      setStatus("Add your full name and choose a profile appearance before creating an account.");
      return;
    }

    setLoading(true);
    const { data, error } = await supabaseClient.auth.signUp({
      email: signUpEmail,
      password: signUpPassword,
      options: {
        emailRedirectTo: redirectTo,
        data: metadata,
      },
    });
    setLoading(false);

    if (error) {
      setStatus(mapAuthErrorMessage(error, "Account creation failed. Try again."));
      return;
    }

    switch (classifySignupResult(data, signUpEmail)) {
      case "verification-pending":
        setVerificationEmail(signUpEmail);
        setSignUpPassword("");
        return;
      case "ambiguous":
      default:
        setStatus("We could not confirm account creation. Try again or check your email settings.");
        return;
    }
  };

  return (
    <main className="page grid" style={{ gap: "24px" }}>
      <header className="card">
        <h1 style={{ margin: 0 }}>Caddie</h1>
        <p className="muted">
          {mode === "create-account" ? "Create your account and profile in one step." : "Sign in to access your hubs."}
        </p>
      </header>

      {(verified || resetSuccess) && !verificationEmail && (
        <section className="card">
          {verified && <p className="muted">Your email has been confirmed. Sign in to continue.</p>}
          {resetSuccess && <p className="muted">Your password has been updated. Sign in with your new password.</p>}
        </section>
      )}

      {verificationEmail ? (
        <section className="card grid">
          <h2 style={{ margin: 0 }}>Check your email</h2>
          <p className="muted">
            We sent a verification link to <strong>{verificationEmail}</strong>. Confirm your email, then return to sign in.
          </p>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <button className="button" type="button" onClick={() => { setVerificationEmail(null); setMode("sign-in"); }}>
              Back to sign in
            </button>
            <button className="button button--secondary" type="button" onClick={() => setVerificationEmail(null)}>
              Edit details
            </button>
          </div>
        </section>
      ) : mode === "sign-in" ? (
        <form onSubmit={onSignIn} className="card grid">
          <label>
            <span className="muted">Email</span>
            <input value={signInEmail} onChange={(event) => setSignInEmail(event.target.value)} type="email" required />
          </label>
          <label>
            <span className="muted">Password</span>
            <input value={signInPassword} onChange={(event) => setSignInPassword(event.target.value)} type="password" required />
          </label>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <button className="button" type="submit" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
            <button className="button button--secondary" type="button" onClick={() => setMode("create-account")} disabled={loading}>
              Create account
            </button>
          </div>
          <Link href="/auth/forgot-password" className="muted">
            Forgot password?
          </Link>
          {status && <p className="muted">{status}</p>}
        </form>
      ) : (
        <form onSubmit={onCreateAccount} className="card grid">
          <label>
            <span className="muted">Full name</span>
            <input
              value={profileForm.full_name}
              onChange={(event) => setProfileForm((current) => ({ ...current, full_name: event.target.value }))}
              type="text"
              required
            />
          </label>
          <label>
            <span className="muted">Email</span>
            <input value={signUpEmail} onChange={(event) => setSignUpEmail(event.target.value)} type="email" required />
          </label>
          <label>
            <span className="muted">Password</span>
            <input value={signUpPassword} onChange={(event) => setSignUpPassword(event.target.value)} type="password" minLength={8} required />
          </label>
          <ProfilePicker value={profileForm} previewEmail={signUpEmail} onChange={setProfileForm} />
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <button className="button" type="submit" disabled={loading || !readyForSignup}>
              {loading ? "Creating..." : "Create account"}
            </button>
            <button className="button button--secondary" type="button" onClick={() => setMode("sign-in")} disabled={loading}>
              Already have an account?
            </button>
          </div>
          {status && <p className="muted">{status}</p>}
        </form>
      )}
    </main>
  );
}
