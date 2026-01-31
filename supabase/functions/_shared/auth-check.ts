// ============================================================================
// AUTHENTICATION CHECK - Production Hardening
// ============================================================================
// Validates requests are authenticated in production mode
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
 * Check if running in production mode
 */
export function isProductionMode(): boolean {
  const env = Deno.env.get("ENVIRONMENT") || Deno.env.get("DENO_ENV") || "";
  return env === "production" || env === "prod";
}

/**
 * Extract and validate JWT from Authorization header
 */
export async function checkAuthentication(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization");
  
  // In development, allow unauthenticated requests
  if (!isProductionMode()) {
    if (!authHeader) {
      console.log("[Auth] Dev mode: allowing unauthenticated request");
      return { authenticated: true, userId: "dev-user" };
    }
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
    
    // Validate JWT claims
    const { data, error } = await supabase.auth.getUser(token);
    
    if (error || !data?.user) {
      return {
        authenticated: false,
        error: error?.message || "Invalid token",
      };
    }
    
    const user = data.user;
    
    // Check for admin role
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    let isAdmin = false;
    
    if (supabaseServiceKey) {
      const adminClient = createClient(supabaseUrl, supabaseServiceKey);
      const { data: roleData } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      
      isAdmin = !!roleData;
    }
    
    return {
      authenticated: true,
      userId: user.id,
      userEmail: user.email,
      isAdmin,
    };
  } catch (err) {
    console.error("[Auth] Validation error:", err);
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
