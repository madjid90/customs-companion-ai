// ============================================================================
// AUTHENTICATION CHECK - Production Hardening
// ============================================================================
// Validates requests are authenticated using getClaims() for signing-keys
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

export interface AuthResult {
  authenticated: boolean;
  userId?: string;
  userEmail?: string;
  isAdmin?: boolean;
  error?: string;
}

/**
 * Check if running in production mode.
 * SECURITY: Default to production. Only dev if EXPLICITLY set to "development" or "dev".
 * This prevents accidental auth bypass if ENVIRONMENT is not configured.
 */
export function isProductionMode(): boolean {
  const env = Deno.env.get("ENVIRONMENT") || "";
  return env !== "development" && env !== "dev";
}

/**
 * Extract and validate JWT from Authorization header using getClaims()
 */
export async function checkAuthentication(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization");
  
  const devMode = !isProductionMode();

  // In development, allow unauthenticated requests
  if (devMode && !authHeader) {
    console.log("[Auth] Dev mode: allowing unauthenticated request");
    return { authenticated: true, userId: "dev-user" };
  }
  
  // Check for Authorization header
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      authenticated: false,
      error: "Missing or invalid Authorization header",
    };
  }
  
  const token = authHeader.replace("Bearer ", "");
  
  // Validate with Supabase
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[Auth] Missing Supabase configuration");
    return {
      authenticated: false,
      error: "Server configuration error",
    };
  }
  
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    
    // Try getClaims() first, fall back to getUser() if it fails
    let userId: string | undefined;
    let userEmail: string | undefined;
    
    try {
      const { data, error } = await supabase.auth.getClaims(token);
      if (!error && data?.claims?.sub) {
        userId = data.claims.sub as string;
        userEmail = data.claims.email as string | undefined;
        console.log("[Auth] getClaims succeeded for user:", userId);
      } else {
        console.warn("[Auth] getClaims failed, trying getUser:", error?.message);
      }
    } catch (claimsErr) {
      console.warn("[Auth] getClaims threw, trying getUser:", claimsErr);
    }
    
    // Fallback to getUser() if getClaims didn't work
    if (!userId) {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        console.error("[Auth] getUser also failed:", userError?.message);
        if (devMode) {
          console.log("[Auth] Dev mode: allowing request despite invalid token");
          return { authenticated: true, userId: "dev-user" };
        }
        return {
          authenticated: false,
          error: userError?.message || "Invalid token",
        };
      }
      userId = userData.user.id;
      userEmail = userData.user.email;
      console.log("[Auth] getUser succeeded for user:", userId);
    }
    
    if (!userId) {
      return {
        authenticated: false,
        error: "Token missing user ID (sub claim)",
      };
    }
    
    // Check for admin role
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    let isAdmin = false;
    
    if (supabaseServiceKey) {
      const adminClient = createClient(supabaseUrl, supabaseServiceKey);
      const { data: roleData } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();
      
      isAdmin = !!roleData;
    }
    
    return {
      authenticated: true,
      userId,
      userEmail,
      isAdmin,
    };
  } catch (err) {
    console.error("[Auth] Validation error:", err);
    // In dev mode, allow request even if token validation fails (e.g. expired token)
    if (devMode) {
      console.log("[Auth] Dev mode: allowing request despite validation error");
      return { authenticated: true, userId: "dev-user" };
    }
    return {
      authenticated: false,
      error: "Authentication validation failed",
    };
  }
}

/**
 * Require authentication - returns error response if not authenticated
 */
export async function requireAuth(
  req: Request,
  corsHeaders: Record<string, string>,
  requireAdmin = false
): Promise<{ error?: Response; auth?: AuthResult }> {
  const authResult = await checkAuthentication(req);
  
  if (!authResult.authenticated) {
    return {
      error: new Response(
        JSON.stringify({ error: authResult.error || "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      ),
    };
  }
  
  if (requireAdmin && !authResult.isAdmin) {
    return {
      error: new Response(
        JSON.stringify({ error: "Admin access required" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      ),
    };
  }
  
  return { auth: authResult };
}

/**
 * Check if request has valid API key (for service-to-service calls)
 */
export function checkApiKey(req: Request, expectedKey: string): boolean {
  const apiKey = req.headers.get("X-API-Key") || req.headers.get("x-api-key");
  return apiKey === expectedKey;
}
