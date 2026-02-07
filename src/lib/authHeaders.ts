import { supabase } from "@/integrations/supabase/client";

/**
 * Get authorization headers for Edge Function calls.
 * Uses the user's session JWT for authenticated requests,
 * falls back to the anon key for public endpoints.
 */
export async function getAuthHeaders(requireSession = true): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };

  const { data: { session } } = await supabase.auth.getSession();

  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  } else if (requireSession) {
    throw new Error("Session expirée. Veuillez vous reconnecter.");
  } else {
    headers["Authorization"] = `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`;
  }

  return headers;
}
