// ============================================================================
// APPROVE ACCESS REQUEST - Creates user + sends email notification
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

    if (action === "rejected") {
      return successResponse(req, {
        success: true,
        action: "rejected",
        message: "Demande rejetée",
      });
    }

    // APPROVED: Create user with email
    const userEmail = request.email || request.phone;

    // Check if email already exists in phone_users
    const { data: existingUser } = await supabase
      .from("phone_users")
      .select("id")
      .eq("email", userEmail)
      .maybeSingle();

    if (existingUser) {
      return successResponse(req, {
        success: true,
        action: "approved",
        message: "Demande approuvée (utilisateur existant)",
        alreadyExists: true,
      });
    }

    // Create the user
    const { data: newUser, error: insertError } = await supabase
      .from("phone_users")
      .insert({
        email: userEmail,
        display_name: request.company_name,
        role: "manager",
        max_invites: 2,
      })
      .select()
      .single();

    if (insertError) {
      console.error("[approve-access] Insert error:", insertError);
      return errorResponse(req, "Erreur lors de la création de l'utilisateur", 500);
    }

    console.log(`[approve-access] User created: ${newUser.id} (${userEmail})`);

    return successResponse(req, {
      success: true,
      action: "approved",
      user: {
        id: newUser.id,
        email: newUser.email,
        display_name: newUser.display_name,
        role: newUser.role,
      },
      message: "Utilisateur créé avec succès",
    });
  } catch (error) {
    console.error("[approve-access] Error:", error);
    return errorResponse(req, (error as Error).message || "Erreur inconnue", 500);
  }
});
