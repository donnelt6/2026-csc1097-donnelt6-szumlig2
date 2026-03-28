'use client';

import Link from "next/link";
import { useMemo, useState, useRef, useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { resolveProfile } from "../../lib/profile";
import { supabase } from "../../lib/supabaseClient";

export function ProfileMenu() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const profile = useMemo(() => resolveProfile(user ?? undefined), [user]);

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
        <ProfileAvatar className="profile-avatar" profile={user ?? undefined} />
      </summary>
      <div className="menu-card">
        <div className="menu-user">
          <p className="menu-label">Signed in as</p>
          <p className="menu-email">{profile.displayName}</p>
          {user.email && profile.displayName !== user.email && <p className="muted">{user.email}</p>}
        </div>
        <div className="menu-divider" role="separator" />
        <Link className="menu-item" href="/settings">
          Settings
        </Link>
        <div className="menu-divider" role="separator" />
        <button className="menu-item menu-signout" type="button" onClick={onSignOut} disabled={loading}>
          {loading ? "Signing out..." : "Sign Out"}
        </button>
      </div>
    </details>
  );
}
