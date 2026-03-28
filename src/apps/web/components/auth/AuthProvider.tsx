'use client';

import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  loading: true,
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const supabaseClient = supabase;
    let isMounted = true;
    const syncAuthState = async () => {
      const [{ data: sessionData }, { data: userData }] = await Promise.all([
        supabaseClient.auth.getSession(),
        supabaseClient.auth.getUser(),
      ]);

      if (!isMounted) return;

      const nextSession = sessionData.session ?? null;
      const nextUser = userData.user ?? nextSession?.user ?? null;
      setSession(nextUser && nextSession ? { ...nextSession, user: nextUser } : nextSession);
      setUser(nextUser);
      setLoading(false);
    };

    void syncAuthState();

    const { data: listener } = supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
    });
    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(() => {
    return {
      session,
      user,
      loading,
      refreshUser: async () => {
        if (!supabase) {
          setSession(null);
          setUser(null);
          return;
        }
        const supabaseClient = supabase;

        const [{ data: sessionData }, { data: userData }] = await Promise.all([
          supabaseClient.auth.getSession(),
          supabaseClient.auth.getUser(),
        ]);
        const nextSession = sessionData.session ?? null;
        const nextUser = userData.user ?? nextSession?.user ?? null;
        setSession(nextUser && nextSession ? { ...nextSession, user: nextUser } : nextSession);
        setUser(nextUser);
      },
    };
  }, [session, user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
