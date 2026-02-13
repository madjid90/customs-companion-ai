import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight(req);
  }

  const corsHeaders = getCorsHeaders(req);

  try {
    const { email, displayName } = await req.json();

    if (!email || typeof email !== "string") {
      return new Response(
        JSON.stringify({ error: "Adresse email requise" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return new Response(
        JSON.stringify({ error: "Format d'email invalide" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const name = (displayName || "").trim().slice(0, 100);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Get the manager from the auth token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Non authentifié" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !authUser) {
      return new Response(
        JSON.stringify({ error: "Token invalide" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the caller is a manager
    const { data: manager, error: managerError } = await supabase
      .from("phone_users")
      .select("*")
      .eq("auth_user_id", authUser.id)
      .eq("role", "manager")
      .eq("is_active", true)
      .maybeSingle();

    if (managerError || !manager) {
      return new Response(
        JSON.stringify({ error: "Seuls les managers peuvent inviter des utilisateurs" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check invite limit
    const { count: agentCount } = await supabase
      .from("phone_users")
      .select("*", { count: "exact", head: true })
      .eq("invited_by", manager.id)
      .eq("role", "agent");

    const maxInvites = manager.max_invites || 2;
    if ((agentCount || 0) >= maxInvites) {
      return new Response(
        JSON.stringify({
          error: `Limite d'invitations atteinte (${maxInvites} utilisateurs maximum)`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if email already exists
    const { data: existingUser } = await supabase
      .from("phone_users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingUser) {
      return new Response(
        JSON.stringify({ error: "Cette adresse email est déjà enregistrée" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create phone_user entry
    const { data: newAgent, error: insertError } = await supabase
      .from("phone_users")
      .insert({
        email: normalizedEmail,
        display_name: name || null,
        role: "agent",
        invited_by: manager.id,
        max_invites: 0,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert agent error:", insertError);
      return new Response(
        JSON.stringify({ error: "Erreur lors de la création de l'invitation" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        agent: {
          id: newAgent.id,
          email: newAgent.email,
          display_name: newAgent.display_name,
          role: newAgent.role,
          created_at: newAgent.created_at,
        },
        message: "Utilisateur invité avec succès",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("invite-agent error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur inconnue" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
