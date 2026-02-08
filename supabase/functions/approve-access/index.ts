// ============================================================================
// APPROVE ACCESS REQUEST - Creates manager + sends SMS
// ============================================================================
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight, errorResponse, successResponse } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth-check.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight(req);
  }

  const corsHeaders = getCorsHeaders(req);

  // Require admin authentication
  const { error: authError } = await requireAuth(req, corsHeaders, true);
  if (authError) return authError;

  try {
    const { requestId, action } = await req.json();

    if (!requestId || !action) {
      return errorResponse(req, "requestId et action sont requis", 400);
    }

    if (!["approved", "rejected"].includes(action)) {
      return errorResponse(req, "action doit être 'approved' ou 'rejected'", 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch the access request
    const { data: request, error: fetchError } = await supabase
      .from("access_requests")
      .select("*")
      .eq("id", requestId)
      .eq("status", "pending")
      .maybeSingle();

    if (fetchError || !request) {
      return errorResponse(req, "Demande introuvable ou déjà traitée", 404);
    }

    // Update request status
    const { error: updateError } = await supabase
      .from("access_requests")
      .update({
        status: action,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", requestId);

    if (updateError) {
      console.error("[approve-access] Update error:", updateError);
      return errorResponse(req, "Erreur lors de la mise à jour", 500);
    }

    // If rejected, we're done
    if (action === "rejected") {
      return successResponse(req, {
        success: true,
        action: "rejected",
        message: "Demande rejetée",
      });
    }

    // APPROVED: Create phone_user as manager
    const phone = request.phone;

    // Check if phone already exists
    const { data: existingUser } = await supabase
      .from("phone_users")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    if (existingUser) {
      return successResponse(req, {
        success: true,
        action: "approved",
        message: "Demande approuvée (utilisateur existant)",
        alreadyExists: true,
      });
    }

    // Create the manager
    const { data: newManager, error: insertError } = await supabase
      .from("phone_users")
      .insert({
        phone,
        display_name: request.company_name,
        role: "manager",
        max_invites: 2,
      })
      .select()
      .single();

    if (insertError) {
      console.error("[approve-access] Insert error:", insertError);
      return errorResponse(req, "Erreur lors de la création du manager", 500);
    }

    console.log(`[approve-access] Manager created: ${newManager.id} (${phone})`);

    // Send invitation SMS via Twilio
    let smsSent = false;
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioPhone = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (twilioSid && twilioToken && twilioPhone) {
      const appUrl = Deno.env.get("APP_URL") || "https://douaneai.app";
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
      const twilioAuth = btoa(`${twilioSid}:${twilioToken}`);

      const smsBody = `Bienvenue sur DouaneAI ! Votre demande d'accès pour ${request.company_name} a été approuvée. Connectez-vous avec ce numéro : ${appUrl}`;

      try {
        const twilioResponse = await fetch(twilioUrl, {
          method: "POST",
          headers: {
            Authorization: `Basic ${twilioAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: phone,
            From: twilioPhone,
            Body: smsBody,
          }),
        });

        if (twilioResponse.ok) {
          smsSent = true;
          console.log(`[approve-access] SMS sent to ${phone}`);
        } else {
          const errorText = await twilioResponse.text();
          console.error("[approve-access] Twilio error:", errorText);
        }
      } catch (smsError) {
        console.error("[approve-access] SMS sending failed:", smsError);
      }
    }

    return successResponse(req, {
      success: true,
      action: "approved",
      manager: {
        id: newManager.id,
        phone: newManager.phone,
        display_name: newManager.display_name,
        role: newManager.role,
      },
      smsSent,
      message: smsSent
        ? "Manager créé et SMS d'invitation envoyé"
        : "Manager créé (SMS non envoyé - vérifiez la config Twilio)",
    });
  } catch (error) {
    console.error("[approve-access] Error:", error);
    return errorResponse(req, (error as Error).message || "Erreur inconnue", 500);
  }
});
