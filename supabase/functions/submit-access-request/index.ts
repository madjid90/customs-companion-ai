// ============================================================================
// SUBMIT ACCESS REQUEST - with honeypot + rate limiting
// ============================================================================
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getCorsHeaders,
  handleCorsPreFlight,
  errorResponse,
  successResponse,
  getClientId,
  checkRateLimitDistributed,
  rateLimitResponse,
} from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight(req);
  }

  const corsHeaders = getCorsHeaders(req);

  // Rate limiting: max 3 requests per IP per hour
  const clientId = getClientId(req);
  const rateLimit = await checkRateLimitDistributed(clientId, {
    maxRequests: 3,
    windowMs: 60 * 60 * 1000,
    blockDurationMs: 60 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse(req, rateLimit.resetAt);
  }

  try {
    const body = await req.json();
    const { company_name, phone, website } = body;

    // Honeypot check: "website" field should be empty (hidden from real users)
    if (website) {
      // Bot detected - return success to not reveal the check
      console.log("[submit-access-request] Honeypot triggered, blocking");
      return successResponse(req, { success: true, message: "Demande envoyée" });
    }

    // Validate inputs
    if (!company_name || typeof company_name !== "string" || company_name.trim().length < 2) {
      return errorResponse(req, "Nom de société requis (minimum 2 caractères)", 400);
    }

    if (!phone || typeof phone !== "string") {
      return errorResponse(req, "Numéro de téléphone requis", 400);
    }

    const normalizedPhone = phone.startsWith("+") ? phone : `+${phone}`;
    if (!/^\+[1-9]\d{6,14}$/.test(normalizedPhone)) {
      return errorResponse(req, "Format de numéro invalide", 400);
    }

    // Sanitize company name
    const sanitizedName = company_name.trim().slice(0, 200);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check for duplicate pending requests
    const { data: existing } = await supabase
      .from("access_requests")
      .select("id")
      .eq("phone", normalizedPhone)
      .eq("status", "pending")
      .maybeSingle();

    if (existing) {
      return errorResponse(req, "Une demande est déjà en cours pour ce numéro", 409);
    }

    // Insert request
    const { error: insertError } = await supabase
      .from("access_requests")
      .insert({
        company_name: sanitizedName,
        phone: normalizedPhone,
      });

    if (insertError) {
      console.error("[submit-access-request] Insert error:", insertError);
      return errorResponse(req, "Erreur lors de l'envoi de la demande", 500);
    }

    console.log(`[submit-access-request] New request from ${normalizedPhone} (${sanitizedName})`);

    return successResponse(req, {
      success: true,
      message: "Demande envoyée avec succès",
    });
  } catch (error) {
    console.error("[submit-access-request] Error:", error);
    return errorResponse(req, "Erreur inconnue", 500);
  }
});
