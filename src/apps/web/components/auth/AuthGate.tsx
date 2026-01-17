'use client';

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./AuthProvider";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const onAuthRoute = pathname.startsWith("/auth");

  useEffect(() => {
    if (loading) return;
    if (!user && !onAuthRoute) {
      router.replace("/auth");
    }
    if (user && onAuthRoute) {
      router.replace("/");
    }
  }, [loading, user, onAuthRoute, router]);

  if (loading) {
    return (
      <main className="page">
        <p className="muted">Checking your session...</p>
      </main>
    );
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
