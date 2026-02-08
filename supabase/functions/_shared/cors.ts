// ============================================================================
// SHARED CORS CONFIGURATION - PRODUCTION SECURE
// ============================================================================

// Environment detection - SECURITY: default to production unless explicitly dev
const IS_PRODUCTION = (() => {
  const env = Deno.env.get("ENVIRONMENT") || "";
  return env !== "development" && env !== "dev";
})();

// Allowed origins - Production domains
const PRODUCTION_ORIGINS = [
  "https://customs-companion.vercel.app",
  "https://customs-companion.netlify.app",
  // Lovable Cloud published domain
  "https://id-preview--51d41d3f-1b65-481d-b04a-12695ec7c38e.lovable.app",
];

// Development origins (only used in non-production)
const DEVELOPMENT_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
];

// Lovable preview/published domains
function isLovableDomain(origin: string): boolean {
  // In production, only allow the specific Lovable published domain (listed in PRODUCTION_ORIGINS)
  if (IS_PRODUCTION) return false;
  return origin.includes('.lovableproject.com') || 
         origin.includes('.lovable.app') ||
         origin.includes('.lovableproject.dev');
}

// Check if origin is allowed
export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;

  // Production: uniquement les domaines listés explicitement
  if (IS_PRODUCTION) {
    return PRODUCTION_ORIGINS.includes(origin);
  }

  // Development: autoriser localhost et Lovable
  if (origin.startsWith("http://localhost:")) return true;
  if (isLovableDomain(origin)) return true;
  
  return PRODUCTION_ORIGINS.includes(origin) || DEVELOPMENT_ORIGINS.includes(origin);
}

// Get CORS headers based on request origin
export function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const isAllowed = isOriginAllowed(origin);

  return {
    "Access-Control-Allow-Origin": isAllowed && origin ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Allow-Credentials": "true",
  };
}

// Handle OPTIONS preflight request
export function handleCorsPreFlight(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}

// ============================================================================
// RATE LIMITING - In-Memory (per Edge Function instance) - FALLBACK
// ============================================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  blockDurationMs: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 30,
  windowMs: 60000,
  blockDurationMs: 300000,
};

function cleanupRateLimitStore(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}

export function getClientId(request: Request): string {
  return (
    request.headers.get("x-client-id") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    "anonymous"
  );
}

export function checkRateLimit(
  clientId: string,
  config: RateLimitConfig = DEFAULT_CONFIG
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();

  if (Math.random() < 0.1) {
    cleanupRateLimitStore();
  }

  const entry = rateLimitStore.get(clientId);

  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(clientId, {
      count: 1,
      resetAt: now + config.windowMs,
    });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt: now + config.windowMs,
    };
  }

  if (entry.count >= config.maxRequests) {
    entry.resetAt = now + config.blockDurationMs;
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

// ============================================================================
// RATE LIMITING - Distributed (using Supabase rate_limits table)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface DistributedRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  error?: string;
}

export async function checkRateLimitDistributed(
  clientId: string,
  config: RateLimitConfig = DEFAULT_CONFIG
): Promise<DistributedRateLimitResult> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("[RateLimit] Missing env vars, using in-memory fallback");
    return checkRateLimit(clientId, config);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date();
  const windowStart = new Date(now.getTime() - config.windowMs);

  try {
    const { data: existing, error: selectError } = await supabase
      .from("rate_limits")
      .select("*")
      .eq("client_id", clientId)
      .single();

    if (selectError && selectError.code !== "PGRST116") {
      console.error("[RateLimit] Select error:", selectError);
      return checkRateLimit(clientId, config);
    }

    if (existing?.blocked_until) {
      const blockedUntil = new Date(existing.blocked_until);
      if (blockedUntil > now) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: blockedUntil.getTime(),
        };
      }
    }

    if (existing?.window_start) {
      const existingWindowStart = new Date(existing.window_start);
      
      if (existingWindowStart > windowStart) {
        if (existing.request_count >= config.maxRequests) {
          const blockedUntil = new Date(now.getTime() + config.blockDurationMs);
          
          await supabase
            .from("rate_limits")
            .update({ blocked_until: blockedUntil.toISOString() })
            .eq("client_id", clientId);

          return {
            allowed: false,
            remaining: 0,
            resetAt: blockedUntil.getTime(),
          };
        }

        const { error: updateError } = await supabase
          .from("rate_limits")
          .update({ request_count: existing.request_count + 1 })
          .eq("client_id", clientId);

        if (updateError) {
          console.error("[RateLimit] Update error:", updateError);
          return checkRateLimit(clientId, config);
        }

        return {
          allowed: true,
          remaining: config.maxRequests - existing.request_count - 1,
          resetAt: existingWindowStart.getTime() + config.windowMs,
        };
      }
    }

    const resetAt = now.getTime() + config.windowMs;
    
    const { error: upsertError } = await supabase
      .from("rate_limits")
      .upsert({
        client_id: clientId,
        request_count: 1,
        window_start: now.toISOString(),
        blocked_until: null,
      }, {
        onConflict: "client_id",
      });

    if (upsertError) {
      console.error("[RateLimit] Upsert error:", upsertError);
      return checkRateLimit(clientId, config);
    }

    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt,
    };
  } catch (error) {
    console.error("[RateLimit] Unexpected error:", error);
    return checkRateLimit(clientId, config);
  }
}

export function rateLimitResponse(
  request: Request,
  resetAt: number
): Response {
  const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);

  return new Response(
    JSON.stringify({
      error: "Trop de requêtes. Veuillez réessayer plus tard.",
      retryAfter: retryAfter,
    }),
    {
      status: 429,
      headers: {
        ...getCorsHeaders(request),
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
      },
    }
  );
}

// ============================================================================
// ERROR RESPONSE HELPERS
// ============================================================================

export function errorResponse(
  request: Request,
  message: string,
  status: number = 500,
  errorId?: string
): Response {
  return new Response(
    JSON.stringify({
      error: message,
      ...(errorId && { errorId }),
    }),
    {
      status,
      headers: {
        ...getCorsHeaders(request),
        "Content-Type": "application/json",
      },
    }
  );
}

export function successResponse(
  request: Request,
  data: unknown
): Response {
  return new Response(
    JSON.stringify(data),
    {
      status: 200,
      headers: {
        ...getCorsHeaders(request),
        "Content-Type": "application/json",
      },
    }
  );
}
