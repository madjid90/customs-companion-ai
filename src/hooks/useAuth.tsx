import React, { useState, useEffect, useMemo, createContext, useContext, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { User, Session } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAdmin: boolean;
  profile: Profile | null;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

interface Profile {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let initialSessionHandled = false;

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          // Defer DB calls to avoid Supabase auth deadlock
          queueMicrotask(async () => {
            await fetchUserData(session.user.id);
            setIsLoading(false);
          });
        } else {
          setIsAdmin(false);
          setProfile(null);
          setIsLoading(false);
        }
      }
    );

    // THEN check initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (initialSessionHandled) return;
      initialSessionHandled = true;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchUserData(session.user.id);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchUserData(userId: string) {
    try {
      // Run both queries in parallel for speed
      const [roleResult, profileResult] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
        supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
      ]);

      if (roleResult.error) {
        console.warn("[Auth] Role check failed:", roleResult.error.message);
      }
      setIsAdmin(roleResult.data?.role === "admin");
      setProfile(profileResult.data);
    } catch (error) {
      console.error("[Auth] fetchUserData error:", error);
      setIsAdmin(false);
      setProfile(null);
    }
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error: error as Error | null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setIsAdmin(false);
    setProfile(null);
  }

  // Memoize context value to prevent cascading re-renders on public pages
  const contextValue = useMemo<AuthContextType>(
    () => ({
      user,
      session,
      isLoading,
      isAdmin,
      profile,
      signIn,
      signOut,
    }),
    [user, session, isLoading, isAdmin, profile]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
