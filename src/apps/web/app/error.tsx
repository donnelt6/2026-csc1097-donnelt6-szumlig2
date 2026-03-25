'use client';

import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("ui.route_error", error);

  return (
    <main className="page">
      <div className="card grid" style={{ gap: "16px" }}>
        <h1 style={{ margin: 0 }}>Something went wrong</h1>
        <p className="muted">This page hit an unexpected error. Retry the route or return to a safe screen.</p>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <button className="button" type="button" onClick={() => reset()}>
            Retry
          </button>
          <Link href="/" className="button button--secondary">
            Home
          </Link>
          <Link href="/auth" className="button button--secondary">
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
