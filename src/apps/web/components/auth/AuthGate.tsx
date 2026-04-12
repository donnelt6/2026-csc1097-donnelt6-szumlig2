'use client';

// AuthGate.tsx: Authentication guard that redirects unauthenticated users to the login page.

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./AuthProvider";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const onAuthRoute = pathname.startsWith("/auth");
  const authSpecialRoute =
    pathname.startsWith("/auth/callback") ||
    pathname.startsWith("/auth/forgot-password") ||
    pathname.startsWith("/auth/reset-password");

  useEffect(() => {
    if (loading) return;
    if (!user && !onAuthRoute) {
      router.replace("/auth");
    }
    if (user && onAuthRoute && !authSpecialRoute) {
      router.replace("/");
    }
  }, [authSpecialRoute, loading, user, onAuthRoute, router]);

  if (loading) {
    return <main className="page" aria-busy="true" aria-live="polite" />;
  }

  if (!user && !onAuthRoute) {
    return (
      <main className="page">
        <p className="muted">Redirecting to sign in...</p>
      </main>
    );
  }

  return <>{children}</>;
}
