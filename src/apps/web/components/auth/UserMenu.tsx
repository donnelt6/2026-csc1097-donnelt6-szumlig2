'use client';

// UserMenu.tsx: User avatar dropdown menu with profile and sign-out options.

import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "./AuthProvider";

export function UserMenu() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  if (!user) return null;

  const onSignOut = async () => {
    if (!supabase) return;
    setLoading(true);
    await supabase.auth.signOut();
    setLoading(false);
  };

  return (
    <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
      <div>
        <p style={{ margin: 0, fontWeight: 600 }}>{user.email ?? "Signed in"}</p>
        <p className="muted" style={{ margin: 0 }}>
          Session active
        </p>
      </div>
      <button className="button" onClick={onSignOut} disabled={loading}>
        {loading ? "Signing out..." : "Sign out"}
      </button>
    </div>
  );
}
