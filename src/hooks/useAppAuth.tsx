import React, { useState, useEffect, useMemo, createContext, useContext, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Session } from "@supabase/supabase-js";

export interface AppUser {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  max_invites: number | null;
}

interface AppAuthContextType {
  appUser: AppUser | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signOut: () => Promise<void>;
  setSessionFromOtp: (sessionData: {
    access_token: string;
    refresh_token: string;
  }, user: AppUser) => Promise<void>;
}

const AppAuthContext = createContext<AppAuthContextType | undefined>(undefined);

export function AppAuthProvider({ children }: { children: ReactNode }) {
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch app user data from DB
  const fetchAppUser = useCallback(async (authUserId: string) => {
    try {
      const { data, error } = await supabase
        .from("phone_users")
        .select("id, email, display_name, role, max_invites")
        .eq("auth_user_id", authUserId)
        .maybeSingle();

      if (error) {
        console.error("Error fetching app user:", error);
        return null;
      }
      return data as AppUser | null;
    } catch (err) {
      console.error("fetchAppUser error:", err);
      return null;
    }
  }, []);

  useEffect(() => {
    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        if (session?.user) {
          queueMicrotask(async () => {
            const user = await fetchAppUser(session.user.id);
            setAppUser(user);
            setIsLoading(false);
          });
        } else {
          setAppUser(null);
          setIsLoading(false);
        }
      }
    );

    // Check initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        const user = await fetchAppUser(session.user.id);
        setAppUser(user);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [fetchAppUser]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setAppUser(null);
    setSession(null);
  }, []);

  const setSessionFromOtp = useCallback(
    async (
      sessionData: { access_token: string; refresh_token: string },
      user: AppUser
    ) => {
      const { data, error } = await supabase.auth.setSession({
        access_token: sessionData.access_token,
        refresh_token: sessionData.refresh_token,
      });

      if (error) {
        console.error("setSession error:", error);
        throw error;
      }

      setSession(data.session);
      setAppUser(user);
    },
    []
  );

  const isAuthenticated = !!session && !!appUser;

  // Memoize context value to prevent cascading re-renders on public pages
  const contextValue = useMemo<AppAuthContextType>(
    () => ({
      appUser,
      session,
      isLoading,
      isAuthenticated,
      signOut,
      setSessionFromOtp,
    }),
    [appUser, session, isLoading, isAuthenticated, signOut, setSessionFromOtp]
  );

  return (
    <AppAuthContext.Provider value={contextValue}>
      {children}
    </AppAuthContext.Provider>
  );
}

export function useAppAuth() {
  const context = useContext(AppAuthContext);
  if (context === undefined) {
    throw new Error("useAppAuth must be used within an AppAuthProvider");
  }
  return context;
}

// Re-export for backward compatibility
export const usePhoneAuth = useAppAuth;
export const PhoneAuthProvider = AppAuthProvider;
