'use client';

import { useMemo, useState, useRef, useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../../lib/supabaseClient";

export function ProfileMenu() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const displayName = useMemo(() => {
    if (!user) return "Profile";
    return user.email ?? user.user_metadata?.full_name ?? "Profile";
  }, [user]);

  const initial = displayName.trim()[0]?.toUpperCase() ?? "U";

  const onSignOut = async () => {
    if (!supabase) return;
    setLoading(true);
    await supabase.auth.signOut();
    setLoading(false);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (detailsRef.current && !detailsRef.current.contains(event.target as Node)) {
        detailsRef.current.open = false;
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) return null;

  return (
    <details className="profile-menu" ref={detailsRef}>
      <summary className="profile-trigger" aria-label="Open profile menu">
        <span className="profile-avatar" aria-hidden="true">
          {initial}
        </span>
      </summary>
      <div className="menu-card">
        <div className="menu-user">
          <p className="menu-label">Signed in as</p>
          <p className="menu-email">{displayName}</p>
        </div>
        <div className="menu-divider" role="separator" />
        <a className="menu-item" href="/settings">
          Settings
        </a>
        <div className="menu-divider" role="separator" />
        <button className="menu-item menu-signout" type="button" onClick={onSignOut} disabled={loading}>
          {loading ? "Signing out..." : "Sign Out"}
        </button>
      </div>
    </details>
  );
}
