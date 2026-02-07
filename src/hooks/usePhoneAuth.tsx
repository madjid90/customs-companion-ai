import React, { useState, useEffect, createContext, useContext, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Session } from "@supabase/supabase-js";

type PhoneRole = "manager" | "agent";

interface PhoneUser {
  id: string;
  phone: string;
  display_name: string | null;
  role: PhoneRole;
}

interface PhoneAuthContextType {
  phoneUser: PhoneUser | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isManager: boolean;
  isAgent: boolean;
  signOut: () => Promise<void>;
  setSessionFromOtp: (sessionData: {
    access_token: string;
    refresh_token: string;
  }, user: PhoneUser) => Promise<void>;
}

const PhoneAuthContext = createContext<PhoneAuthContextType | undefined>(undefined);

export function PhoneAuthProvider({ children }: { children: ReactNode }) {
  const [phoneUser, setPhoneUser] = useState<PhoneUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch phone user data from DB
  const fetchPhoneUser = useCallback(async (authUserId: string) => {
    try {
      const { data, error } = await supabase
        .from("phone_users")
        .select("id, phone, display_name, role")
        .eq("auth_user_id", authUserId)
        .maybeSingle();

      if (error) {
        console.error("Error fetching phone user:", error);
        return null;
      }
      return data as PhoneUser | null;
    } catch (err) {
      console.error("fetchPhoneUser error:", err);
      return null;
    }
  }, []);

  useEffect(() => {
    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        if (session?.user) {
          // Use setTimeout to avoid Supabase deadlock
          setTimeout(async () => {
            const user = await fetchPhoneUser(session.user.id);
            setPhoneUser(user);
            setIsLoading(false);
          }, 0);
        } else {
          setPhoneUser(null);
          setIsLoading(false);
        }
      }
    );

    // Check initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        const user = await fetchPhoneUser(session.user.id);
        setPhoneUser(user);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [fetchPhoneUser]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setPhoneUser(null);
    setSession(null);
  }, []);

  const setSessionFromOtp = useCallback(
    async (
      sessionData: { access_token: string; refresh_token: string },
      user: PhoneUser
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
      setPhoneUser(user);
    },
    []
  );

  const isAuthenticated = !!session && !!phoneUser;
  const isManager = phoneUser?.role === "manager";
  const isAgent = phoneUser?.role === "agent";

  return (
    <PhoneAuthContext.Provider
      value={{
        phoneUser,
        session,
        isLoading,
        isAuthenticated,
        isManager,
        isAgent,
        signOut,
        setSessionFromOtp,
      }}
    >
      {children}
    </PhoneAuthContext.Provider>
  );
}

export function usePhoneAuth() {
  const context = useContext(PhoneAuthContext);
  if (context === undefined) {
    throw new Error("usePhoneAuth must be used within a PhoneAuthProvider");
  }
  return context;
}
