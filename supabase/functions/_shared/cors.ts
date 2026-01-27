// ============================================================================
// SHARED CORS CONFIGURATION - PHASE 4 SECURITY FIX
// ============================================================================

// Allowed origins - ADD YOUR PRODUCTION DOMAINS HERE
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
  "https://customs-companion.vercel.app",
  "https://customs-companion.netlify.app",
  // Lovable preview domains
  "https://51d41d3f-1b65-481d-b04a-12695ec7c38e.lovableproject.com",
  "https://id-preview--51d41d3f-1b65-481d-b04a-12695ec7c38e.lovable.app",
];

// Check if origin is allowed - PERMISSIVE for Lovable domains
function isLovableDomain(origin: string): boolean {
  return origin.includes('.lovableproject.com') || 
         origin.includes('.lovable.app') ||
         origin.includes('.lovableproject.dev');
}

// Check if origin is allowed
export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;

  // Allow localhost in development
  if (origin.startsWith("http://localhost:")) return true;

  // Allow all Lovable domains dynamically
  if (isLovableDomain(origin)) return true;

  return ALLOWED_ORIGINS.includes(origin);
}

// Get CORS headers based on request origin
export function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const isAllowed = isOriginAllowed(origin);

  return {
    "Access-Control-Allow-Origin": isAllowed && origin ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
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
// RATE LIMITING - In-Memory (per Edge Function instance)
// ============================================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

interface RateLimitConfig {
  maxRequests: number;    // Max requests per window
  windowMs: number;       // Window duration in milliseconds
  blockDurationMs: number; // Block duration after limit exceeded
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 30,        // 30 requests
  windowMs: 60000,        // per minute
  blockDurationMs: 300000, // 5 min block
};

// Clean up expired entries periodically
function cleanupRateLimitStore(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}

// Get client identifier from request
export function getClientId(request: Request): string {
  // Priority: custom header > forwarded IP > CF IP > fallback
  return (
    request.headers.get("x-client-id") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    "anonymous"
  );
}

// Check rate limit
export function checkRateLimit(
  clientId: string,
  config: RateLimitConfig = DEFAULT_CONFIG
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();

  // Clean up occasionally
  if (Math.random() < 0.1) {
    cleanupRateLimitStore();
  }

  const entry = rateLimitStore.get(clientId);

  if (!entry || entry.resetAt < now) {
    // New window
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
    // Rate limited - extend block
    entry.resetAt = now + config.blockDurationMs;
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  // Increment counter
  entry.count++;
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

// Create rate limit response
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
