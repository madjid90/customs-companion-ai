import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getCorsHeaders,
  handleCorsPreFlight,
  getClientId,
  checkRateLimitDistributed,
  rateLimitResponse,
} from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight(req);
  }

  const corsHeaders = getCorsHeaders(req);

  // Rate limiting: max 5 OTP requests per phone per 15 minutes
  const clientId = getClientId(req);
  const rateLimit = await checkRateLimitDistributed(clientId, {
    maxRequests: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
    blockDurationMs: 15 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse(req, rateLimit.resetAt);
  }

  try {
    const { phone } = await req.json();

    if (!phone || typeof phone !== "string") {
      return new Response(
        JSON.stringify({ error: "Numéro de téléphone requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize phone: ensure +prefix
    const normalizedPhone = phone.startsWith("+") ? phone : `+${phone}`;

    // Validate phone format
    if (!/^\+[1-9]\d{6,14}$/.test(normalizedPhone)) {
      return new Response(
        JSON.stringify({ error: "Format de numéro invalide" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Phone-specific rate limit: max 3 OTP per phone per 15 minutes
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count: recentOtpCount } = await supabase
      .from("otp_codes")
      .select("*", { count: "exact", head: true })
      .eq("phone", normalizedPhone)
      .gte("created_at", fifteenMinutesAgo);

    if ((recentOtpCount || 0) >= 3) {
      return new Response(
        JSON.stringify({ error: "Trop de demandes. Réessayez dans 15 minutes." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if this is the very first user (bootstrap manager)
    const { count: totalUsers } = await supabase
      .from("phone_users")
      .select("*", { count: "exact", head: true });

    let isBootstrap = false;

    if (totalUsers === 0) {
      // First user ever — allow and will be created as manager
      isBootstrap = true;
    } else {
      // Check if phone is in the invitation whitelist
      const { data: phoneUser, error: lookupError } = await supabase
        .from("phone_users")
        .select("id, is_active")
        .eq("phone", normalizedPhone)
        .maybeSingle();

      if (lookupError) {
        console.error("Lookup error:", lookupError);
        return new Response(
          JSON.stringify({ error: "Erreur interne" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!phoneUser) {
        return new Response(
          JSON.stringify({ error: "Ce numéro n'est pas autorisé. L'accès se fait sur invitation uniquement." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!phoneUser.is_active) {
        return new Response(
          JSON.stringify({ error: "Votre accès a été désactivé. Contactez votre manager." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Invalidate any existing unused OTPs for this phone
    await supabase
      .from("otp_codes")
      .update({ is_used: true })
      .eq("phone", normalizedPhone)
      .eq("is_used", false);

    // Generate 6-digit OTP using cryptographically secure random
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    const code = String(100000 + (array[0] % 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

    // Store OTP
    const { error: insertError } = await supabase.from("otp_codes").insert({
      phone: normalizedPhone,
      code,
      expires_at: expiresAt,
    });

    if (insertError) {
      console.error("Insert OTP error:", insertError);
      return new Response(
        JSON.stringify({ error: "Erreur lors de la génération du code" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send SMS via Twilio
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioPhone = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!twilioSid || !twilioToken || !twilioPhone) {
      console.error("Twilio credentials not configured");
      return new Response(
        JSON.stringify({ error: "Service SMS non configuré" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
    const twilioAuth = btoa(`${twilioSid}:${twilioToken}`);

    const smsBody = `Votre code de vérification DouaneAI : ${code}. Valable 5 minutes.`;

    const twilioResponse = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${twilioAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: normalizedPhone,
        From: twilioPhone,
        Body: smsBody,
      }),
    });

    if (!twilioResponse.ok) {
      const twilioError = await twilioResponse.text();
      console.error("Twilio error:", twilioError);
      return new Response(
        JSON.stringify({ error: "Erreur lors de l'envoi du SMS. Vérifiez le numéro." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Code envoyé par SMS",
        isBootstrap,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("send-otp error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur inconnue" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});